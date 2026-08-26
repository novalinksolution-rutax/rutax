"use server";

/**
 * Server Actions — Pantalla O (estado de conexión persistente del seller,
 * §3.2, RF-048).
 *
 * Solo lectura — delega a `obtenerConexionPorSeller` (puerto `integraciones/ml`
 * ya existente) para no duplicar la forma en que se resuelve la fila de
 * conexión. La traducción de `estado_salud` a lenguaje humano vive en el
 * componente de cliente (`panel-conexion-ml.tsx`) — aquí solo se entrega el
 * dato crudo tipado, nunca jerga ni tokens.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { olvidarSecreto } from "@/modules/integraciones/secretos/cifrado";
import { puedeGestionarConexionMlPropia } from "@/modules/identidad/capacidades";
import {
  obtenerConexionPorSeller,
  obtenerConexionesPorSeller,
  renombrarConexion,
  solicitarSincronizacionMl,
  type EstadoSaludConexionMl,
} from "@/modules/integraciones/ml";

export interface ConexionMlSeller {
  estadoSalud: EstadoSaludConexionMl;
  ultimaSyncExitosaEn: string | null;
  desconectadaDesde: string | null;
}

export type ResultadoEstadoConexion =
  | { ok: true; conexion: ConexionMlSeller | null }
  | { ok: false; mensaje: string };

export async function obtenerEstadoConexionPropia(): Promise<ResultadoEstadoConexion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "No hay una sesión de seller activa." };
  }

  try {
    const conexion = await obtenerConexionPorSeller(sesion.usuario.sellerId);
    if (!conexion) {
      return { ok: true, conexion: null };
    }

    return {
      ok: true,
      conexion: {
        estadoSalud: conexion.estadoSalud,
        ultimaSyncExitosaEn: conexion.ultimaSyncExitosaEn ? conexion.ultimaSyncExitosaEn.toISOString() : null,
        desconectadaDesde: conexion.desconectadaDesde ? conexion.desconectadaDesde.toISOString() : null,
      },
    };
  } catch {
    return {
      ok: false,
      mensaje: "No pudimos cargar el estado de tu conexión por un problema de nuestro sistema.",
    };
  }
}

// ---------------------------------------------------------------------------
// Modelo 1:N — el seller gestiona hasta MAX_CUENTAS_ML cuentas de Mercado
// Libre (constante única en conectar-ml/compartido.ts).
// ---------------------------------------------------------------------------

/** Una cuenta ML del seller, en la forma que consume el panel (sin jerga ni refs). */
export interface ConexionMlSellerItem {
  id: string;
  alias: string | null;
  mlNickname: string | null;
  mlUserId: string | null;
  estadoSalud: EstadoSaludConexionMl;
  ultimaSyncExitosaEn: string | null;
  desconectadaDesde: string | null;
  /**
   * `true` cuando la apagó una persona, no cuando se cayó sola.
   *
   * Sin esto la pantalla le diría «tu cuenta se desconectó, reconéctala» a
   * quien acaba de apagarla a propósito: reportarle como avería lo que hizo
   * queriendo. Las dos comparten `estado_salud = desvinculada` porque ese es el
   * estado que apaga la ingesta; lo que las distingue es el autor.
   *
   * Viaja como BOOLEANO y no como el id de quien la apagó: la pantalla necesita
   * saber si fue a propósito, no quién. El quién vive en la bitácora.
   */
  desconectadaPorSeller: boolean;
}

export type ResultadoConexiones =
  | { ok: true; conexiones: ConexionMlSellerItem[] }
  | { ok: false; mensaje: string };

/** Todas las cuentas ML del seller de la sesión (0 a MAX_CUENTAS_ML), para el panel plural. */
export async function obtenerConexionesPropia(): Promise<ResultadoConexiones> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "No hay una sesión de seller activa." };
  }

  try {
    const conexiones = await obtenerConexionesPorSeller(sesion.usuario.sellerId);

    return {
      ok: true,
      conexiones: conexiones.map((c) => ({
        id: c.id,
        alias: c.alias,
        mlNickname: c.mlNickname,
        mlUserId: c.mlUserId,
        estadoSalud: c.estadoSalud,
        ultimaSyncExitosaEn: c.ultimaSyncExitosaEn ? c.ultimaSyncExitosaEn.toISOString() : null,
        desconectadaDesde: c.desconectadaDesde ? c.desconectadaDesde.toISOString() : null,
        // El puerto ya lo reduce a booleano: acá no se vuelve a consultar.
        desconectadaPorSeller: c.desconectadaPorPersona,
      })),
    };
  } catch {
    return {
      ok: false,
      mensaje: "No pudimos cargar tus cuentas de Mercado Libre por un problema de nuestro sistema.",
    };
  }
}

const ALIAS_MAX = 40;

export type ResultadoRenombrar = { ok: true; alias: string | null } | { ok: false; mensaje: string };

/**
 * Renombra (alias) una de las cuentas del seller. El write real va por
 * service_role con verificación de propiedad en el puerto (`renombrarConexion`)
 * — el seller no puede escribir directo en la tabla (RLS + trigger).
 */
export async function renombrarConexionMl(conexionId: string, aliasCrudo: string): Promise<ResultadoRenombrar> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "No hay una sesión de seller activa." };
  }

  const alias = aliasCrudo.trim();
  if (alias.length > ALIAS_MAX) {
    return { ok: false, mensaje: `El nombre no puede superar los ${ALIAS_MAX} caracteres.` };
  }
  // Alias vacío = quitar el nombre personalizado (vuelve al nombre por defecto).
  const aliasFinal = alias.length === 0 ? null : alias;

  try {
    const ok = await renombrarConexion({
      conexionId,
      sellerId: sesion.usuario.sellerId,
      alias: aliasFinal,
    });
    if (!ok) {
      return { ok: false, mensaje: "No encontramos esa cuenta entre las tuyas." };
    }
    return { ok: true, alias: aliasFinal };
  } catch {
    return { ok: false, mensaje: "No pudimos guardar el nombre por un problema de nuestro sistema." };
  }
}

// ---------------------------------------------------------------------------
// "Sincronizar ahora" — pedir manualmente que se traigan los pedidos de una
// cuenta. Hoy es la ÚNICA vía real de ingesta bajo demanda: la pantalla dice
// "Tus pedidos se sincronizan automáticamente desde estas cuentas", pero ese
// automatismo (el cron) es trabajo en curso — y aun cuando exista, este botón
// sigue siendo el escape manual para "lo necesito ahora" o para reintentar sin
// desvincular una cuenta sana.
//
// Esta acción NO hace el trabajo de traer pedidos: solo verifica permiso +
// propiedad y publica `ml/sincronizacion.solicitada`. El consumidor real
// (módulo `integraciones`, construido en paralelo) es quien mueve datos.
// ---------------------------------------------------------------------------

export type ResultadoSolicitarSincronizacion = { ok: true } | { ok: false; mensaje: string };

/**
 * Pide sincronizar UNA cuenta ML propia. Verificación de propiedad: el mismo
 * patrón que `iniciarConexionMl` (portal/conectar-ml/actions.ts) — el
 * `conexionId` solo se acepta si aparece entre `obtenerConexionesPorSeller`
 * del seller de la SESIÓN, nunca se confía en lo que mande el cliente.
 */
export async function solicitarSincronizacionMlPropia(
  conexionId: string,
): Promise<ResultadoSolicitarSincronizacion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "No hay una sesión de seller activa." };
  }
  if (!puedeGestionarConexionMlPropia(sesion.usuario)) {
    return { ok: false, mensaje: "Tu cuenta no tiene permiso para gestionar esta conexión." };
  }

  let propias: Awaited<ReturnType<typeof obtenerConexionesPorSeller>>;
  try {
    propias = await obtenerConexionesPorSeller(sesion.usuario.sellerId);
  } catch {
    return {
      ok: false,
      mensaje: "No pudimos pedir la sincronización por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  const conexion = propias.find((c) => c.id === conexionId);
  if (!conexion) {
    // No es del seller de la sesión (o ya no existe) — mismo mensaje genérico
    // que renombrarConexionMl, sin confirmar ni negar que la fila exista.
    return { ok: false, mensaje: "No encontramos esa cuenta entre las tuyas." };
  }

  // Bitácora ANTES de publicar el evento (mismo patrón que
  // `emitirFacturaPeriodo`/`cerrarPeriodoManualmente`, CLAUDE.md: "Bitácora
  // antes que efectos externos, y con autor"). Si falla, no publicamos: sin
  // registro no hay trazabilidad de quién pidió qué.
  try {
    await registrarEnBitacora(crearClienteServiceRole(), {
      tenantId: conexion.tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "conexion_ml.sincronizacion_solicitada",
      entidadTipo: "conexion_ml",
      entidadId: conexion.id,
      detalle: { seller_id: conexion.sellerId },
    });
  } catch {
    return {
      ok: false,
      mensaje: "No pudimos pedir la sincronización por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  // Se publica por el PUERTO, no con `inngest.send` directo. La UI no debe
  // conocer el nombre del evento ni la llave de idempotencia: si cada pantalla
  // arma la suya, dos caminos que piden lo mismo dejan de deduplicarse entre sí
  // (pasó: el portal usaba `ml-sync-solicitada-…` y el panel del courier
  // `ml-sync-…`, así que apretar en ambos lanzaba dos barridos de la MISMA
  // conexión). La ventana anti-machaque real vive en `solicitarSincronizacionMl`.
  try {
    await solicitarSincronizacionMl({
      conexionId: conexion.id,
      sellerId: conexion.sellerId,
      tenantId: conexion.tenantId,
      actorUsuarioId: sesion.usuarioId,
    });
  } catch {
    return {
      ok: false,
      mensaje: "No pudimos pedir la sincronización por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  return { ok: true };
}


// ---------------------------------------------------------------------------
// Desconectar una cuenta de Mercado Libre
// ---------------------------------------------------------------------------

export type ResultadoDesconectar = { ok: true } | { ok: false; mensaje: string };

/** Un solo texto para los fallos que no son culpa de quien aprieta. */
const FALLO_SISTEMA =
  "No pudimos desconectar la cuenta por un problema de nuestro sistema. Intenta de nuevo en unos minutos.";

/**
 * Apaga la ingesta de UNA cuenta ML propia.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ HACE Y QUÉ NO — la decisión, del 26-08-2026
 * -----------------------------------------------------------------------------
 * Desconectar significa **dejar de traer pedidos a Rutax**, y nada más. NO le
 * revoca a Rutax el permiso sobre la cuenta de Mercado Libre: eso solo se hace
 * desde la propia cuenta del seller en ML, que además no documenta endpoint de
 * revocación. La pantalla lo dice con todas las letras, o el seller creería que
 * hizo algo que no hizo.
 *
 * El apagado no necesitó plomería nueva: la ingesta y el sondeo ya filtran
 * `estado_salud <> 'desvinculada'`.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL ORDEN DE LAS TRES ESCRITURAS
 * -----------------------------------------------------------------------------
 * 1. **Bitácora**, antes de tocar nada (CLAUDE.md: «bitácora antes que efectos
 *    externos, y con autor»). Si falla, no se desconecta: sin registro no hay
 *    quién responda por una cuenta apagada.
 * 2. **La fila**: estado, marca de tiempo, autor, y las referencias a los
 *    tokens en `null`.
 * 3. **Los secretos**, al final. Soltar la referencia ANTES de borrar es lo que
 *    evita la ventana en la que la conexión apunta a un secreto que ya no
 *    existe — ahí cualquier job que la lea falla al descifrar y la marca
 *    desvinculada con un error que no significa nada.
 *
 * ⚠️ Si el paso 3 falla, la cuenta **ya está desconectada** y eso es lo que la
 * persona pidió: se devuelve `ok`. Un secreto huérfano es basura, no un
 * agujero — nadie lo puede resolver porque su referencia ya no existe en
 * ninguna fila. Devolver error acá invitaría a reintentar algo que ya está
 * hecho.
 */
export async function desconectarConexionMlPropia(
  conexionId: string,
): Promise<ResultadoDesconectar> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "No hay una sesión de seller activa." };
  }
  if (!puedeGestionarConexionMlPropia(sesion.usuario)) {
    return { ok: false, mensaje: "Tu cuenta no tiene permiso para gestionar esta conexión." };
  }

  // ⚠️ La propiedad se comprueba contra las conexiones DEL SELLER DE LA SESIÓN,
  // nunca contra lo que mande el cliente. Mismo patrón que renombrar y
  // sincronizar.
  let propias: Awaited<ReturnType<typeof obtenerConexionesPorSeller>>;
  try {
    propias = await obtenerConexionesPorSeller(sesion.usuario.sellerId);
  } catch {
    return { ok: false, mensaje: FALLO_SISTEMA };
  }

  const conexion = propias.find((c) => c.id === conexionId);
  if (!conexion) {
    // Ni se confirma ni se niega que la fila exista: el mismo mensaje genérico
    // que el resto de las acciones sobre una conexión ajena.
    return { ok: false, mensaje: "No encontramos esa cuenta entre las tuyas." };
  }

  const cliente = crearClienteServiceRole();

  /**
   * ⚠️ Las referencias a los tokens se leen ACÁ y no vienen en `conexion`.
   *
   * `ConexionSellerMl` no las expone a propósito: es el tipo que cruza hacia la
   * interfaz, y una referencia de secreto no tiene por qué viajar hasta ahí. Se
   * leen con `service_role`, se usan para borrar, y no salen de esta función.
   */
  const { data: refs } = await cliente
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select("access_token_ref, refresh_token_ref")
    .eq("id", conexion.id)
    .eq("tenant_id", conexion.tenantId)
    .maybeSingle();

  try {
    await registrarEnBitacora(cliente, {
      tenantId: conexion.tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "conexion_ml.desconectada",
      entidadTipo: "conexion_ml",
      entidadId: conexion.id,
      // Sin tokens ni referencias en el detalle: la bitácora se lee.
      detalle: { seller_id: conexion.sellerId, ml_user_id: conexion.mlUserId ?? null },
    });
  } catch {
    return { ok: false, mensaje: FALLO_SISTEMA };
  }

  const { error } = await cliente
    .schema("identidad")
    .from("conexiones_seller_ml")
    .update({
      estado_salud: "desvinculada",
      desconectada_desde: new Date().toISOString(),
      desconectada_por_usuario_id: sesion.usuarioId,
      access_token_ref: null,
      refresh_token_ref: null,
      token_expira_en: null,
      // El error anterior deja de aplicar: la cuenta no está rota, está apagada.
      ultimo_error: null,
    })
    .eq("id", conexion.id)
    .eq("tenant_id", conexion.tenantId);

  if (error) {
    return { ok: false, mensaje: FALLO_SISTEMA };
  }

  // Los secretos, al final y sin tumbar la operación si fallan. Ver el bloque de
  // arriba: llegados acá la cuenta ya no ingiere, que es lo que se pidió.
  try {
    await Promise.all([
      olvidarSecreto(refs?.access_token_ref as string | null, conexion.tenantId),
      olvidarSecreto(refs?.refresh_token_ref as string | null, conexion.tenantId),
    ]);
  } catch {
    // Silencio deliberado: no hay nada que la persona pueda hacer con esto, y
    // reintentar no cambiaría el estado de la conexión.
  }

  return { ok: true };
}
