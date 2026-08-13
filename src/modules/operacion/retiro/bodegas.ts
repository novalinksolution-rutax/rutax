/**
 * Bodegas del retiro — el catálogo que ve el conductor para elegir a dónde va
 * (`GET /bodegas`, sin dirección ni contacto) y la apertura de la visita
 * (`POST /`, que SÍ devuelve la dirección y el contacto, pero SOLO de la
 * bodega que se acaba de abrir).
 *
 * El conductor NO tiene acceso propio a `identidad.seller_bodegas` (la
 * política de esa tabla es P1 tenant + P2 seller — el conductor no es
 * ninguno de los dos, ve CERO filas por diseño, migración 20260813000002
 * §1). Por eso este módulo corre con `service_role` y expone el mínimo
 * necesario para cada pantalla, igual que `dto-pedido.ts` para `pedidos`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ErrorNoEncontrado } from "@/modules/identidad/errores";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { resolverNombresSellers } from "./dto-pedido";

// =============================================================================
// Catálogo — GET /bodegas (sin dirección ni contacto)
// =============================================================================

export interface BodegaListado {
  id: string;
  nombre: string;
  comuna: string;
  sellerId: string;
  sellerNombre: string;
}

interface FilaSellerBodegaListado {
  id: string;
  nombre: string;
  comuna: string;
  seller_id: string;
}

/**
 * Bodegas ACTIVAS del tenant, sin `direccion`, `instrucciones_acceso`,
 * `contacto_nombre` ni `contacto_telefono` — el conductor recién ve esos
 * datos de la bodega que efectivamente abre (`abrirVisitaBodega`).
 */
export async function listarBodegasParaConductor(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<BodegaListado[]> {
  const { data, error } = await cliente
    .from("seller_bodegas")
    .select("id, nombre, comuna, seller_id")
    .eq("tenant_id", tenantId)
    .eq("activa", true)
    .order("nombre", { ascending: true });

  if (error) {
    throw new Error(`Error al listar bodegas para el retiro: ${error.message}`);
  }

  const filas = (data ?? []) as FilaSellerBodegaListado[];
  const nombresSellers = await resolverNombresSellers(
    cliente,
    tenantId,
    filas.map((f) => f.seller_id),
  );

  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    comuna: f.comuna,
    sellerId: f.seller_id,
    sellerNombre: nombresSellers.get(f.seller_id) ?? "",
  }));
}

// =============================================================================
// Abrir visita — POST / (dirección + contacto SOLO de esta bodega)
// =============================================================================

export interface BodegaDetalle {
  id: string;
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  sellerId: string;
  sellerNombre: string;
}

export interface SesionRetiroResumen {
  id: string;
  estado: "abierta" | "cerrada";
  bodegaId: string;
  sellerId: string;
  fechaOperacion: string;
  abiertaEn: string;
  cerradaEn: string | null;
  bultosTotal: number | null;
  bultosResueltos: number | null;
  bultosSinResolver: number | null;
}

export interface AbrirVisitaResultado {
  sesion: SesionRetiroResumen;
  bodega: BodegaDetalle;
  /** true si se reutilizó una visita ya abierta hoy (idempotencia de la apertura). */
  reutilizada: boolean;
}

interface FilaSesionRetiro {
  id: string;
  estado: "abierta" | "cerrada";
  bodega_id: string;
  seller_id: string;
  fecha_operacion: string;
  abierta_en: string;
  cerrada_en: string | null;
  bultos_total: number | null;
  bultos_resueltos: number | null;
  bultos_sin_resolver: number | null;
}

function filaASesion(fila: FilaSesionRetiro): SesionRetiroResumen {
  return {
    id: fila.id,
    estado: fila.estado,
    bodegaId: fila.bodega_id,
    sellerId: fila.seller_id,
    fechaOperacion: fila.fecha_operacion,
    abiertaEn: fila.abierta_en,
    cerradaEn: fila.cerrada_en,
    bultosTotal: fila.bultos_total,
    bultosResueltos: fila.bultos_resueltos,
    bultosSinResolver: fila.bultos_sin_resolver,
  };
}

/**
 * Abre (o reutiliza) la visita de HOY del conductor a una bodega.
 *
 * IDEMPOTENCIA SIN `ON CONFLICT`: `sesiones_retiro_abierta_uk` es un índice
 * ÚNICO PARCIAL (`where estado = 'abierta'`). Postgres solo infiere un índice
 * parcial como árbitro de un `ON CONFLICT (columnas)` si el propio
 * `ON CONFLICT` repite su predicado (`... WHERE estado = 'abierta'`), sintaxis
 * que `supabase-js`/PostgREST no exponen — apuntar `onConflict` a esas cuatro
 * columnas sin ese predicado no encontraría ningún índice NO parcial que las
 * cubra y Postgres respondería "no unique or exclusion constraint matching"
 * en TODO intento, no solo en el que choca. Por eso aquí se usa el patrón
 * clásico —INSERT liso, capturar 23505, re-SELECT— que no depende de esa
 * inferencia y da exactamente la misma garantía de idempotencia: el índice
 * único sigue siendo el árbitro de la concurrencia, solo que a nivel de
 * aplicación en vez de cláusula SQL.
 */
export async function abrirVisitaBodega(
  cliente: SupabaseClient,
  entrada: { tenantId: string; conductorId: string; bodegaId: string },
): Promise<AbrirVisitaResultado> {
  const bodega = await obtenerDetalleBodega(cliente, entrada.tenantId, entrada.bodegaId);
  const fechaOperacion = fechaLocalEnSantiago(new Date());

  const payloadSesion = {
    tenant_id: entrada.tenantId,
    bodega_id: entrada.bodegaId,
    seller_id: bodega.sellerId,
    conductor_id: entrada.conductorId,
    fecha_operacion: fechaOperacion,
  };

  const { data: creada, error: errorInsert } = await cliente
    .from("sesiones_retiro")
    .insert(payloadSesion)
    .select("*")
    .maybeSingle();

  if (!errorInsert && creada) {
    return { sesion: filaASesion(creada as FilaSesionRetiro), bodega, reutilizada: false };
  }

  if (errorInsert && errorInsert.code !== "23505") {
    throw new Error(`Error al abrir la visita de retiro: ${errorInsert.message}`);
  }

  // Reintento del mismo POST (timeout en la bodega, señal mala) u otra
  // pestaña/dispositivo: ya hay una visita abierta hoy para (tenant,
  // conductor, bodega) — se reutiliza, nunca se abre una segunda.
  const { data: existente, error: errorSelect } = await cliente
    .from("sesiones_retiro")
    .select("*")
    .eq("tenant_id", entrada.tenantId)
    .eq("conductor_id", entrada.conductorId)
    .eq("bodega_id", entrada.bodegaId)
    .eq("fecha_operacion", fechaOperacion)
    .eq("estado", "abierta")
    .maybeSingle();

  if (errorSelect) {
    throw new Error(`Error al recuperar la visita de retiro: ${errorSelect.message}`);
  }
  if (!existente) {
    throw new Error(
      "El INSERT de la sesión de retiro chocó con una fila duplicada pero no se encontró ninguna visita abierta.",
    );
  }

  return { sesion: filaASesion(existente as FilaSesionRetiro), bodega, reutilizada: true };
}

async function obtenerDetalleBodega(
  cliente: SupabaseClient,
  tenantId: string,
  bodegaId: string,
): Promise<BodegaDetalle> {
  const { data, error } = await cliente
    .from("seller_bodegas")
    .select(
      "id, nombre, direccion, comuna, instrucciones_acceso, contacto_nombre, contacto_telefono, seller_id",
    )
    .eq("tenant_id", tenantId)
    .eq("id", bodegaId)
    .eq("activa", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al leer la bodega: ${error.message}`);
  }
  if (!data) {
    throw new ErrorNoEncontrado(
      `La bodega '${bodegaId}' no existe, no está activa, o no pertenece al tenant.`,
    );
  }

  const nombresSellers = await resolverNombresSellers(cliente, tenantId, [data.seller_id as string]);

  return {
    id: data.id as string,
    nombre: data.nombre as string,
    direccion: data.direccion as string,
    comuna: data.comuna as string,
    instruccionesAcceso: (data.instrucciones_acceso as string | null) ?? null,
    contactoNombre: (data.contacto_nombre as string | null) ?? null,
    contactoTelefono: (data.contacto_telefono as string | null) ?? null,
    sellerId: data.seller_id as string,
    sellerNombre: nombresSellers.get(data.seller_id as string) ?? "",
  };
}
