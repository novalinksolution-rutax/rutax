import type { SupabaseClient } from "@supabase/supabase-js";

import { listarCierresPorPedidos } from "../cierre-conductor";

/**
 * Las paradas ya cerradas de un manifiesto, ancladas en el orden que tienen.
 * =============================================================================
 *
 * «Ya ocurrieron»: una entrega hecha no puede cambiar de posición. Se fijan en
 * su `orden_ruta` actual y el motor las respeta igual que a una fijada por el
 * conductor, así que cualquier recálculo alcanza **solo a lo que falta**, sin
 * necesitar un caso especial dentro del solver.
 *
 * ⚠️ **Cerrada es por DOS vías, y hay que mirar las dos.** El estado del pedido
 * cubre same-day, donde el POD de Rutax es autoritativo y mueve el estado. Para
 * Flex el estado lo escribe Mercado Envíos y puede tardar horas: ahí la verdad
 * operativa es `operacion.cierres_conductor`, lo que el conductor declaró en la
 * app. Mirar solo el estado dejaría reordenar una parada Flex ya entregada.
 *
 * Vive acá y no dentro de cada ruta porque lo necesitan al menos dos gestos que
 * recalculan —reordenar y redefinir el punto de término— y una copia que se
 * quede atrás no falla: **reordena entregas hechas, en silencio**.
 */

/** Estados de pedido en los que la parada ya ocurrió y no se reordena. */
export const ESTADOS_CERRADOS = ["entregado", "fallido", "devuelto", "cancelado"];

export interface ParadaConEstado {
  pedidoId: string;
  estado: string;
  ordenRuta: number | null;
}

export interface ParadasDelManifiestoParaAnclar {
  paradas: ParadaConEstado[];
  /** Fijaciones listas para `calcularYAplicarRutaManifiesto`. */
  fijaciones: { pedidoId: string; orden: number }[];
  /** `true` si alguna parada ya tiene posición: el manifiesto está ruteado. */
  tieneSecuencia: boolean;
  estaCerrada: (pedidoId: string, estado: string) => boolean;
}

/**
 * Lee las paradas activas del manifiesto y devuelve las anclas de las cerradas.
 *
 * Lanza si la lectura falla: un fallo de lectura no puede parecerse a «no hay
 * paradas», que se vería igual y reordenaría el día entero desde cero.
 */
export async function leerParadasYAnclarCerradas(
  cliente: SupabaseClient,
  entrada: { tenantId: string; manifiestoId: string },
): Promise<ParadasDelManifiestoParaAnclar> {
  const { data: filas, error } = await cliente
    .from("asignaciones_pedido")
    .select("pedido_id, orden_ruta, pedidos(id, estado)")
    .eq("tenant_id", entrada.tenantId)
    .eq("manifiesto_id", entrada.manifiestoId)
    .eq("activa", true);

  if (error) {
    throw new Error(`Error al leer las paradas del manifiesto: ${error.message}`);
  }

  const paradas = (filas ?? [])
    .map((f: Record<string, unknown>) => {
      const p = f.pedidos as Record<string, unknown> | null;
      if (!p?.id) return null;
      return {
        pedidoId: p.id as string,
        estado: (p.estado as string) ?? "",
        ordenRuta: (f.orden_ruta as number | null) ?? null,
      };
    })
    .filter((p): p is ParadaConEstado => p !== null);

  const cierres = await listarCierresPorPedidos(
    cliente,
    paradas.map((p) => p.pedidoId),
    entrada.tenantId,
  );

  const estaCerrada = (pedidoId: string, estado: string) =>
    ESTADOS_CERRADOS.includes(estado) || cierres.has(pedidoId);

  // Una cerrada SIN `orden_ruta` (manifiesto que nadie ruteó) no se puede
  // anclar: no tiene posición que conservar. Entra al reordenamiento como una
  // más, que es lo correcto — la ruta se está ordenando por primera vez.
  const fijaciones: { pedidoId: string; orden: number }[] = [];
  for (const parada of paradas) {
    if (parada.ordenRuta !== null && estaCerrada(parada.pedidoId, parada.estado)) {
      fijaciones.push({ pedidoId: parada.pedidoId, orden: parada.ordenRuta });
    }
  }

  return {
    paradas,
    fijaciones,
    tieneSecuencia: paradas.some((p) => p.ordenRuta !== null),
    estaCerrada,
  };
}
