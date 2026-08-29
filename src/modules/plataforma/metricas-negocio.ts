/**
 * Métricas de negocio del backstage de plataforma (F2, item L — gap 2).
 * =============================================================================
 * `obtenerMetricasNegocio()` es de solo lectura, `service_role`, ADMIN-ONLY —
 * mismo patrón que `obtenerPanelCouriers` (`panel-couriers.ts`): esta función
 * NO verifica `adminSecret`/sesión admin por sí misma; el LLAMADOR (la página
 * `/admin/*` o su Server Action) debe exigir `tieneSesionAdmin()` ANTES de
 * invocarla. Nunca se expone al courier — `plataforma` es deny-all para
 * `authenticated`, así que solo el backstage de super-admin puede llegar aquí.
 *
 * Deriva de `suscripciones` + `planes` + `pagos_plataforma` +
 * `periodos_suscripcion`. Consultas PROPIAS (no reusa `obtenerTodasSuscripciones`
 * de `consultas.ts`): esa función también trae el nombre del tenant vía un
 * join cross-schema que estas métricas agregadas no necesitan — mantener esto
 * autocontenido evita una consulta extra irrelevante.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { ahoraEnSantiago, combinarFechaHoraSantiago, sumarDiasCalendario } from '@/lib/fecha-santiago';
import type { EstadoSuscripcion } from './tipos';

/** Cuántos meses trae la serie de facturado. Seis: medio año se lee de un vistazo. */
const MESES_SERIE = 6;

export interface MetricasNegocio {
  /**
   * Lo FACTURADO por mes, del más antiguo al más reciente.
   *
   * 🔴 Reemplaza al MRR/ARR, y no es una simplificación: con el cobro por pedido
   * efectivo **no existe un monto contratado**. Lo que paga un courier depende de
   * cuánto despachó, y solo se sabe cuando el mes cerró. Un «MRR» ahí sería una
   * estimación presentada como si fuera un contrato — y en reparto, que es
   * estacional, se equivocaría justo en diciembre.
   *
   * Se agrupa por `periodo_inicio` y no por cuándo se generó la fila: el período
   * de agosto se crea el 1 de septiembre (se cobra vencido), y atribuirlo a
   * septiembre diría que agosto no facturó nada.
   */
  facturadoPorMes: Array<{ mes: string; montoClp: number }>;
  /** Conteo de suscripciones por estado (incluye los 4 estados, aunque sean 0). */
  couriersPorEstado: Record<EstadoSuscripcion, number>;
  /** Suma de pagos `confirmado` cuyo `pagado_en` cae en el mes calendario
   *  Santiago actual. INCLUYE ajustes de proración (son ingreso real cobrado
   *  este mes) — distinto del MRR, que es la proyección RECURRENTE y por eso
   *  excluye ajustes puntuales (se deriva de `suscripciones.estado='activa'`,
   *  nunca de `pagos_plataforma`). */
  ingresosMesClp: number;
  /** Suma de `monto_clp` de períodos en estado `vencido` (morosidad total, a
   *  la fecha de consulta — no acotada al mes). */
  morosidadTotalClp: number;
  churnMes: {
    /** Suscripciones cuyo `cancelada_en` cae en el mes calendario Santiago actual. */
    canceladas: number;
    /**
     * Aproximación de "suscripciones activas al inicio del mes" — NO hay un
     * snapshot histórico de estados, así que se aproxima con lo disponible:
     * suscripciones `activa` HOY + las canceladas ESTE MES (que, de no haberse
     * cancelado, seguirían activas — asumiendo que ya estaban activas antes
     * del inicio del mes, lo cual sobreestima levemente si alguna pasó de
     * trial a activa Y se canceló en el mismo mes). Documentado explícitamente
     * porque es una aproximación, no un cálculo exacto.
     */
    activasAlInicioAprox: number;
    /** `canceladas / activasAlInicioAprox` (0 si el denominador es 0). */
    tasa: number;
  };
}


/** Límites [inicio, finExclusivo) del mes calendario Santiago actual, como instantes UTC. */
/**
 * El mes ('YYYY-MM') que está `atras` meses antes del de `hoy` ('YYYY-MM-DD').
 *
 * Aritmética de mes CIVIL y no de días: restar 30 días se salta febrero y
 * duplica los meses de 31. Exportada para poder fijar el cruce de año sin
 * montar la función entera.
 */
export function mesDesplazado(hoy: string, atras: number): string {
  const [anio, mes] = hoy.split('-').map(Number);
  const total = anio * 12 + (mes - 1) - atras;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function limitesMesActualSantiago(): { inicio: Date; finExclusivo: Date } {
  const { fecha: hoy } = ahoraEnSantiago();
  const inicioMes = `${hoy.slice(0, 7)}-01`;
  const inicioMesSiguiente = sumarDiasCalendario(inicioMes, 32).slice(0, 7) + '-01';
  return {
    inicio: combinarFechaHoraSantiago(inicioMes, '00:00'),
    finExclusivo: combinarFechaHoraSantiago(inicioMesSiguiente, '00:00'),
  };
}

export async function obtenerMetricasNegocio(): Promise<MetricasNegocio> {
  const supabase = crearClienteServiceRole();

  // 1. Suscripciones (estado, periodicidad, plan_id, cancelada_en) — todas.
  const { data: suscData, error: errSusc } = await supabase
    .schema('plataforma')
    .from('suscripciones')
    .select('id, estado, periodicidad, plan_id, cancelada_en');
  if (errSusc) throw new Error(`Error al leer suscripciones: ${errSusc.message}`);
  const suscripciones = suscData ?? [];

  // ⚠️ Acá se leía el catálogo de planes, y se retiró con el MRR: era su única
  // razón de existir. Con el cobro por pedido efectivo el ingreso no sale del
  // precio de un plan, sale de lo que se facturó — así que esta pantalla ya no
  // necesita saber qué planes hay, y es una consulta menos por visita.

  const { inicio: inicioMes, finExclusivo: finMesExclusivo } = limitesMesActualSantiago();
  const inicioMesMs = inicioMes.getTime();
  const finMesMs = finMesExclusivo.getTime();

  const couriersPorEstado: Record<EstadoSuscripcion, number> = {
    trial: 0,
    activa: 0,
    suspendida: 0,
    cancelada: 0,
  };
  let canceladasMes = 0;

  for (const s of suscripciones) {
    const estado = s.estado as EstadoSuscripcion;
    couriersPorEstado[estado] = (couriersPorEstado[estado] ?? 0) + 1;

    if (estado === 'cancelada' && s.cancelada_en) {
      const t = new Date(s.cancelada_en as string).getTime();
      if (t >= inicioMesMs && t < finMesMs) canceladasMes += 1;
    }
  }

  // 3. Ingresos del mes: pagos `confirmado` cuyo `pagado_en` cae en el mes
  // calendario Santiago actual. Incluye ajustes de proración a propósito
  // (son ingreso real cobrado este mes) — ver JSDoc de `ingresosMesClp`.
  const { data: pagosMes, error: errPagos } = await supabase
    .schema('plataforma')
    .from('pagos_plataforma')
    .select('monto_clp')
    .eq('estado', 'confirmado')
    .gte('pagado_en', inicioMes.toISOString())
    .lt('pagado_en', finMesExclusivo.toISOString());
  if (errPagos) throw new Error(`Error al leer pagos del mes: ${errPagos.message}`);
  const ingresosMesClp = (pagosMes ?? []).reduce((acc, p) => acc + Math.round(Number(p.monto_clp)), 0);

  // 4. Morosidad total: suma de `monto_clp` de períodos `vencido` (no acotada al mes).
  const { data: vencidos, error: errVencidos } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('monto_clp')
    .eq('estado', 'vencido');
  if (errVencidos) throw new Error(`Error al leer períodos vencidos: ${errVencidos.message}`);
  const morosidadTotalClp = (vencidos ?? []).reduce((acc, p) => acc + Math.round(Number(p.monto_clp)), 0);

  // 4b. Lo FACTURADO por mes — reemplaza al MRR/ARR (ver JSDoc de `facturadoPorMes`).
  //
  // Se suman TODOS los conceptos: el cobro del mes, los ajustes de proración y
  // los créditos por devolución. Un ajuste es dinero que entró o salió de verdad,
  // y excluirlo daría una serie que no cuadra con lo que el courier pagó.
  //
  // Se leen los últimos MESES_SERIE meses por `periodo_inicio`. La ventana se
  // arma acá y no con un `group by` en SQL porque PostgREST no agrupa, y traer
  // los períodos de medio año de una decena de couriers son pocas filas.
  const hoySantiago = ahoraEnSantiago().fecha;
  const desdeSerie = `${mesDesplazado(hoySantiago, MESES_SERIE - 1)}-01`;
  const { data: periodosSerie, error: errSerie } = await supabase
    .schema('plataforma')
    .from('periodos_suscripcion')
    .select('periodo_inicio, monto_clp')
    .gte('periodo_inicio', desdeSerie);
  if (errSerie) throw new Error(`Error al leer los períodos facturados: ${errSerie.message}`);

  const porMes = new Map<string, number>();
  for (let i = MESES_SERIE - 1; i >= 0; i -= 1) porMes.set(mesDesplazado(hoySantiago, i), 0);
  for (const p of periodosSerie ?? []) {
    const mes = String(p.periodo_inicio).slice(0, 7);
    // Solo los meses de la ventana: un `periodo_inicio` anterior no se inventa
    // una fila nueva en el mapa, que dejaría la serie con huecos desordenados.
    if (porMes.has(mes)) {
      porMes.set(mes, (porMes.get(mes) ?? 0) + Math.round(Number(p.monto_clp)));
    }
  }
  const facturadoPorMes = [...porMes.entries()].map(([mes, montoClp]) => ({ mes, montoClp }));

  // 5. Churn del mes — aproximación documentada (ver JSDoc de `churnMes`).
  const activasAlInicioAprox = couriersPorEstado.activa + canceladasMes;
  const tasa = activasAlInicioAprox > 0 ? canceladasMes / activasAlInicioAprox : 0;

  return {
    facturadoPorMes,
    couriersPorEstado,
    ingresosMesClp,
    morosidadTotalClp,
    churnMes: { canceladas: canceladasMes, activasAlInicioAprox, tasa },
  };
}
