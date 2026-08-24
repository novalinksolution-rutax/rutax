/**
 * Lo que el listado de períodos necesita saber y la tabla `periodos_cobro` no.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * UN PERÍODO NO SABE SI SE PUEDE FACTURAR
 * -----------------------------------------------------------------------------
 * `estado = 'cerrado'` dice que el período está listo para emitir. **No dice si
 * hay una excepción de conciliación que lo bloquea.** Ese dato vive en
 * `dinero.eventos_conciliacion.bloquea_facturacion`, y hasta hoy el listado no
 * lo consultaba: la fila se veía idéntica a las demás, se seleccionaba para el
 * lote, y el bloqueo aparecía recién en el preflight — con la ceremonia ya
 * empezada y el monto ya escrito en el título.
 *
 * El tablero pide lo contrario: la fila **nace bloqueada**, con su casilla
 * deshabilitada y el número de excepciones a la vista. Es más barato descubrirlo
 * mirando la tabla que descubrirlo tres clics adentro.
 *
 * -----------------------------------------------------------------------------
 * EL CIERRE NO SE «SUGIERE»: OCURRE SOLO
 * -----------------------------------------------------------------------------
 * El tablero escribe «cierre sugerido el 31-08». En el código no hay nada que
 * sugerir: el cron `cerrar-periodo` corre a las 02:00 y cierra **todo período
 * abierto cuyo `fecha_fin` ya pasó**. Así que la bajada dice lo que de verdad
 * va a ocurrir —«cierran solos el 31-08»— y no una recomendación que nadie
 * tiene que aceptar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import { ESTADOS_NO_TERMINALES_CONCILIACION } from "./conciliacion-clasificacion";

/**
 * Cuántas excepciones bloquean la facturación de cada período.
 *
 * ⚠️ **Esta consulta tiene que dar exactamente lo mismo que `bloqueaFacturacion`
 * de `excepciones.ts`, que es la autoridad y la que corre en el preflight.** Si
 * la tabla dice «se puede emitir» y el preflight dice que no, la casilla ofrece
 * una acción que va a fallar tres clics después — con la ceremonia abierta y el
 * monto ya escrito en el título. Que es justo el defecto que esto viene a
 * cerrar, reintroducido al revés.
 *
 * Dos cosas se copian de ahí y no se simplifican:
 *
 * 1. **El estado no es `pendiente`, son los cuatro NO terminales.** Una
 *    excepción `en_analisis` o `requiere_ajuste` sigue bloqueando. Filtrar solo
 *    por `pendiente` dejaría filas seleccionables que el preflight rechaza.
 * 2. **El vínculo es `periodo_cobro_id = X` OR `seller_id = Y`, y eso es más
 *    ancho de lo que parece.** No es «la del período, y si no la del seller»:
 *    una excepción que nombra el período **también trae su `seller_id`**, así
 *    que bloquea TODOS los períodos de ese seller. Es deliberado —un seller con
 *    un problema de plata sin resolver no se factura— y se verificó en pantalla:
 *    la primera versión de esto contaba «la del período O la del seller, sin
 *    duplicar», dejó tres filas seleccionables, y el preflight las rechazó las
 *    tres con la ceremonia ya abierta.
 */
export async function contarBloqueosDeFacturacion(
  cliente: SupabaseClient,
  tenantId: string,
  periodos: readonly { id: string; sellerId: string }[],
): Promise<Record<string, number>> {
  if (periodos.length === 0) return {};

  const filas = await leerTodasLasFilas<{
    periodo_cobro_id: string | null;
    seller_id: string | null;
  }>("excepciones que bloquean la facturación", (desde, hasta) =>
    cliente
      .schema("dinero")
      .from("eventos_conciliacion")
      .select("periodo_cobro_id, seller_id")
      .eq("tenant_id", tenantId)
      .eq("bloquea_facturacion", true)
      .in("estado", ESTADOS_NO_TERMINALES_CONCILIACION)
      .range(desde, hasta),
  );

  const salida: Record<string, number> = {};
  for (const p of periodos) {
    // El mismo OR del preflight, sin atajos. Una excepción cuenta una vez
    // aunque calce por los dos lados.
    const n = filas.filter(
      (f) => f.seller_id === p.sellerId || f.periodo_cobro_id === p.id,
    ).length;
    if (n > 0) salida[p.id] = n;
  }
  return salida;
}

// =============================================================================
// La bajada del encabezado
// =============================================================================

export interface ProximoCierre {
  /** 'YYYY-MM-DD' del `fecha_fin` más cercano entre los abiertos. */
  fecha: string;
  /** Cuántos períodos cierran ese día. */
  cuantos: number;
  /** Ya pasó su `fecha_fin`: el cron los cierra en su próxima corrida. */
  vencido: boolean;
}

/**
 * Cuál es el próximo cierre automático, si hay períodos abiertos.
 *
 * `hoy` entra por parámetro y no se lee del reloj: así la función es pura y se
 * puede probar el caso «ya venció y el cron todavía no pasa», que es justo el
 * que confunde a quien mira la pantalla a las 23:00.
 */
export function proximoCierreAutomatico(
  periodosAbiertos: readonly { fechaFin: string }[],
  hoy: string,
): ProximoCierre | null {
  if (periodosAbiertos.length === 0) return null;

  // Comparación de cadenas 'YYYY-MM-DD': ordena igual que la fecha y no pasa
  // por `Date`, que interpretaría el día como medianoche UTC y lo correría.
  const fecha = periodosAbiertos.reduce(
    (min, p) => (p.fechaFin < min ? p.fechaFin : min),
    periodosAbiertos[0].fechaFin,
  );

  return {
    fecha,
    cuantos: periodosAbiertos.filter((p) => p.fechaFin === fecha).length,
    vencido: fecha < hoy,
  };
}

// =============================================================================
// La etiqueta del período
// =============================================================================

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Último día del mes, sin pasar por `Date` y sin husos de por medio. */
function ultimoDiaDelMes(anio: number, mes: number): number {
  const treintaYuno = [1, 3, 5, 7, 8, 10, 12];
  if (treintaYuno.includes(mes)) return 31;
  if (mes !== 2) return 30;
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0 ? 29 : 28;
}

/**
 * `agosto 2026` cuando el período es un mes entero; `01–15 ago` cuando no.
 *
 * El tablero escribe «Agosto 2026» porque dibuja un courier mensual. La mayoría
 * factura quincenal, y un «agosto 2026» sobre la primera quincena sería una
 * etiqueta falsa: dos períodos distintos del mismo seller se verían idénticos.
 */
export function etiquetaPeriodo(fechaInicio: string, fechaFin: string): string {
  const [ai, mi, di] = fechaInicio.split("-").map(Number);
  const [af, mf, df] = fechaFin.split("-").map(Number);

  const nombreMes = (m: number) => MESES[m - 1] ?? String(m);

  if (ai === af && mi === mf && di === 1 && df === ultimoDiaDelMes(af, mf)) {
    return `${nombreMes(mi)} ${ai}`;
  }

  const corto = (m: number) => nombreMes(m).slice(0, 3);
  return mi === mf && ai === af
    ? `${di}–${df} ${corto(mi)}`
    : `${di} ${corto(mi)} – ${df} ${corto(mf)}`;
}
