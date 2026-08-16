"use server";

/**
 * Server Actions del portal del seller para conectar su tienda Shopify.
 *
 * Van en archivo propio y no en `./actions.ts` porque ese archivo es del panel
 * de Mercado Libre y ya carga la semántica del OAuth (modos, cookies de estado,
 * reconexión por id). Shopify no tiene nada de eso: el seller pega un token y
 * listo. Mezclarlos obligaría a leer el enredo de ML para entender este flujo.
 *
 * Patrón del proyecto que sí se respeta: bitácora ANTES del efecto, capacidad
 * RBAC verificada en el servidor, y el token NUNCA vuelve al cliente ni queda en
 * un log.
 */

import { revalidatePath } from "next/cache";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { puedeGestionarConexionesFuentePropia } from "@/modules/identidad/capacidades";
import {
  conectarTienda,
  reconectarTienda,
  obtenerConexionesPorSeller,
  normalizarShopDomain,
  ErrorCredencialShopifyInvalida,
  ErrorScopesShopifyFaltantes,
  ErrorTiendaShopifyYaConectada,
  ErrorShopDomainInvalido,
  type ConexionShopify,
} from "@/modules/integraciones/shopify";

/** Vista de la conexión que viaja al cliente. Sin `tokenRef`, sin secretos. */
export interface ConexionShopifySeller {
  id: string;
  shopDomain: string;
  nombreTienda: string | null;
  alias: string | null;
  filtroEtiqueta: string | null;
  estadoSalud: ConexionShopify["estadoSalud"];
  ultimaSyncExitosaEn: string | null;
  activa: boolean;
}

export type ResultadoAccionShopify =
  | { ok: true }
  | { ok: false; mensaje: string; scopesFaltantes?: string[] };

function aVista(c: ConexionShopify): ConexionShopifySeller {
  return {
    id: c.id,
    shopDomain: c.shopDomain,
    nombreTienda: c.nombreTienda,
    alias: c.alias,
    filtroEtiqueta: c.filtroEtiqueta,
    estadoSalud: c.estadoSalud,
    ultimaSyncExitosaEn: c.ultimaSyncExitosaEn,
    activa: c.activa,
  };
}

async function sesionSellerConPermiso() {
  const sesion = await obtenerSesionActual();
  const u = sesion?.usuario;
  if (!u?.tenantId || u.tipoUsuario !== "seller" || !u.sellerId) return null;
  if (!puedeGestionarConexionesFuentePropia(u)) return null;
  return { tenantId: u.tenantId, sellerId: u.sellerId, usuarioId: sesion!.usuarioId };
}

export async function obtenerConexionesShopifyPropia(): Promise<ConexionShopifySeller[]> {
  const s = await sesionSellerConPermiso();
  if (!s) return [];
  try {
    const conexiones = await obtenerConexionesPorSeller(s.tenantId, s.sellerId);
    return conexiones.map(aVista);
  } catch (error) {
    console.error("[portal/shopify] no se pudieron leer las conexiones:", error);
    return [];
  }
}

/**
 * Traduce cualquier fallo a algo que el seller pueda accionar.
 *
 * Los scopes faltantes se devuelven aparte y no dentro del texto: la pantalla
 * los lista uno por uno, porque el error real que va a ocurrir mil veces es que
 * al crear la custom app se le olvidó marcar una casilla, y "faltan permisos" a
 * secas lo deja adivinando cuál.
 */
function traducirError(error: unknown): ResultadoAccionShopify {
  if (error instanceof ErrorScopesShopifyFaltantes) {
    return {
      ok: false,
      mensaje:
        "La app que creaste en Shopify no tiene todos los permisos que necesitamos. Edítala, marca los que faltan y vuelve a intentarlo.",
      scopesFaltantes: error.faltantes,
    };
  }
  if (error instanceof ErrorShopDomainInvalido) {
    return {
      ok: false,
      mensaje:
        "Ese no parece el dominio de una tienda Shopify. Debe verse como mi-tienda.myshopify.com.",
    };
  }
  if (error instanceof ErrorTiendaShopifyYaConectada) {
    return { ok: false, mensaje: "Esa tienda ya está conectada. Si el token cambió, usa Reconectar." };
  }
  if (error instanceof ErrorCredencialShopifyInvalida) {
    return { ok: false, mensaje: error.message };
  }
  console.error("[portal/shopify] fallo inesperado al conectar:", error);
  return { ok: false, mensaje: "No pudimos conectar la tienda. Inténtalo de nuevo en unos minutos." };
}

export async function conectarTiendaShopify(entrada: {
  shopDomain: string;
  accessToken: string;
  filtroEtiqueta?: string | null;
}): Promise<ResultadoAccionShopify> {
  const s = await sesionSellerConPermiso();
  if (!s) return { ok: false, mensaje: "No tienes permiso para conectar una tienda." };

  const dominio = normalizarShopDomain(entrada.shopDomain ?? "");
  if (!dominio) {
    return {
      ok: false,
      mensaje: "Ese no parece el dominio de una tienda Shopify. Debe verse como mi-tienda.myshopify.com.",
    };
  }

  // Bitácora ANTES del efecto (RNF-04). El dominio NO es secreto; el token no
  // aparece por ninguna parte, ni siquiera truncado.
  await registrarEnBitacora(crearClienteServiceRole(), {
    tenantId: s.tenantId,
    actorUsuarioId: s.usuarioId,
    actorTipo: "usuario",
    accion: "seller.conexion_shopify_solicitada",
    entidadTipo: "identidad.conexiones_seller_shopify",
    entidadId: null,
    detalle: { shopDomain: dominio, sellerId: s.sellerId },
  });

  try {
    await conectarTienda({
      tenantId: s.tenantId,
      sellerId: s.sellerId,
      shopDomain: dominio,
      accessToken: entrada.accessToken,
      filtroEtiqueta: entrada.filtroEtiqueta ?? null,
    });
  } catch (error) {
    return traducirError(error);
  }

  revalidatePath("/portal");
  return { ok: true };
}

export async function reconectarTiendaShopify(entrada: {
  conexionId: string;
  accessToken: string;
}): Promise<ResultadoAccionShopify> {
  const s = await sesionSellerConPermiso();
  if (!s) return { ok: false, mensaje: "No tienes permiso para reconectar esta tienda." };

  // La propiedad de la conexión se verifica contra las del propio seller: sin
  // esto, un id ajeno pegado en la petición dejaría reponer el token de la
  // tienda de otro.
  const propias = await obtenerConexionesPorSeller(s.tenantId, s.sellerId);
  if (!propias.some((c) => c.id === entrada.conexionId)) {
    return { ok: false, mensaje: "Esa tienda no es tuya." };
  }

  await registrarEnBitacora(crearClienteServiceRole(), {
    tenantId: s.tenantId,
    actorUsuarioId: s.usuarioId,
    actorTipo: "usuario",
    accion: "seller.conexion_shopify_reconectada",
    entidadTipo: "identidad.conexiones_seller_shopify",
    entidadId: entrada.conexionId,
    detalle: { sellerId: s.sellerId },
  });

  try {
    await reconectarTienda({
      conexionId: entrada.conexionId,
      tenantId: s.tenantId,
      accessToken: entrada.accessToken,
    });
  } catch (error) {
    return traducirError(error);
  }

  revalidatePath("/portal");
  return { ok: true };
}
