/**
 * Envoltorio tipado de `operacion.traspasar_pedidos_a_conductor` (etapa 9).
 *
 * Calca a `asignacion-rpc.ts`: el SQL hace TODO el trabajo transaccional —reja,
 * cerrojo, find-or-create del manifiesto, apagado de la asignación de origen,
 * y la BITÁCORA dentro de la misma transacción—. Este archivo solo traduce
 * nombres y errores.
 *
 * ⚠️ Este envoltorio NO debe escribir un segundo asiento de bitácora: el SQL ya
 * escribió el suyo, y con el origen por pedido.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Motivos que devuelve el SQL en `omitidos_detalle`. */
export type MotivoOmisionTraspaso =
  | "sin_asignacion"
  | "ya_mio"
  | "estado_no_traspasable"
  | "ajeno";

export interface ResultadoTraspaso {
  manifiestoId: string;
  manifiestoCreado: boolean;
  totalSolicitados: number;
  totalTraspasados: number;
  totalOmitidos: number;
  /** `{pedidoId: motivo}` de los que NO se traspasaron. */
  omitidos: Record<string, MotivoOmisionTraspaso>;
  /** `{pedidoId: conductorOrigenId}` de los que SÍ. */
  origenes: Record<string, string>;
}

interface FilaTraspasoSql {
  manifiesto_id: string;
  manifiesto_creado: boolean;
  total_solicitados: number | string;
  total_traspasados: number | string;
  total_omitidos: number | string;
  omitidos_sin_asignacion: number | string;
  omitidos_ya_mio: number | string;
  omitidos_estado_no_traspasable: number | string;
  omitidos_ajenos: number | string;
  omitidos_detalle: unknown;
  conductores_origen: unknown;
}

/**
 * Traduce los errores previstos del SQL a mensajes de negocio.
 *
 * P0002 (receptor inexistente o de otro courier) se devuelve con un texto que
 * NO distingue los dos casos, igual que hace el SQL: confirmar que un id existe
 * en otro tenant ya es información.
 */
function traducirError(error: { code?: string; message: string }): Error {
  if (error.code === "22023") {
    return new Error("El lote de bultos llegó vacío.");
  }
  if (error.code === "P0002") {
    return new Error("No se pudo identificar al conductor que recibe.");
  }
  if (error.code === "P0001") {
    // La aserción de conteo del SQL: algo cambió bajo nuestros pies pese al
    // `for update`. El mensaje pide RECARGAR, no reintentar — reintentar con
    // los mismos datos volvería a chocar.
    return new Error(
      "Algo cambió mientras recibías los bultos. Vuelve a abrir la pantalla y escanéalos de nuevo.",
    );
  }
  return new Error(`Error al traspasar los bultos: ${error.message}`);
}

function normalizarMapa(valor: unknown): Record<string, string> {
  if (!valor || typeof valor !== "object") return {};
  return valor as Record<string, string>;
}

export async function traspasarPedidosRpc(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    conductorReceptorId: string;
    fecha: string;
    pedidoIds: readonly string[];
    actorUsuarioId: string | null;
  },
): Promise<ResultadoTraspaso> {
  const { data, error } = await cliente
    .schema("operacion")
    .rpc("traspasar_pedidos_a_conductor", {
      p_tenant_id: entrada.tenantId,
      p_conductor_receptor: entrada.conductorReceptorId,
      p_fecha: entrada.fecha,
      p_pedido_ids: entrada.pedidoIds,
      p_actor_usuario_id: entrada.actorUsuarioId,
    });

  if (error) {
    throw traducirError(error);
  }

  const fila = (Array.isArray(data) ? data[0] : data) as FilaTraspasoSql | undefined;
  if (!fila) {
    throw new Error("traspasar_pedidos_a_conductor no devolvió ninguna fila.");
  }

  return {
    manifiestoId: fila.manifiesto_id,
    manifiestoCreado: fila.manifiesto_creado,
    totalSolicitados: Number(fila.total_solicitados),
    totalTraspasados: Number(fila.total_traspasados),
    totalOmitidos: Number(fila.total_omitidos),
    omitidos: normalizarMapa(fila.omitidos_detalle) as Record<string, MotivoOmisionTraspaso>,
    origenes: normalizarMapa(fila.conductores_origen),
  };
}
