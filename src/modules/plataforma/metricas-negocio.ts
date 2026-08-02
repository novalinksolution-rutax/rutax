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
import type { EstadoSuscripcion, Periodicidad } from './tipos';

export interface MetricasNegocio {
  /** Monthly Recurring Revenue (CLP entero) — solo suscripciones `activa`. */
  mrrClp: number;
  /** MRR * 12. */
  arrClp: number;
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

function precioMensualEquivalente(args: {
  periodicidad: Periodicidad;
  precioMensualClp: number;
  precioAnualClp: number;
}): number {
  // El override de características (`caracteristicas_override`) NUNCA cambia
  // precio — el MRR se deriva EXCLUSIVAMENTE de `planes.precio_*_clp`.
  if (args.periodicidad === 'anual') {
    return Math.round(args.precioAnualClp / 12);
  }
  return args.precioMensualClp;
}

/** Límites [inicio, finExclusivo) del mes calendario Santiago actual, como instantes UTC. */
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

  // 2. Planes (catálogo completo — tabla pequeña) para resolver precios.
  const { data: planesData, error: errPlanes } = await supabase
    .schema('plataforma')
    .from('planes')
    .select('id, precio_mensual_clp, precio_anual_clp');
  if (errPlanes) throw new Error(`Error al leer planes: ${errPlanes.message}`);
  const planesMap = new Map(
    (planesData ?? []).map((p) => [
      p.id as string,
      { mensual: Number(p.precio_mensual_clp), anual: Number(p.precio_anual_clp) },
    ]),
  );

  const { inicio: inicioMes, finExclusivo: finMesExclusivo } = limitesMesActualSantiago();
  const inicioMesMs = inicioMes.getTime();
  const finMesMs = finMesExclusivo.getTime();

  const couriersPorEstado: Record<EstadoSuscripcion, number> = {
    trial: 0,
    activa: 0,
    suspendida: 0,
    cancelada: 0,
  };
  let mrrClp = 0;
  let canceladasMes = 0;

  for (const s of suscripciones) {
    const estado = s.estado as EstadoSuscripcion;
    couriersPorEstado[estado] = (couriersPorEstado[estado] ?? 0) + 1;

    if (estado === 'activa') {
      const precios = planesMap.get(s.plan_id as string) ?? { mensual: 0, anual: 0 };
      mrrClp += precioMensualEquivalente({
        periodicidad: (s.periodicidad as Periodicidad) ?? 'mensual',
        precioMensualClp: precios.mensual,
        precioAnualClp: precios.anual,
      });
    }

    if (estado === 'cancelada' && s.cancelada_en) {
      const t = new Date(s.cancelada_en as string).getTime();
      if (t >= inicioMesMs && t < finMesMs) canceladasMes += 1;
    }
  }

  const arrClp = mrrClp * 12;

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

  // 5. Churn del mes — aproximación documentada (ver JSDoc de `churnMes`).
  const activasAlInicioAprox = couriersPorEstado.activa + canceladasMes;
  const tasa = activasAlInicioAprox > 0 ? canceladasMes / activasAlInicioAprox : 0;

  return {
    mrrClp,
    arrClp,
    couriersPorEstado,
    ingresosMesClp,
    morosidadTotalClp,
    churnMes: { canceladas: canceladasMes, activasAlInicioAprox, tasa },
  };
}
