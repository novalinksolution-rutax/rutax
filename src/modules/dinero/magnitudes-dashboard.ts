/**
 * Las magnitudes de dinero del mosaico del dashboard (tablero B1c).
 *
 * -----------------------------------------------------------------------------
 * «POR PAGAR A CONDUCTORES» ES LO QUE SE DEBE, NO LO QUE ESTÁ EN BORRADOR
 * -----------------------------------------------------------------------------
 * El tablero rotula la bajada «9 liquidaciones en borrador», y la tentación es
 * filtrar por ese estado. No: una liquidación **emitida y sin pagar** es deuda
 * igual —de hecho más urgente, porque el conductor ya la vio— y quedaría fuera
 * del mosaico sin que nada lo dijera.
 *
 * Así que la cifra es todo lo que no está pagado, y la bajada dice cuántas son.
 * Decisión del usuario, 23-08-2026. La misma regla se aplica del otro lado, en
 * `porCobrarClp` de `operacion/metricas.ts`.
 *
 * ⚠️ **El monto no es `monto_total_clp` a secas.** El neto que se le transfiere
 * al conductor es `monto_total_clp + bono_clp − penalizacion_clp`, y así lo
 * calculan el listado de liquidaciones y el payout. Sumar solo la primera
 * columna daría una cifra que no coincide con ninguna otra pantalla del
 * producto.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";

export interface PorPagarConductores {
  /** Suma del neto de todo lo no pagado. */
  montoClp: number;
  /** Cuántas liquidaciones lo componen. */
  cantidad: number;
  /** De ésas, cuántas siguen en borrador — el cuello de botella del courier. */
  enBorrador: number;
}

/**
 * Lo que el courier le debe hoy a sus conductores, sin filtro de fecha.
 *
 * No se acota al mes a propósito: una liquidación de hace dos meses sin pagar
 * sigue siendo deuda, y esconderla porque cayó fuera de la ventana es
 * exactamente el tipo de silencio que el mosaico existe para romper.
 */
export async function obtenerPorPagarConductores(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<PorPagarConductores> {
  const filas = await leerTodasLasFilas<{
    estado: string;
    monto_total_clp: number | string | null;
    bono_clp: number | string | null;
    penalizacion_clp: number | string | null;
  }>("liquidaciones por pagar", (desde, hasta) =>
    cliente
      .schema("dinero")
      .from("liquidaciones")
      .select("estado, monto_total_clp, bono_clp, penalizacion_clp")
      .eq("tenant_id", tenantId)
      .in("estado", ["borrador", "emitida"])
      .range(desde, hasta),
  );

  let montoClp = 0;
  let enBorrador = 0;
  for (const f of filas) {
    montoClp +=
      Math.round(Number(f.monto_total_clp ?? 0)) +
      Math.round(Number(f.bono_clp ?? 0)) -
      Math.round(Number(f.penalizacion_clp ?? 0));
    if (f.estado === "borrador") enBorrador += 1;
  }

  return { montoClp, cantidad: filas.length, enBorrador };
}
