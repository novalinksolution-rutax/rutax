/**
 * Cuánto le cobra Rutax al courier por un mes, con el plan de comisión.
 * =============================================================================
 *
 *   monto = mayor(mínimo_mensual, entregas × tarifa_por_pedido)
 *
 * Y el primer mes del courier va SIN mínimo (decisión del usuario): solo
 * comisión, para no cobrarle un piso completo por los días que alcanzó a operar.
 *
 * -----------------------------------------------------------------------------
 * 🔴 QUÉ CUENTA COMO ENTREGA, Y POR QUÉ NO SE CUENTA ACÁ
 * -----------------------------------------------------------------------------
 * La cuenta la hace `listarPedidosEntregadosPorRutax`, del motor entrega→dinero:
 * un pedido cuenta si está entregado **y existe una asignación en Rutax**.
 *
 * No hay un contador propio en `plataforma` a propósito. `obtenerConsumoTenant`
 * —el que alimenta el aviso de tope de plan— cuenta pedidos CREADOS leyendo
 * `operacion.pedidos`, e incluye los que llegaron por la API de ML y que nadie
 * de Rutax tocó. Como indicador blando daba igual; **como base de cobro es
 * sobrefacturar**: el courier de producción tenía 109 pedidos así en su primer
 * período, que a $40 son $4.360 cobrados por trabajo que no ocurrió. Es el mismo
 * incidente del 2026-08-25, esta vez con Rutax en el lado del que cobra.
 *
 * -----------------------------------------------------------------------------
 * SE COBRA VENCIDO
 * -----------------------------------------------------------------------------
 * Una comisión solo se sabe cuando el mes terminó, así que el período se genera
 * el día 1 sobre el mes que cerró. La tarifa que se aplica es la VIGENTE EN ESE
 * MOMENTO (decisión del usuario): si Rutax la baja a mitad de mes, el mes entero
 * se cobra a la nueva. Una sola tarifa por boleta, y siempre a favor del courier
 * — que es la dirección en la que este número se va a mover.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { listarPedidosEntregadosPorRutax } from '@/modules/dinero/pedidos-entregados-por-rutax';
import { limitesDelDiaSantiago } from '@/lib/fecha-santiago';

export interface TarifaComision {
  /** CLP por pedido efectivo. */
  precioPorPedidoClp: number;
  /** Piso del mes. `null` o 0 = sin piso. */
  minimoMensualClp: number | null;
}

export interface MontoDelPeriodo {
  montoClp: number;
  pedidosEfectivos: number;
  tarifaAplicadaClp: number;
  /** `true` si mandó el piso y no la comisión. Para poder explicarlo. */
  aplicoMinimo: boolean;
}

/**
 * La aritmética, sin base de datos. Función PURA para poder fijar los bordes
 * —cero entregas, el piso, el primer mes— sin montar un doble de Postgres.
 *
 * ⚠️ `Math.round` y no `Math.floor`: el monto va a una columna `int` y truncar
 * hacia abajo regalaría hasta un peso por período. Con tarifas enteras no ocurre
 * nunca, pero la columna no impone que la tarifa sea entera y el día que alguien
 * ponga $37,5 el redondeo tiene que ser el que no favorece a nadie por sistema.
 */
export function calcularMontoComision(entrada: {
  pedidosEfectivos: number;
  tarifa: TarifaComision;
  /** El primer mes del courier no lleva piso. */
  esPrimerMes: boolean;
}): MontoDelPeriodo {
  const { pedidosEfectivos, tarifa, esPrimerMes } = entrada;
  const porComision = Math.round(pedidosEfectivos * tarifa.precioPorPedidoClp);

  const piso = esPrimerMes ? 0 : (tarifa.minimoMensualClp ?? 0);
  const aplicoMinimo = piso > porComision;

  return {
    montoClp: Math.max(piso, porComision),
    pedidosEfectivos,
    tarifaAplicadaClp: tarifa.precioPorPedidoClp,
    aplicoMinimo,
  };
}

/**
 * Cuántos pedidos efectivos tuvo el tenant en un mes civil de Santiago.
 *
 * `mes` es 'YYYY-MM'. El rango se resuelve con `limitesDelDiaSantiago` y no con
 * `new Date(...)`: en Vercel el runtime es UTC, y un mes que empieza a
 * medianoche UTC arranca a las 21:00 del día anterior en Santiago — o sea que
 * las entregas de esas tres horas se cobrarían en el mes equivocado.
 */
export async function contarPedidosEfectivosDelMes(
  supabase: SupabaseClient,
  entrada: { tenantId: string; mes: string },
): Promise<number> {
  const [anio, mesNum] = entrada.mes.split('-').map(Number);
  const primerDia = `${entrada.mes}-01`;
  const anioSiguiente = mesNum === 12 ? anio + 1 : anio;
  const mesSiguiente = mesNum === 12 ? 1 : mesNum + 1;
  const primerDiaSiguiente = `${anioSiguiente}-${String(mesSiguiente).padStart(2, '0')}-01`;

  const ids = await listarPedidosEntregadosPorRutax(supabase, {
    tenantId: entrada.tenantId,
    // Sin `sellerId`: acá se cobra por TODO lo que el courier despachó, no por
    // lo de un seller.
    rango: {
      desdeIso: limitesDelDiaSantiago(primerDia).desde.toISOString(),
      hastaIso: limitesDelDiaSantiago(primerDiaSiguiente).desde.toISOString(),
    },
  });

  return ids.length;
}

/** El mes civil anterior a `hoy` ('YYYY-MM-DD') → 'YYYY-MM'. */
export function mesAnteriorDe(hoy: string): string {
  const [anio, mes] = hoy.split('-').map(Number);
  const anioAnterior = mes === 1 ? anio - 1 : anio;
  const mesAnterior = mes === 1 ? 12 : mes - 1;
  return `${anioAnterior}-${String(mesAnterior).padStart(2, '0')}`;
}

/**
 * ¿Es el primer período que se le cobra a esta suscripción?
 *
 * Se mira si YA existe algún período de concepto `periodo`. No se compara contra
 * `activa_desde` porque un courier puede haber estado en trial: sus períodos de
 * trial existen con monto 0, y el primer mes SIN piso debe ser el primero que se
 * le cobra de verdad, no el primero que existe.
 */
export async function esPrimerPeriodoCobrado(
  supabase: SupabaseClient,
  suscripcionId: string,
): Promise<boolean> {
  const { count } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('id', { count: 'exact', head: true })
    .eq('suscripcion_id', suscripcionId)
    .eq('concepto', 'periodo')
    .gt('monto_clp', 0);

  return (count ?? 0) === 0;
}
