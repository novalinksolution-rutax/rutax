/**
 * Lo que el listado de liquidaciones necesita y la tabla `liquidaciones` no.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * UNA LIQUIDACIÓN TIENE DOS CLASES DE LÍNEA, Y EL LISTADO MOSTRABA UNA
 * -----------------------------------------------------------------------------
 * `liquidaciones.total_entregas` cuenta entregas. Pero desde la etapa 8 del
 * retiro, **al conductor también se le paga por visitar la bodega del seller**:
 * esas líneas viven en `lineas_liquidacion` con `tipo_hecho = 'retiro_bodega'`
 * y no aparecen en ningún contador del listado.
 *
 * El detalle sí las separa —`agrupacion-liquidacion.ts` arma «Subtotal de
 * entregas» y «Subtotal de visitas a bodega»—, así que el listado mostraba «284
 * entregas» sobre una liquidación que además pagaba 7 visitas. La columna
 * `COMPOSICIÓN` del tablero es exactamente esto.
 *
 * -----------------------------------------------------------------------------
 * UNA CONSULTA PARA TODAS, NO UNA POR FILA
 * -----------------------------------------------------------------------------
 * Cargar las líneas de cada liquidación para contarlas serían N viajes. Se leen
 * de una vez las de todas las liquidaciones de la página y se agrupan en
 * memoria.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";

export interface ComposicionLiquidacion {
  /** Líneas por entrega de un pedido. */
  entregas: number;
  /** Líneas por visita a bodega de seller (`tipo_hecho = 'retiro_bodega'`). */
  visitas: number;
}

/**
 * Cuántas entregas y cuántas visitas paga cada liquidación.
 *
 * Solo las líneas VIGENTES: una anulada no se paga, y contarla dejaría una
 * composición que no cuadra con el neto de su propia fila.
 */
export async function contarComposicionPorLiquidacion(
  cliente: SupabaseClient,
  tenantId: string,
  liquidacionIds: readonly string[],
): Promise<Record<string, ComposicionLiquidacion>> {
  if (liquidacionIds.length === 0) return {};

  const filas = await leerTodasLasFilas<{
    liquidacion_id: string | null;
    tipo_hecho: string | null;
  }>("composición de las liquidaciones", (desde, hasta) =>
    cliente
      .schema("dinero")
      .from("lineas_liquidacion")
      .select("liquidacion_id, tipo_hecho")
      .eq("tenant_id", tenantId)
      .eq("anulada", false)
      .in("liquidacion_id", [...liquidacionIds])
      .range(desde, hasta),
  );

  const salida: Record<string, ComposicionLiquidacion> = {};
  for (const f of filas) {
    if (!f.liquidacion_id) continue;
    const actual = (salida[f.liquidacion_id] ??= { entregas: 0, visitas: 0 });
    if (f.tipo_hecho === "retiro_bodega") actual.visitas += 1;
    else actual.entregas += 1;
  }
  return salida;
}

// =============================================================================
// El rechazo del banco
// =============================================================================

/**
 * Cómo se escribe un rechazo de pago en la fila.
 *
 * ⚠️ **El tablero pide «el motivo traducido» y hoy no se puede del todo.**
 * `dinero.payouts_conductor` guarda `error_descripcion` —el texto crudo del
 * proveedor— y **no guarda un código**. Sin código, cualquier «traducción» sería
 * adivinar sobre una cadena que el proveedor puede cambiar sin avisar, y el día
 * que la cambie la pantalla mostraría una causa equivocada sobre una
 * transferencia que no salió. Eso es peor que mostrar el texto tal cual.
 *
 * Así que se hace lo honesto: se enmarca el texto como lo que es —lo que dijo el
 * banco— y se conserva entero. Traducirlo de verdad exige que el adaptador
 * persista un código, y eso es trabajo de integración, no de pantalla.
 */
export function frasearRechazoDeBanco(errorDescripcion: string | null): string {
  const texto = (errorDescripcion ?? "").trim();
  if (texto.length === 0) {
    // Sin motivo tampoco se inventa uno: se dice que no llegó.
    return "El banco lo rechazó y no devolvió un motivo.";
  }
  return `El banco lo rechazó: «${texto}»`;
}
