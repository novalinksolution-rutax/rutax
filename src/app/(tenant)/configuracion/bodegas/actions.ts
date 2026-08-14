"use server";

/**
 * Server Actions — Bodegas (etapas 2 y 2b de "retiro en bodega + ruteo").
 *
 * Dos tablas, una pantalla: `identidad.seller_bodegas` (dónde retira el
 * conductor, por seller) e `identidad.courier_bodegas` (de dónde sale la
 * flota a repartir — ver `supabase/migrations/20260813000002_identidad_bodegas_seller_courier.sql`).
 * Comparten casi toda su lógica: las acciones "simples" (desactivar/
 * reactivar/marcar principal/promover/reintentar ubicación) toman un
 * `tipo: TipoBodega` explícito en vez de duplicarse; crear y editar sí se
 * separan por tipo porque difieren en forma (seller_id, campos de contacto).
 *
 * RBAC: `puedeGestionarBodegas` — dueño, supervisor, coordinador. NO
 * administración (ver `modules/identidad/capacidades.ts`).
 *
 * Geocoding: síncrono, vía `resolverCoordenadaConCache` (cache global +
 * `TIMEOUT_GEOCODING_SINCRONO_MS`). NUNCA bloquea el guardado — una falla de
 * red/timeout/config se traduce a `no_resuelto` y la bodega se guarda igual
 * (handoff §5 de la migración citada arriba).
 *
 * Principal, sin transacción real: PostgREST no da transacciones multi-fila
 * desde el cliente y esta migración no agrega funciones SQL nuevas. Donde
 * hace falta "desmarcar la anterior y marcar la nueva", se hace en dos
 * UPDATE secuenciales, en el orden que deja el sistema en un estado VÁLIDO
 * (aunque no ideal: "sin principal") si el segundo paso llegara a fallar —
 * nunca en un estado que viole el CHECK `principal_debe_estar_activa`.
 *
 * Refresco: cada mutación exitosa espera que el cliente vuelva a pedir la
 * lista completa (`accionListarBodegasSeller`/`Courier`) en vez de parchear
 * estado a mano — más simple y sin riesgo de reconciliación a medias cuando
 * una acción toca dos filas (p. ej. cambiar la principal).
 *
 * Auditoría: cada mutación registra en bitácora antes de responder (invariante
 * CLAUDE.md). Listar y "reintentar ubicación" no auditan — mismo criterio que
 * `accionReubicarPedido` (operaciones/[pedidoId]/actions-geocoding.ts).
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarBodegas } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import {
  resolverCoordenadaConCache,
  TIMEOUT_GEOCODING_SINCRONO_MS,
  ErrorGeocodingConfig,
} from "@/modules/integraciones/geocoding";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import type { EstadoGeocoding } from "@/modules/operacion/tipos";

// =============================================================================
// Tipos
// =============================================================================

export type TipoBodega = "seller" | "courier";

export interface BodegaFila {
  id: string;
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso: string | null;
  /** Siempre `null` para `tipo === "courier"` — esa tabla no tiene estas columnas. */
  contactoNombre: string | null;
  contactoTelefono: string | null;
  esPrincipal: boolean;
  activa: boolean;
  geoEstado: EstadoGeocoding;
}

type ResultadoAccion = { ok: true } | { ok: false; mensaje: string };
type RespuestaOk<T> = { ok: true; datos: T };
type RespuestaError = { ok: false; mensaje: string };
type Respuesta<T> = RespuestaOk<T> | RespuestaError;

type Tabla = "seller_bodegas" | "courier_bodegas";

function tablaDeTipo(tipo: TipoBodega): Tabla {
  return tipo === "seller" ? "seller_bodegas" : "courier_bodegas";
}

// =============================================================================
// Guardia RBAC — compartida por las 11 acciones exportadas de abajo.
// =============================================================================

async function exigirGestorDeBodegas(): Promise<
  { ok: true; tenantId: string; usuarioId: string } | RespuestaError
> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }
  if (!puedeGestionarBodegas(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para gestionar bodegas." };
  }
  return { ok: true, tenantId: sesion.usuario.tenantId, usuarioId: sesion.usuarioId };
}

// =============================================================================
// Helpers puros
// =============================================================================

function mapearFila(fila: Record<string, unknown>): BodegaFila {
  return {
    id: fila.id as string,
    nombre: fila.nombre as string,
    direccion: fila.direccion as string,
    comuna: fila.comuna as string,
    instruccionesAcceso: (fila.instrucciones_acceso as string | null) ?? null,
    contactoNombre: (fila.contacto_nombre as string | null) ?? null,
    contactoTelefono: (fila.contacto_telefono as string | null) ?? null,
    esPrincipal: fila.es_principal as boolean,
    activa: fila.activa as boolean,
    geoEstado: ((fila.geo_estado as string | null) ?? "pendiente") as EstadoGeocoding,
  };
}

/** Traduce errores frecuentes de Postgres a un mensaje que un operador entiende. */
function mensajeDeError(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("seller_bodegas_nombre_activa_uk")) {
      return "Ya existe una bodega activa con ese nombre para este seller.";
    }
    if (msg.includes("courier_bodegas_tenant_nombre_uk")) {
      return "Ya existe una bodega con ese nombre.";
    }
    if (msg.includes("_principal_uk")) {
      return "Ya hay otra bodega marcada como principal — vuelve a intentarlo.";
    }
    if (msg.includes("seller_bodegas_seller_pertenece_al_tenant")) {
      return "Ese seller no pertenece a tu courier.";
    }
    return msg || fallback;
  }
  return fallback;
}

interface CamposBodegaForm {
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  esPrincipalSolicitado: boolean;
}

function leerCamposBodega(
  formData: FormData,
  opciones: { conContacto: boolean },
): { ok: true; valores: CamposBodegaForm } | RespuestaError {
  const nombre = String(formData.get("nombre") ?? "").trim();
  const direccion = String(formData.get("direccion") ?? "").trim();
  const comuna = String(formData.get("comuna") ?? "").trim();
  const instruccionesAcceso = String(formData.get("instrucciones_acceso") ?? "").trim() || null;
  const contactoNombre = opciones.conContacto
    ? String(formData.get("contacto_nombre") ?? "").trim() || null
    : null;
  const contactoTelefono = opciones.conContacto
    ? String(formData.get("contacto_telefono") ?? "").trim() || null
    : null;
  const esPrincipalSolicitado = formData.get("es_principal") === "true";

  if (!nombre) return { ok: false, mensaje: "El nombre de la bodega es obligatorio." };
  if (!direccion) return { ok: false, mensaje: "La dirección es obligatoria." };
  if (!comuna) return { ok: false, mensaje: "Selecciona una comuna." };
  if (!(COMUNAS_RM as readonly string[]).includes(comuna)) {
    return { ok: false, mensaje: "La comuna seleccionada no es válida." };
  }

  return {
    ok: true,
    valores: { nombre, direccion, comuna, instruccionesAcceso, contactoNombre, contactoTelefono, esPrincipalSolicitado },
  };
}

/**
 * Geocoding síncrono que NUNCA lanza: una falla de red/timeout/config se
 * traduce a `no_resuelto` y el llamador guarda la bodega igual (handoff §5 de
 * la migración de bodegas). `geocodificadoEn` se marca con el momento del
 * intento, resuelva o no.
 */
async function resolverGeoBodega(direccion: string, comuna: string): Promise<{
  lat: number | null;
  long: number | null;
  geoEstado: EstadoGeocoding;
  geoConfianza: number | null;
  geocodificadoEn: string;
}> {
  const ahora = new Date().toISOString();
  try {
    const resultado = await resolverCoordenadaConCache({
      direccion,
      comuna,
      timeoutMs: TIMEOUT_GEOCODING_SINCRONO_MS,
    });
    return {
      lat: resultado.lat,
      long: resultado.long,
      geoEstado: resultado.estado as EstadoGeocoding,
      geoConfianza: resultado.confianza,
      geocodificadoEn: ahora,
    };
  } catch (error) {
    // No lanzar sigue siendo correcto —la bodega se guarda igual, y bloquear el
    // alta por un hipo del proveedor sería peor—, pero tragarse el error sin
    // dejar rastro no lo es: la pantalla dice "revisa que la dirección esté
    // bien escrita" y el operador corrige una dirección que estaba perfecta,
    // mientras la causa real (proveedor mal configurado, cuota agotada, red)
    // no aparece en ninguna parte. Pasó en producción el 2026-08-13 con una
    // dirección válida de Macul.
    //
    // `ErrorGeocodingConfig` se distingue a propósito: significa que el
    // problema NO es la dirección sino el entorno —`GEOCODING_PROVIDER=google`
    // sin `GOOGLE_MAPS_API_KEY`, o un proveedor no reconocido— y esa diferencia
    // decide si el operador tiene algo que corregir o no tiene nada que hacer.
    const esConfig = error instanceof ErrorGeocodingConfig;
    console.error(
      esConfig
        ? "[bodegas] geocoding MAL CONFIGURADO — no es la dirección, es el entorno:"
        : "[bodegas] geocoding falló:",
      error,
    );
    return { lat: null, long: null, geoEstado: "no_resuelto", geoConfianza: null, geocodificadoEn: ahora };
  }
}

// =============================================================================
// Internos — un solo lugar por operación, compartido entre "seller" y "courier".
// =============================================================================

async function listarBodegasInterno(
  cliente: SupabaseClient,
  args: { tenantId: string; tabla: Tabla; sellerId?: string },
): Promise<BodegaFila[]> {
  let query = cliente
    .schema("identidad")
    .from(args.tabla)
    // "*" y no una lista de columnas: postgrest-js analiza el string de
    // `.select()` en tiempo de compilación, y solo sabe hacerlo con literales
    // — una lista armada dinámicamente (courier_bodegas no tiene columnas de
    // contacto) cae a `GenericStringError`. Ninguna columna de estas tablas
    // es secreta; `mapearFila` solo toma los campos que necesita.
    .select("*")
    .eq("tenant_id", args.tenantId)
    .order("activa", { ascending: false })
    .order("es_principal", { ascending: false })
    .order("nombre", { ascending: true });

  if (args.tabla === "seller_bodegas" && args.sellerId) {
    query = query.eq("seller_id", args.sellerId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => mapearFila(f as Record<string, unknown>));
}

async function crearBodegaInterno(
  cliente: SupabaseClient,
  args: { tenantId: string; tabla: Tabla; sellerId?: string } & CamposBodegaForm,
): Promise<string> {
  // 1 · ¿Es la primera bodega de este seller/courier? Cuenta TODA fila (activa
  //     o no) — "primera" es ordinal, no "sin principal actual".
  let countQuery = cliente
    .schema("identidad")
    .from(args.tabla)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", args.tenantId);
  if (args.tabla === "seller_bodegas") countQuery = countQuery.eq("seller_id", args.sellerId as string);
  const { count, error: countError } = await countQuery;
  if (countError) throw new Error(countError.message);

  const esPrimera = (count ?? 0) === 0;
  const esPrincipalFinal = esPrimera || args.esPrincipalSolicitado;

  // 2 · Si va a nacer principal y no es la primera, desmarcar la anterior
  //     ANTES de insertar (índice parcial: como máximo una por seller/tenant).
  if (esPrincipalFinal && !esPrimera) {
    let unset = cliente
      .schema("identidad")
      .from(args.tabla)
      .update({ es_principal: false })
      .eq("tenant_id", args.tenantId)
      .eq("es_principal", true);
    if (args.tabla === "seller_bodegas") unset = unset.eq("seller_id", args.sellerId as string);
    const { error: unsetError } = await unset;
    if (unsetError) throw new Error(unsetError.message);
  }

  // 3 · Geocoding síncrono, nunca bloqueante.
  const geo = await resolverGeoBodega(args.direccion, args.comuna);

  const payload: Record<string, unknown> = {
    tenant_id: args.tenantId,
    nombre: args.nombre,
    direccion: args.direccion,
    comuna: args.comuna,
    instrucciones_acceso: args.instruccionesAcceso,
    es_principal: esPrincipalFinal,
    activa: true,
    lat: geo.lat,
    long: geo.long,
    geo_estado: geo.geoEstado,
    geo_confianza: geo.geoConfianza,
    geocodificado_en: geo.geocodificadoEn,
  };
  if (args.tabla === "seller_bodegas") {
    payload.seller_id = args.sellerId;
    payload.contacto_nombre = args.contactoNombre;
    payload.contacto_telefono = args.contactoTelefono;
  }

  const { data, error } = await cliente
    .schema("identidad")
    .from(args.tabla)
    .insert(payload)
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

async function editarBodegaInterno(
  cliente: SupabaseClient,
  args: { tenantId: string; tabla: Tabla; id: string } & CamposBodegaForm,
): Promise<void> {
  // "*" por el mismo motivo que en `listarBodegasInterno`: el string de
  // `.select()` se analiza en compilación y no acepta una lista armada en
  // runtime.
  const { data: actual, error: errorActual } = await cliente
    .schema("identidad")
    .from(args.tabla)
    .select("*")
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();

  if (errorActual) throw new Error(errorActual.message);
  if (!actual) throw new Error("La bodega no existe o no pertenece a este courier.");
  if (!(actual.activa as boolean)) {
    throw new Error("No se puede editar una bodega inactiva — reactívala primero.");
  }

  const eraPrincipal = actual.es_principal as boolean;

  // Si pasa de NO-principal a SÍ-principal: desmarcar cualquier otra antes de
  // guardar. Si pasa de SÍ a NO, o se queda igual, no hace falta tocar otras
  // filas — el CHECK solo exige que una principal esté activa, no que exista alguna.
  if (args.esPrincipalSolicitado && !eraPrincipal) {
    let unset = cliente
      .schema("identidad")
      .from(args.tabla)
      .update({ es_principal: false })
      .eq("tenant_id", args.tenantId)
      .eq("es_principal", true);
    if (args.tabla === "seller_bodegas") {
      unset = unset.eq("seller_id", actual.seller_id as string);
    }
    const { error: unsetError } = await unset;
    if (unsetError) throw new Error(unsetError.message);
  }

  const geo = await resolverGeoBodega(args.direccion, args.comuna);

  const payload: Record<string, unknown> = {
    nombre: args.nombre,
    direccion: args.direccion,
    comuna: args.comuna,
    instrucciones_acceso: args.instruccionesAcceso,
    es_principal: args.esPrincipalSolicitado,
    lat: geo.lat,
    long: geo.long,
    geo_estado: geo.geoEstado,
    geo_confianza: geo.geoConfianza,
    geocodificado_en: geo.geocodificadoEn,
  };
  if (args.tabla === "seller_bodegas") {
    payload.contacto_nombre = args.contactoNombre;
    payload.contacto_telefono = args.contactoTelefono;
  }

  const { error } = await cliente
    .schema("identidad")
    .from(args.tabla)
    .update(payload)
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId);

  if (error) throw new Error(error.message);
}

async function desactivarBodegaInterno(
  cliente: SupabaseClient,
  args: { tenantId: string; tabla: Tabla; id: string },
): Promise<void> {
  // Siempre las DOS columnas juntas: el CHECK `principal_debe_estar_activa`
  // rechaza `activa=false` mientras `es_principal` siga en `true`.
  const { error } = await cliente
    .schema("identidad")
    .from(args.tabla)
    .update({ activa: false, es_principal: false })
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId);

  if (error) throw new Error(error.message);
}

async function reactivarBodegaInterno(
  cliente: SupabaseClient,
  args: { tenantId: string; tabla: Tabla; id: string },
): Promise<void> {
  // No restaura `es_principal`: la desactivación siempre lo dejó en `false`
  // y reactivar no debe crear una segunda principal por sorpresa.
  const { error } = await cliente
    .schema("identidad")
    .from(args.tabla)
    .update({ activa: true })
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId);

  if (error) throw new Error(error.message);
}

async function marcarPrincipalInterno(
  cliente: SupabaseClient,
  args: { tenantId: string; tabla: Tabla; id: string },
): Promise<void> {
  const { data: actual, error: errorActual } = await cliente
    .schema("identidad")
    .from(args.tabla)
    .select("*")
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();

  if (errorActual) throw new Error(errorActual.message);
  if (!actual) throw new Error("La bodega no existe o no pertenece a este courier.");
  if (!(actual.activa as boolean)) {
    throw new Error("Solo una bodega activa puede ser la principal.");
  }

  let unset = cliente
    .schema("identidad")
    .from(args.tabla)
    .update({ es_principal: false })
    .eq("tenant_id", args.tenantId)
    .eq("es_principal", true);
  if (args.tabla === "seller_bodegas") unset = unset.eq("seller_id", actual.seller_id as string);
  const { error: unsetError } = await unset;
  if (unsetError) throw new Error(unsetError.message);

  const { error } = await cliente
    .schema("identidad")
    .from(args.tabla)
    .update({ es_principal: true })
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId);

  if (error) throw new Error(error.message);
}

async function promoverYDesactivarInterno(
  cliente: SupabaseClient,
  args: { tenantId: string; tabla: Tabla; idADesactivar: string; idNuevaPrincipal: string },
): Promise<void> {
  if (args.idADesactivar === args.idNuevaPrincipal) {
    throw new Error("Elige una bodega distinta para reemplazarla.");
  }

  // Paso A: desactivar Y despriorizar en el MISMO update — si no, el CHECK
  // rechaza el `activa=false` mientras `es_principal` siga en `true`.
  const { error: errA } = await cliente
    .schema("identidad")
    .from(args.tabla)
    .update({ activa: false, es_principal: false })
    .eq("id", args.idADesactivar)
    .eq("tenant_id", args.tenantId);
  if (errA) throw new Error(errA.message);

  // Paso B: promover la nueva (debe seguir activa). Si este paso fallara, el
  // seller/courier queda sin principal — estado válido, recuperable con
  // "Marcar como principal".
  const { error: errB } = await cliente
    .schema("identidad")
    .from(args.tabla)
    .update({ es_principal: true })
    .eq("id", args.idNuevaPrincipal)
    .eq("tenant_id", args.tenantId)
    .eq("activa", true);
  if (errB) throw new Error(errB.message);
}

async function reintentarUbicacionInterno(
  cliente: SupabaseClient,
  args: { tenantId: string; tabla: Tabla; id: string },
): Promise<void> {
  const { data: actual, error: errorActual } = await cliente
    .schema("identidad")
    .from(args.tabla)
    .select("direccion, comuna")
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();

  if (errorActual) throw new Error(errorActual.message);
  if (!actual) throw new Error("La bodega no existe.");

  const geo = await resolverGeoBodega(actual.direccion as string, actual.comuna as string);

  const { error } = await cliente
    .schema("identidad")
    .from(args.tabla)
    .update({
      lat: geo.lat,
      long: geo.long,
      geo_estado: geo.geoEstado,
      geo_confianza: geo.geoConfianza,
      geocodificado_en: geo.geocodificadoEn,
    })
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId);

  if (error) throw new Error(error.message);
}

// =============================================================================
// Acciones exportadas — listar
// =============================================================================

export async function accionListarBodegasSeller(sellerId: string): Promise<Respuesta<BodegaFila[]>> {
  const guardia = await exigirGestorDeBodegas();
  if (!guardia.ok) return guardia;

  try {
    const cliente = crearClienteServiceRole();
    const datos = await listarBodegasInterno(cliente, {
      tenantId: guardia.tenantId,
      tabla: "seller_bodegas",
      sellerId,
    });
    return { ok: true, datos };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "No se pudieron cargar las bodegas del seller.") };
  }
}

export async function accionListarBodegasCourier(): Promise<Respuesta<BodegaFila[]>> {
  const guardia = await exigirGestorDeBodegas();
  if (!guardia.ok) return guardia;

  try {
    const cliente = crearClienteServiceRole();
    const datos = await listarBodegasInterno(cliente, {
      tenantId: guardia.tenantId,
      tabla: "courier_bodegas",
    });
    return { ok: true, datos };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "No se pudieron cargar tus bodegas.") };
  }
}

// =============================================================================
// Acciones exportadas — crear
// =============================================================================

export async function accionCrearBodegaSeller(sellerId: string, formData: FormData): Promise<ResultadoAccion> {
  const guardia = await exigirGestorDeBodegas();
  if (!guardia.ok) return guardia;
  if (!sellerId) return { ok: false, mensaje: "Falta el seller." };

  const campos = leerCamposBodega(formData, { conContacto: true });
  if (!campos.ok) return campos;

  try {
    const cliente = crearClienteServiceRole();
    const id = await crearBodegaInterno(cliente, {
      tenantId: guardia.tenantId,
      tabla: "seller_bodegas",
      sellerId,
      ...campos.valores,
    });

    await registrarEnBitacora(cliente, {
      tenantId: guardia.tenantId,
      actorUsuarioId: guardia.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.bodega_seller_creada",
      entidadTipo: "bodega_seller",
      entidadId: id,
      detalle: { seller_id: sellerId, nombre: campos.valores.nombre, comuna: campos.valores.comuna },
    });

    revalidatePath("/configuracion/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "No se pudo crear la bodega.") };
  }
}

export async function accionCrearBodegaCourier(formData: FormData): Promise<ResultadoAccion> {
  const guardia = await exigirGestorDeBodegas();
  if (!guardia.ok) return guardia;

  const campos = leerCamposBodega(formData, { conContacto: false });
  if (!campos.ok) return campos;

  try {
    const cliente = crearClienteServiceRole();
    const id = await crearBodegaInterno(cliente, {
      tenantId: guardia.tenantId,
      tabla: "courier_bodegas",
      ...campos.valores,
    });

    await registrarEnBitacora(cliente, {
      tenantId: guardia.tenantId,
      actorUsuarioId: guardia.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.bodega_courier_creada",
      entidadTipo: "bodega_courier",
      entidadId: id,
      detalle: { nombre: campos.valores.nombre, comuna: campos.valores.comuna },
    });

    revalidatePath("/configuracion/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "No se pudo crear la bodega.") };
  }
}

// =============================================================================
// Acciones exportadas — editar
// =============================================================================

export async function accionEditarBodegaSeller(id: string, formData: FormData): Promise<ResultadoAccion> {
  const guardia = await exigirGestorDeBodegas();
  if (!guardia.ok) return guardia;

  const campos = leerCamposBodega(formData, { conContacto: true });
  if (!campos.ok) return campos;

  try {
    const cliente = crearClienteServiceRole();
    await editarBodegaInterno(cliente, { tenantId: guardia.tenantId, tabla: "seller_bodegas", id, ...campos.valores });

    await registrarEnBitacora(cliente, {
      tenantId: guardia.tenantId,
      actorUsuarioId: guardia.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.bodega_seller_editada",
      entidadTipo: "bodega_seller",
      entidadId: id,
      detalle: { nombre: campos.valores.nombre, comuna: campos.valores.comuna },
    });

    revalidatePath("/configuracion/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "No se pudo editar la bodega.") };
  }
}

export async function accionEditarBodegaCourier(id: string, formData: FormData): Promise<ResultadoAccion> {
  const guardia = await exigirGestorDeBodegas();
  if (!guardia.ok) return guardia;

  const campos = leerCamposBodega(formData, { conContacto: false });
  if (!campos.ok) return campos;

  try {
    const cliente = crearClienteServiceRole();
    await editarBodegaInterno(cliente, { tenantId: guardia.tenantId, tabla: "courier_bodegas", id, ...campos.valores });

    await registrarEnBitacora(cliente, {
      tenantId: guardia.tenantId,
      actorUsuarioId: guardia.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.bodega_courier_editada",
      entidadTipo: "bodega_courier",
      entidadId: id,
      detalle: { nombre: campos.valores.nombre, comuna: campos.valores.comuna },
    });

    revalidatePath("/configuracion/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "No se pudo editar la bodega.") };
  }
}

// =============================================================================
// Acciones exportadas — desactivar / reactivar / principal / reintentar
// =============================================================================

export async function accionDesactivarBodega(tipo: TipoBodega, id: string): Promise<ResultadoAccion> {
  const guardia = await exigirGestorDeBodegas();
  if (!guardia.ok) return guardia;

  try {
    const cliente = crearClienteServiceRole();
    await desactivarBodegaInterno(cliente, { tenantId: guardia.tenantId, tabla: tablaDeTipo(tipo), id });

    await registrarEnBitacora(cliente, {
      tenantId: guardia.tenantId,
      actorUsuarioId: guardia.usuarioId,
      actorTipo: "usuario",
      accion: `identidad.bodega_${tipo}_desactivada`,
      entidadTipo: `bodega_${tipo}`,
      entidadId: id,
      detalle: {},
    });

    revalidatePath("/configuracion/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "No se pudo desactivar la bodega.") };
  }
}

export async function accionReactivarBodega(tipo: TipoBodega, id: string): Promise<ResultadoAccion> {
  const guardia = await exigirGestorDeBodegas();
  if (!guardia.ok) return guardia;

  try {
    const cliente = crearClienteServiceRole();
    await reactivarBodegaInterno(cliente, { tenantId: guardia.tenantId, tabla: tablaDeTipo(tipo), id });

    await registrarEnBitacora(cliente, {
      tenantId: guardia.tenantId,
      actorUsuarioId: guardia.usuarioId,
      actorTipo: "usuario",
      accion: `identidad.bodega_${tipo}_reactivada`,
      entidadTipo: `bodega_${tipo}`,
      entidadId: id,
      detalle: {},
    });

    revalidatePath("/configuracion/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "No se pudo reactivar la bodega.") };
  }
}

export async function accionMarcarPrincipal(tipo: TipoBodega, id: string): Promise<ResultadoAccion> {
  const guardia = await exigirGestorDeBodegas();
  if (!guardia.ok) return guardia;

  try {
    const cliente = crearClienteServiceRole();
    await marcarPrincipalInterno(cliente, { tenantId: guardia.tenantId, tabla: tablaDeTipo(tipo), id });

    await registrarEnBitacora(cliente, {
      tenantId: guardia.tenantId,
      actorUsuarioId: guardia.usuarioId,
      actorTipo: "usuario",
      accion: `identidad.bodega_${tipo}_marcada_principal`,
      entidadTipo: `bodega_${tipo}`,
      entidadId: id,
      detalle: {},
    });

    revalidatePath("/configuracion/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "No se pudo marcar como principal.") };
  }
}

export async function accionPromoverYDesactivar(
  tipo: TipoBodega,
  idADesactivar: string,
  idNuevaPrincipal: string,
): Promise<ResultadoAccion> {
  const guardia = await exigirGestorDeBodegas();
  if (!guardia.ok) return guardia;
  if (!idNuevaPrincipal) return { ok: false, mensaje: "Selecciona la bodega que la reemplazará." };

  try {
    const cliente = crearClienteServiceRole();
    await promoverYDesactivarInterno(cliente, {
      tenantId: guardia.tenantId,
      tabla: tablaDeTipo(tipo),
      idADesactivar,
      idNuevaPrincipal,
    });

    await registrarEnBitacora(cliente, {
      tenantId: guardia.tenantId,
      actorUsuarioId: guardia.usuarioId,
      actorTipo: "usuario",
      accion: `identidad.bodega_${tipo}_promovida_y_desactivada`,
      entidadTipo: `bodega_${tipo}`,
      entidadId: idNuevaPrincipal,
      detalle: { bodega_desactivada_id: idADesactivar },
    });

    revalidatePath("/configuracion/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "No se pudo completar el reemplazo.") };
  }
}

export async function accionReintentarUbicacion(tipo: TipoBodega, id: string): Promise<ResultadoAccion> {
  const guardia = await exigirGestorDeBodegas();
  if (!guardia.ok) return guardia;

  try {
    const cliente = crearClienteServiceRole();
    await reintentarUbicacionInterno(cliente, { tenantId: guardia.tenantId, tabla: tablaDeTipo(tipo), id });
    revalidatePath("/configuracion/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "No se pudo reintentar la ubicación.") };
  }
}
