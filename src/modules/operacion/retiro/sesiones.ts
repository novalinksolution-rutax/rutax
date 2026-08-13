/**
 * Sesiones de retiro — "las visitas de hoy de este conductor" (`GET /hoy`),
 * el detalle de una visita con sus bultos (`GET /{sesionId}`), y el cierre
 * (`POST /{sesionId}/cerrar`).
 *
 * Todas las consultas filtran EXPLÍCITAMENTE por `tenant_id` y por
 * `conductor_id`: como estas rutas corren con `service_role` (salta RLS), ese
 * filtro ES el aislamiento (docs/arquitectura/retiro-y-ruteo.md §13bis-1.7).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import {
  buscarPedidosPorIds,
  construirDtoPedidoRetiro,
  resolverNombresSellers,
  type PedidoRetiroDto,
} from "./dto-pedido";
import { codigoVisibleDeBulto, derivarResolucionBulto, type FormatoCodigoBulto, type ResolucionEscaneo } from "./parser-codigo";
import { cerrarSesionRetiroRpc, type ResultadoCerrarSesionRetiro } from "./rpc";
import type { SesionRetiroResumen } from "./bodegas";

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

// =============================================================================
// GET /hoy — las visitas de HOY de este conductor
// =============================================================================

export async function listarSesionesDeHoyDelConductor(
  cliente: SupabaseClient,
  entrada: { tenantId: string; conductorId: string },
): Promise<SesionRetiroResumen[]> {
  const hoy = fechaLocalEnSantiago(new Date());

  const { data, error } = await cliente
    .from("sesiones_retiro")
    .select("*")
    .eq("tenant_id", entrada.tenantId)
    .eq("conductor_id", entrada.conductorId)
    .eq("fecha_operacion", hoy)
    .order("abierta_en", { ascending: false });

  if (error) {
    throw new Error(`Error al listar las visitas de hoy: ${error.message}`);
  }

  return ((data ?? []) as FilaSesionRetiro[]).map(filaASesion);
}

// =============================================================================
// GET /{sesionId} — detalle de una visita, con sus bultos
// =============================================================================

export interface BultoRetiroResumen {
  id: string;
  escaneoId: string;
  codigoFormato: FormatoCodigoBulto;
  codigoVisible: string;
  resolucion: ResolucionEscaneo;
  /** Info VIVA del pedido resuelto (puede haber cambiado desde el escaneo) — null si no_procesado/ilegible. */
  pedido: PedidoRetiroDto | null;
  posteriorAlCierre: boolean;
  escaneadoEn: string;
}

export interface SesionRetiroDetalle extends SesionRetiroResumen {
  bodega: { id: string; nombre: string; comuna: string };
  bultos: BultoRetiroResumen[];
}

interface FilaBultoDetalle {
  id: string;
  escaneo_id: string;
  codigo_formato: FormatoCodigoBulto;
  codigo_normalizado: string;
  muestra_codigo: string | null;
  ml_shipment_id: string | null;
  pedido_id: string | null;
  posterior_al_cierre: boolean;
  escaneado_en: string;
}

/**
 * Detalle de una visita, con sus bultos. Devuelve `null` si la sesión no
 * existe para este (tenant, conductor) — el llamador (route handler) traduce
 * eso a 404.
 */
export async function obtenerSesionRetiro(
  cliente: SupabaseClient,
  entrada: { tenantId: string; conductorId: string; sesionId: string },
): Promise<SesionRetiroDetalle | null> {
  const { data: sesionFila, error: errorSesion } = await cliente
    .from("sesiones_retiro")
    .select("*")
    .eq("id", entrada.sesionId)
    .eq("tenant_id", entrada.tenantId)
    .eq("conductor_id", entrada.conductorId)
    .maybeSingle();

  if (errorSesion) {
    throw new Error(`Error al obtener la visita de retiro: ${errorSesion.message}`);
  }
  if (!sesionFila) return null;

  const sesion = sesionFila as FilaSesionRetiro;

  const [bodega, bultosFilas] = await Promise.all([
    obtenerNombreYComunaBodega(cliente, entrada.tenantId, sesion.bodega_id),
    listarFilasDeBultos(cliente, entrada.tenantId, sesion.id),
  ]);

  const pedidoIds = [...new Set(bultosFilas.map((b) => b.pedido_id).filter((v): v is string => !!v))];
  const pedidosPorId = await buscarPedidosPorIds(cliente, entrada.tenantId, pedidoIds);
  const sellerIds = [...new Set([...pedidosPorId.values()].map((c) => c.sellerId))];
  const nombresSellers = await resolverNombresSellers(cliente, entrada.tenantId, sellerIds);

  const bultos: BultoRetiroResumen[] = bultosFilas.map((b) => {
    const candidato = b.pedido_id ? pedidosPorId.get(b.pedido_id) : undefined;
    return {
      id: b.id,
      escaneoId: b.escaneo_id,
      codigoFormato: b.codigo_formato,
      codigoVisible: codigoVisibleDeBulto({
        mlShipmentId: b.ml_shipment_id,
        muestraCodigo: b.muestra_codigo,
        codigoNormalizado: b.codigo_normalizado,
      }),
      resolucion: derivarResolucionBulto(b.codigo_formato, b.pedido_id),
      pedido: candidato
        ? construirDtoPedidoRetiro(candidato, nombresSellers.get(candidato.sellerId) ?? "", sesion.seller_id)
        : null,
      posteriorAlCierre: b.posterior_al_cierre,
      escaneadoEn: b.escaneado_en,
    };
  });

  return { ...filaASesion(sesion), bodega, bultos };
}

async function obtenerNombreYComunaBodega(
  cliente: SupabaseClient,
  tenantId: string,
  bodegaId: string,
): Promise<{ id: string; nombre: string; comuna: string }> {
  const { data, error } = await cliente
    .from("seller_bodegas")
    .select("id, nombre, comuna")
    .eq("tenant_id", tenantId)
    .eq("id", bodegaId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al leer la bodega de la visita: ${error.message}`);
  }
  // Defensivo: la FK compuesta de sesiones_retiro garantiza que la bodega
  // existe y es del tenant, pero si por algo no aparece no se rompe el
  // detalle entero por eso.
  return data
    ? { id: data.id as string, nombre: data.nombre as string, comuna: data.comuna as string }
    : { id: bodegaId, nombre: "", comuna: "" };
}

async function listarFilasDeBultos(
  cliente: SupabaseClient,
  tenantId: string,
  sesionId: string,
): Promise<FilaBultoDetalle[]> {
  const { data, error } = await cliente
    .from("bultos_retiro")
    .select("id, escaneo_id, codigo_formato, codigo_normalizado, muestra_codigo, ml_shipment_id, pedido_id, posterior_al_cierre, escaneado_en")
    .eq("tenant_id", tenantId)
    .eq("sesion_retiro_id", sesionId)
    .order("escaneado_en", { ascending: false });

  if (error) {
    throw new Error(`Error al listar los bultos de la visita: ${error.message}`);
  }
  return (data ?? []) as FilaBultoDetalle[];
}

// =============================================================================
// POST /{sesionId}/cerrar
// =============================================================================

/**
 * Cierra la visita a una bodega. Bitácora ANTES del efecto (patrón del
 * proyecto, CLAUDE.md): si `cerrarSesionRetiroRpc` falla después, la
 * auditoría ya quedó completa. `actorUsuarioId` es el id de AUTH
 * (`usuario.usuarioId` de `autenticarBearer`) — NUNCA `driverId`: son
 * espacios de UUID distintos y `bitacora_auditoria.actor_usuario_id` tiene FK
 * a `auth.users(id)` (bug ya cometido dos veces en este repo con
 * `cierre-conductor.ts` y `evidencias-entrega.ts`).
 *
 * El llamador (route handler) debe haber verificado YA que la sesión
 * pertenece a (tenantId, conductorId) antes de invocar esto — es lo que hace
 * seguro escribir la bitácora sin haber tocado el RPC todavía.
 */
export async function cerrarSesionRetiro(
  cliente: SupabaseClient,
  entrada: { tenantId: string; sesionId: string; conductorId: string; actorUsuarioId: string },
): Promise<ResultadoCerrarSesionRetiro> {
  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    actorUsuarioId: entrada.actorUsuarioId,
    actorTipo: "usuario",
    accion: "retiro.sesion_cerrada",
    entidadTipo: "sesion_retiro",
    entidadId: entrada.sesionId,
    detalle: { conductor_id: entrada.conductorId },
  });

  return cerrarSesionRetiroRpc(cliente, {
    tenantId: entrada.tenantId,
    sesionId: entrada.sesionId,
    conductorId: entrada.conductorId,
  });
}
