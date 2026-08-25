"use server";

/**
 * Server Actions — Contactos de WhatsApp.
 * =============================================================================
 * El directorio de a quién le escribe Rutax por WhatsApp, por courier. Sin
 * filas acá, el motor de envío resuelve `sin_destinatarios` y no manda nada
 * nunca — silenciosamente, sin error. Esta pantalla es lo que le da dirección
 * postal a toda la integración.
 *
 * RBAC: `puedeGestionarContactosWhatsApp` — dueño, supervisor, coordinador.
 * NO administración (ver `modules/identidad/capacidades.ts`).
 *
 * -----------------------------------------------------------------------------
 * LO QUE DE VERDAD SE ADMINISTRA ACÁ ES UN CONSENTIMIENTO
 * -----------------------------------------------------------------------------
 * Agregar un teléfono es lo de menos. Lo que pesa es la casilla que dice «tengo
 * el consentimiento de este contacto»: es una AFIRMACIÓN de una persona del
 * courier sobre una persona de otra empresa, y es el respaldo que Meta pide si
 * el número empieza a recibir reportes.
 *
 * Por eso el consentimiento:
 *  · nace SIEMPRE en `pendiente` — dar de alta no otorga nada;
 *  · solo se otorga con un acto explícito y separado;
 *  · y cada cambio queda en `bitacora_auditoria` con `actorUsuarioId`, ANTES de
 *    responder. Sin el "quién" la declaración no vale como respaldo.
 *
 * El envío nunca consulta esta pantalla: filtra por `opt_in_estado='otorgado'`
 * dentro de la consulta misma, así que no hay forma de saltarse la barrera por
 * un olvido en la interfaz.
 *
 * -----------------------------------------------------------------------------
 * EL TELÉFONO ES DATO PERSONAL
 * -----------------------------------------------------------------------------
 * Se normaliza a E.164 antes de guardar (`normalizarTelefonoE164`) porque Meta
 * ACEPTA un número mal formado con un 200 y el mensaje simplemente no llega.
 * Y al devolverlo a la pantalla va enmascarado: el courier necesita reconocer
 * cuál de sus contactos es, no leer el número entero en cada listado.
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarContactosWhatsApp } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import {
  normalizarTelefonoE164,
  enmascararTelefono,
  MENSAJE_TELEFONO_INVALIDO,
} from "@/modules/integraciones/notificaciones/whatsapp";

// =============================================================================
// Tipos
// =============================================================================

export type RolContacto = "seller" | "courier" | "bodega";
export type EstadoConsentimiento = "pendiente" | "otorgado" | "revocado";

export interface ContactoFila {
  id: string;
  rol: RolContacto;
  sellerId: string | null;
  bodegaId: string | null;
  /** Nombre de la entidad a la que pertenece. Resuelto para mostrar. */
  perteneceA: string;
  /** `+56 9 **** 5571`. El número completo NO sale de la base a la pantalla. */
  telefonoEnmascarado: string;
  etiqueta: string | null;
  optInEstado: EstadoConsentimiento;
  optInEn: string | null;
}

export interface BodegaOpcion {
  id: string;
  nombre: string;
  sellerId: string;
  sellerNombre: string;
}

type ResultadoAccion = { ok: true } | { ok: false; mensaje: string };
type Respuesta<T> = { ok: true; datos: T } | { ok: false; mensaje: string };

const RUTA = "/configuracion/whatsapp";

/**
 * Puerta única de las cuatro acciones: sesión + RBAC + tenant.
 *
 * El `tenantId` sale SIEMPRE de la sesión y jamás de un parámetro — es la misma
 * regla que hizo que `/api/whatsapp/send` dejara de leerlo del body.
 */
async function exigirPermiso(): Promise<
  { ok: true; tenantId: string; usuarioId: string } | { ok: false; mensaje: string }
> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "Tu sesión no tiene un courier asociado." };
  }
  if (!puedeGestionarContactosWhatsApp(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "Los contactos de WhatsApp solo los puede cambiar el dueño, un supervisor o un coordinador.",
    };
  }
  return { ok: true, tenantId: sesion.usuario.tenantId, usuarioId: sesion.usuarioId };
}

// =============================================================================
// Listar
// =============================================================================

/**
 * ⚠️ ACÁ NO SE USA `embed` DE POSTGREST, Y NO ES POR GUSTO.
 *
 * Se comprobó contra la base (2026-08-25) y falla de dos maneras distintas:
 *
 *  · **Entre esquemas no existe.** Pedir `sellers(razon_social)` desde
 *    `integraciones.whatsapp_contactos` devuelve `PGRST200`: PostgREST busca la
 *    relación solo dentro del esquema del recurso, y `sellers` vive en
 *    `identidad`. Compila perfecto y revienta en ejecución.
 *  · **Dentro de `identidad` es ambiguo.** Entre `seller_bodegas` y `sellers`
 *    hay DOS claves foráneas —la simple y la compuesta por tenant— así que
 *    PostgREST devuelve `PGRST201` exigiendo desambiguar por el nombre del
 *    constraint. Atarse a un nombre de constraint es frágil: una migración que
 *    lo renombre rompe la pantalla sin tocar código.
 *
 * Con dos o tres consultas y un `Map` no hay nada de esto, y el volumen es de
 * decenas de filas por courier.
 */
async function mapaNombresSellers(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
): Promise<Map<string, string>> {
  const { data } = await cliente
    .schema("identidad")
    .from("sellers")
    .select("id, razon_social")
    .eq("tenant_id", tenantId);

  const filas = (data ?? []) as Array<{ id: string; razon_social: string }>;
  return new Map(filas.map((f) => [f.id, f.razon_social]));
}

/** Las bodegas activas del tenant, para el selector. */
export async function accionListarBodegasParaContactos(): Promise<Respuesta<BodegaOpcion[]>> {
  const permiso = await exigirPermiso();
  if (!permiso.ok) return permiso;

  const cliente = crearClienteServiceRole();
  const [{ data, error }, nombresSellers] = await Promise.all([
    cliente
      .schema("identidad")
      .from("seller_bodegas")
      .select("id, nombre, seller_id")
      .eq("tenant_id", permiso.tenantId)
      .eq("activa", true)
      .order("nombre"),
    mapaNombresSellers(cliente, permiso.tenantId),
  ]);

  if (error) {
    return { ok: false, mensaje: "No se pudieron cargar las bodegas." };
  }

  const filas = (data ?? []) as Array<{ id: string; nombre: string; seller_id: string }>;

  return {
    ok: true,
    datos: filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      sellerId: f.seller_id,
      sellerNombre: nombresSellers.get(f.seller_id) ?? "Seller sin nombre",
    })),
  };
}

export async function accionListarContactos(): Promise<Respuesta<ContactoFila[]>> {
  const permiso = await exigirPermiso();
  if (!permiso.ok) return permiso;

  const cliente = crearClienteServiceRole();

  // Tres consultas y no un `embed`, por el motivo largo que está arriba en
  // `mapaNombresSellers`. Van en paralelo: son independientes entre sí.
  const [contactos, nombresSellers, bodegas] = await Promise.all([
    cliente
      .schema("integraciones")
      .from("whatsapp_contactos")
      .select("id, rol, seller_id, bodega_id, telefono_e164, etiqueta, opt_in_estado, opt_in_en")
      .eq("tenant_id", permiso.tenantId)
      .order("rol")
      .order("creado_en"),
    mapaNombresSellers(cliente, permiso.tenantId),
    cliente
      .schema("identidad")
      .from("seller_bodegas")
      .select("id, nombre")
      .eq("tenant_id", permiso.tenantId),
  ]);

  if (contactos.error) {
    return { ok: false, mensaje: "No se pudieron cargar los contactos." };
  }

  const nombresBodegas = new Map(
    ((bodegas.data ?? []) as Array<{ id: string; nombre: string }>).map((b) => [b.id, b.nombre]),
  );

  const filas = (contactos.data ?? []) as Array<{
    id: string;
    rol: RolContacto;
    seller_id: string | null;
    bodega_id: string | null;
    telefono_e164: string;
    etiqueta: string | null;
    opt_in_estado: EstadoConsentimiento;
    opt_in_en: string | null;
  }>;

  return {
    ok: true,
    datos: filas.map((f) => ({
      id: f.id,
      rol: f.rol,
      sellerId: f.seller_id,
      bodegaId: f.bodega_id,
      perteneceA:
        f.rol === "seller"
          ? (nombresSellers.get(f.seller_id ?? "") ?? "Seller sin nombre")
          : f.rol === "bodega"
            ? (nombresBodegas.get(f.bodega_id ?? "") ?? "Bodega sin nombre")
            : "Tu equipo",
      telefonoEnmascarado: enmascararTelefono(f.telefono_e164),
      etiqueta: f.etiqueta,
      optInEstado: f.opt_in_estado,
      optInEn: f.opt_in_en,
    })),
  };
}

// =============================================================================
// Crear
// =============================================================================

export interface DatosNuevoContacto {
  rol: RolContacto;
  sellerId?: string | null;
  bodegaId?: string | null;
  telefono: string;
  etiqueta?: string | null;
  /** La afirmación del courier de que el contacto consintió. */
  declaraConsentimiento: boolean;
}

export async function accionCrearContacto(datos: DatosNuevoContacto): Promise<ResultadoAccion> {
  const permiso = await exigirPermiso();
  if (!permiso.ok) return permiso;

  // El teléfono, antes que nada: es la única barrera contra el fallo mudo de
  // Meta (acepta un número mal formado y responde 200; el mensaje no llega).
  const telefono = normalizarTelefonoE164(datos.telefono);
  if (!telefono.valido) {
    return { ok: false, mensaje: MENSAJE_TELEFONO_INVALIDO[telefono.motivo] };
  }

  // El rol manda cuál FK viaja. El CHECK de la base es la última red; acá se
  // atrapa antes para poder dar un mensaje que se entienda.
  const sellerId = datos.rol === "seller" ? (datos.sellerId ?? null) : null;
  const bodegaId = datos.rol === "bodega" ? (datos.bodegaId ?? null) : null;
  if (datos.rol === "seller" && !sellerId) {
    return { ok: false, mensaje: "Elige a qué seller pertenece este contacto." };
  }
  if (datos.rol === "bodega" && !bodegaId) {
    return { ok: false, mensaje: "Elige a qué bodega pertenece este contacto." };
  }

  const cliente = crearClienteServiceRole();

  // El consentimiento y su fecha viajan juntos o no viajan: el CHECK
  // `whatsapp_contactos_opt_in_fecha` rechaza un `otorgado` sin cuándo.
  const ahora = new Date().toISOString();
  const optIn = datos.declaraConsentimiento
    ? { opt_in_estado: "otorgado" as const, opt_in_en: ahora }
    : { opt_in_estado: "pendiente" as const, opt_in_en: null };

  const { data, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .insert({
      tenant_id: permiso.tenantId,
      rol: datos.rol,
      seller_id: sellerId,
      bodega_id: bodegaId,
      telefono_e164: telefono.telefonoE164,
      etiqueta: datos.etiqueta?.trim() || null,
      ...optIn,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = el índice único. Es el caso frecuente y merece un mensaje propio:
    // sin él, un alta duplicada manda el aviso dos veces y cada envío se cobra.
    if (error.code === "23505") {
      return { ok: false, mensaje: "Ese teléfono ya está registrado para este destino." };
    }
    return { ok: false, mensaje: "No se pudo guardar el contacto." };
  }

  await registrarEnBitacora(cliente, {
    tenantId: permiso.tenantId,
    actorUsuarioId: permiso.usuarioId,
    actorTipo: "usuario",
    accion: datos.declaraConsentimiento
      ? "whatsapp.contacto_creado_con_consentimiento"
      : "whatsapp.contacto_creado",
    entidadTipo: "whatsapp_contacto",
    entidadId: data.id as string,
    // El teléfono NO va en el detalle: es dato personal y `entidadId` alcanza
    // para llegar a él por join cuando alguien con permiso lo necesite.
    detalle: { rol: datos.rol, seller_id: sellerId, bodega_id: bodegaId },
  });

  revalidatePath(RUTA);
  return { ok: true };
}

// =============================================================================
// Consentimiento
// =============================================================================

/**
 * Otorgar o revocar el consentimiento de un contacto ya existente.
 *
 * Es la acción con más peso de la pantalla y por eso está separada del alta: no
 * se otorga un consentimiento "de paso" mientras se corrige una etiqueta.
 */
export async function accionCambiarConsentimiento(
  contactoId: string,
  otorgar: boolean,
): Promise<ResultadoAccion> {
  const permiso = await exigirPermiso();
  if (!permiso.ok) return permiso;

  const cliente = crearClienteServiceRole();

  // El filtro por tenant va en el UPDATE, no en una comprobación previa: así no
  // hay ventana entre leer y escribir, y un id de otro courier afecta 0 filas.
  const { data, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .update(
      otorgar
        ? { opt_in_estado: "otorgado", opt_in_en: new Date().toISOString() }
        : { opt_in_estado: "revocado" },
    )
    .eq("id", contactoId)
    .eq("tenant_id", permiso.tenantId)
    .select("id");

  if (error) return { ok: false, mensaje: "No se pudo cambiar el consentimiento." };
  if (!data || data.length === 0) {
    return { ok: false, mensaje: "Ese contacto ya no existe." };
  }

  await registrarEnBitacora(cliente, {
    tenantId: permiso.tenantId,
    actorUsuarioId: permiso.usuarioId,
    actorTipo: "usuario",
    accion: otorgar ? "whatsapp.consentimiento_otorgado" : "whatsapp.consentimiento_revocado",
    entidadTipo: "whatsapp_contacto",
    entidadId: contactoId,
    detalle: { origen: "pantalla_courier" },
  });

  revalidatePath(RUTA);
  return { ok: true };
}

// =============================================================================
// Eliminar
// =============================================================================

export async function accionEliminarContacto(contactoId: string): Promise<ResultadoAccion> {
  const permiso = await exigirPermiso();
  if (!permiso.ok) return permiso;

  const cliente = crearClienteServiceRole();

  // La bitácora ANTES del efecto (invariante del proyecto): si el DELETE falla,
  // sobra una entrada de auditoría; si fuera al revés y fallara el registro,
  // faltaría la evidencia de un borrado que sí ocurrió.
  await registrarEnBitacora(cliente, {
    tenantId: permiso.tenantId,
    actorUsuarioId: permiso.usuarioId,
    actorTipo: "usuario",
    accion: "whatsapp.contacto_eliminado",
    entidadTipo: "whatsapp_contacto",
    entidadId: contactoId,
    detalle: {},
  });

  const { error } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .delete()
    .eq("id", contactoId)
    .eq("tenant_id", permiso.tenantId);

  if (error) return { ok: false, mensaje: "No se pudo eliminar el contacto." };

  revalidatePath(RUTA);
  return { ok: true };
}
