/**
 * Job · plataforma/generarPeriodos
 * =====================================================================
 * Trigger: Cron `0 6 1 * *` (día 1 de cada mes a las 06:00 UTC)
 *
 * Responsabilidad:
 * - Listar todas las suscripciones activas o en trial.
 * - Para cada una, generar el período de cobro del ciclo VIGENTE con
 *   ON CONFLICT DO NOTHING (idempotencia: si el cron corre dos veces el
 *   día 1, no duplica el período gracias al UNIQUE (suscripcion_id, periodo_inicio)).
 *   Ramifica por `periodicidad` (F2, item J):
 *     - mensual: el mes calendario ACTUAL (como siempre) — `precio_mensual_clp`.
 *     - anual: el aniversario más reciente <= hoy (según `activa_desde` o
 *       `creada_en` como ancla) — `precio_anual_clp`. Como el cron es mensual,
 *       un período anual se genera recién en el PRIMER cron que corre en o
 *       después del aniversario (hasta ~1 mes de rezago) — el mismo UNIQUE que
 *       evita duplicados hace que los meses intermedios (mismo `periodo_inicio`
 *       que el ya generado) se omitan sin generar nada nuevo.
 * - Los trials generan un período con monto 0 (no se cobra, pero queda registro).
 * - Por cada período COBRABLE (`monto_clp > 0`) de una suscripción `activa`
 *   recién generado, publica `plataforma/suscripcion.periodo-generado`. Los
 *   trials (monto 0) NO publican — nada que cobrar. El consumidor (job de
 *   auto-cobro recurrente, `jobs/cobrar-periodo-auto.ts`) decide cómo cobrar;
 *   este cron NUNCA cobra directamente (mismo principio que `dinero/periodo.cerrado`).
 *
 * Idempotencia:
 * - El UNIQUE (suscripcion_id, periodo_inicio) en BD impide períodos duplicados.
 * - Si el INSERT hace conflict (período ya existe), maybeSingle() devuelve null
 *   y lo contamos como "omitido" — tampoco se publica el evento en ese caso.
 * - `id` de evento determinístico por `periodoId`: un reintento del cron no
 *   dispara un segundo intento de cobro para el mismo período.
 * - Un fallo en una suscripción no cancela las demás (Promise.allSettled).
 *
 * Este job NO emite facturas ni cobra — solo genera el registro de período.
 * El cobro real (link Fintoc / auto-cobro recurrente) y la reconciliación de
 * pagos son procesos separados.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  calcularMontoComision,
  contarPedidosEfectivosDelMes,
  esPrimerPeriodoCobrado,
  mesAnteriorDe,
} from '../cobro-por-pedido';
import { ahoraEnSantiago, sumarDiasCalendario, fechaLocalEnSantiago } from '@/lib/fecha-santiago';

// =============================================================================
// Lógica pura (sin I/O) — exportada para probarla directamente sin runtime de
// Inngest ni BD (mismo patrón que `decidirAccionAutoCobro`,
// `jobs/cobrar-periodo-auto.ts`).
// =============================================================================

/** Último día válido del mes (maneja 29-feb en años no bisiestos, etc.). */
function ultimoDiaDelMes(anio: number, mes1a12: number): number {
  return new Date(Date.UTC(anio, mes1a12, 0)).getUTCDate();
}

/** Construye 'YYYY-MM-DD' para (anio, mes, dia), clampando `dia` al último día válido del mes. */
function fechaConDiaClamp(anio: number, mes1a12: number, dia: number): string {
  const diaClamp = Math.min(dia, ultimoDiaDelMes(anio, mes1a12));
  return `${anio}-${String(mes1a12).padStart(2, '0')}-${String(diaClamp).padStart(2, '0')}`;
}

/**
 * El aniversario (mismo mes/día que `fechaAncla`) más reciente que sea `<=
 * hoy`. Si el aniversario de ESTE año todavía no ocurrió, devuelve el del año
 * anterior. Ambas fechas 'YYYY-MM-DD'. Exportada para testearla directo.
 */
export function aniversarioMasRecienteDesde(fechaAncla: string, hoy: string): string {
  const [, mesAncla, diaAncla] = fechaAncla.split('-').map(Number);
  const [anioHoy] = hoy.split('-').map(Number);
  const candidatoEsteAnio = fechaConDiaClamp(anioHoy, mesAncla, diaAncla);
  return candidatoEsteAnio <= hoy ? candidatoEsteAnio : fechaConDiaClamp(anioHoy - 1, mesAncla, diaAncla);
}

/**
 * Los límites del período de un plan de COMISIÓN: el mes que acaba de cerrar.
 *
 * 🔴 Vencido, no adelantado, y no es un capricho: el 1 de agosto nadie sabe
 * cuántas entregas tendrá agosto. El cron del día 1 factura el mes anterior.
 *
 * Función pura y aparte de `calcularPeriodoSuscripcion` porque el MONTO no se
 * puede calcular acá — depende de contar entregas contra la base. Esto resuelve
 * el «qué mes»; el «cuánto» lo pone el job con `calcularMontoComision`.
 */
export function calcularPeriodoComision(hoy: string): {
  periodoInicio: string;
  periodoFin: string;
  venceEn: string;
  mes: string;
} {
  const mes = mesAnteriorDe(hoy);
  const [anio, mesNum] = mes.split('-').map(Number);
  const periodoInicio = `${mes}-01`;
  const periodoFin = fechaConDiaClamp(anio, mesNum, ultimoDiaDelMes(anio, mesNum));
  return { periodoInicio, periodoFin, venceEn: sumarDiasCalendario(periodoFin, 5), mes };
}

export interface EntradaCalculoPeriodo {
  estado: 'activa' | 'trial';
  periodicidad: 'mensual' | 'anual';
  precioMensualClp: number;
  precioAnualClp: number;
  /** Ancla del aniversario anual (`activa_desde` o, en su defecto, la fecha
   *  civil de `creada_en`) — 'YYYY-MM-DD', calendario de Santiago. */
  fechaAncla: string;
  /** "Hoy" en calendario de Santiago ('YYYY-MM-DD') — el día en que corre el cron. */
  hoy: string;
}

export interface PeriodoCalculado {
  periodoInicio: string;
  periodoFin: string;
  montoClp: number;
  venceEn: string;
}

/**
 * Calcula los límites del período (inicio/fin/vencimiento) y el monto a
 * cobrar para UNA suscripción, según su periodicidad. Función PURA — extraída
 * para poder testear mensual/anual/trial sin BD ni runtime de Inngest.
 */
export function calcularPeriodoSuscripcion(e: EntradaCalculoPeriodo): PeriodoCalculado {
  if (e.periodicidad === 'anual') {
    const periodoInicio = aniversarioMasRecienteDesde(e.fechaAncla, e.hoy);
    const [anioAniv, mesAncla, diaAncla] = periodoInicio.split('-').map(Number);
    // Fin del ciclo = un año después del inicio, menos 1 día (aritmética de
    // calendario, no de 365/366 días fijos — maneja años bisiestos sola).
    const inicioSiguienteCiclo = fechaConDiaClamp(anioAniv + 1, mesAncla, diaAncla);
    const periodoFin = sumarDiasCalendario(inicioSiguienteCiclo, -1);
    const montoClp = e.estado === 'trial' ? 0 : e.precioAnualClp;
    const venceEn = sumarDiasCalendario(periodoFin, 5);
    return { periodoInicio, periodoFin, montoClp, venceEn };
  }

  // mensual — mismo comportamiento que siempre: primer/último día del mes de "hoy".
  const [anioHoy, mesHoy] = e.hoy.split('-').map(Number);
  const periodoInicio = `${anioHoy}-${String(mesHoy).padStart(2, '0')}-01`;
  const periodoFin = fechaConDiaClamp(anioHoy, mesHoy, ultimoDiaDelMes(anioHoy, mesHoy));
  const venceEn = sumarDiasCalendario(periodoFin, 5);
  const montoClp = e.estado === 'trial' ? 0 : e.precioMensualClp;
  return { periodoInicio, periodoFin, montoClp, venceEn };
}

export const jobGenerarPeriodosSuscripcion = inngest.createFunction(
  {
    id: 'plataforma/generarPeriodos',
    name: 'Plataforma · Generar períodos de suscripción',
    triggers: [{ cron: '0 6 1 * *' }],
    retries: 1,
  },
  async ({ step, logger }) => {
    // =========================================================================
    // Step 1: listar suscripciones activas y en trial
    // =========================================================================
    const suscripciones = await step.run('listar-suscripciones', async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema('plataforma')
        .from('suscripciones')
        .select('id, tenant_id, plan_id, estado, periodicidad, activa_desde, creada_en')
        .in('estado', ['activa', 'trial']);

      if (error) throw new Error(`Error al listar suscripciones activas: ${error.message}`);
      const suscLista = data ?? [];

      if (suscLista.length === 0) return [];

      // Leer los planes para obtener el precio mensual Y anual de cada suscripción.
      const planIds = [...new Set(suscLista.map((s) => s.plan_id as string))];
      const { data: planesData, error: planesError } = await supabase
        .schema('plataforma')
        .from('planes')
        .select('id, precio_mensual_clp, precio_anual_clp, precio_por_pedido_clp, minimo_mensual_clp')
        .in('id', planIds);

      if (planesError) throw new Error(`Error al leer planes: ${planesError.message}`);
      const planesMap = new Map(
        (planesData ?? []).map((p) => [
          p.id as string,
          {
            mensual: Number(p.precio_mensual_clp),
            anual: Number(p.precio_anual_clp),
            // `null` = plan de cuota plana. Su presencia es lo que distingue una
            // suscripción de comisión, sin una columna «tipo» que pueda quedar
            // en desacuerdo con los precios.
            porPedido:
              p.precio_por_pedido_clp === null ? null : Number(p.precio_por_pedido_clp),
            minimoMensual:
              p.minimo_mensual_clp === null ? null : Number(p.minimo_mensual_clp),
          },
        ]),
      );

      return suscLista.map((s) => {
        const precios = planesMap.get(s.plan_id as string) ?? {
          mensual: 0,
          anual: 0,
          porPedido: null,
          minimoMensual: null,
        };
        const activaDesde = (s.activa_desde as string | null) ?? null;
        // Ancla del aniversario: `activa_desde` si existe; si no, la fecha
        // civil (Santiago) de `creada_en`.
        const fechaAncla = activaDesde ?? fechaLocalEnSantiago(new Date(s.creada_en as string));
        return {
          id: s.id as string,
          tenantId: s.tenant_id as string,
          planId: s.plan_id as string,
          estado: s.estado as 'activa' | 'trial',
          periodicidad: (s.periodicidad as 'mensual' | 'anual' | null) ?? 'mensual',
          precioMensualClp: precios.mensual,
          precioAnualClp: precios.anual,
          precioPorPedidoClp: precios.porPedido,
          minimoMensualClp: precios.minimoMensual,
          fechaAncla,
        };
      });
    });

    logger.info(`Suscripciones a procesar: ${suscripciones.length}`);

    if (suscripciones.length === 0) {
      return { generados: 0, omitidos: 0, resultado: 'sin_suscripciones_activas' };
    }

    // =========================================================================
    // Step 2: generar el período del ciclo vigente de cada suscripción
    // =========================================================================
    const { generados, omitidos } = await step.run('generar-periodos', async () => {
      const supabase = crearClienteServiceRole();
      const hoy = ahoraEnSantiago().fecha;

      const promesas = suscripciones.map(async (susc) => {
        try {
          // 🔴 La presencia de `precioPorPedidoClp` es lo que distingue una
          // suscripción de comisión. No hay una columna «tipo de plan» a
          // propósito: sería un segundo sitio que puede quedar en desacuerdo con
          // los precios, y el desacuerdo se descubriría en una boleta.
          const esComision = susc.precioPorPedidoClp !== null;

          let periodoInicio: string;
          let periodoFin: string;
          let venceEn: string;
          let montoClp: number;
          let pedidosEfectivos: number | null = null;
          let tarifaAplicadaClp: number | null = null;

          if (esComision) {
            const p = calcularPeriodoComision(hoy);
            periodoInicio = p.periodoInicio;
            periodoFin = p.periodoFin;
            venceEn = p.venceEn;

            if (susc.estado === 'trial') {
              // Igual que en los planes planos: el trial genera período con
              // monto 0 para dejar registro, pero no se cobra.
              montoClp = 0;
              pedidosEfectivos = 0;
              tarifaAplicadaClp = susc.precioPorPedidoClp;
            } else {
              const [entregas, primerCobro] = await Promise.all([
                contarPedidosEfectivosDelMes(supabase, { tenantId: susc.tenantId, mes: p.mes }),
                esPrimerPeriodoCobrado(supabase, susc.id),
              ]);
              const calculo = calcularMontoComision({
                pedidosEfectivos: entregas,
                tarifa: {
                  precioPorPedidoClp: susc.precioPorPedidoClp as number,
                  minimoMensualClp: susc.minimoMensualClp,
                },
                esPrimerMes: primerCobro,
              });
              montoClp = calculo.montoClp;
              pedidosEfectivos = calculo.pedidosEfectivos;
              tarifaAplicadaClp = calculo.tarifaAplicadaClp;
            }
          } else {
            const p = calcularPeriodoSuscripcion({
              estado: susc.estado,
              periodicidad: susc.periodicidad,
              precioMensualClp: susc.precioMensualClp,
              precioAnualClp: susc.precioAnualClp,
              fechaAncla: susc.fechaAncla,
              hoy,
            });
            periodoInicio = p.periodoInicio;
            periodoFin = p.periodoFin;
            venceEn = p.venceEn;
            montoClp = p.montoClp;
          }

          // INSERT con ignorancia de conflicto (idempotencia del cron)
          // maybeSingle() devuelve null si el INSERT fue ignorado por conflict
          const { data, error } = await supabase
            .schema('plataforma')
            .from('periodos_suscripcion')
            .insert({
              suscripcion_id: susc.id,
              tenant_id: susc.tenantId,
              periodo_inicio: periodoInicio,
              periodo_fin: periodoFin,
              monto_clp: montoClp,
              estado: 'pendiente',
              vence_en: venceEn,
              // Cómo se compuso el monto. Sin esto, «¿por qué me cobraste esto?»
              // solo se responde recalculando — y recalcular meses después da
              // otro número, porque los pedidos cambian de estado.
              pedidos_efectivos: pedidosEfectivos,
              tarifa_aplicada_clp: tarifaAplicadaClp,
            })
            .select('id')
            .maybeSingle();

          if (error) {
            // Supabase devuelve error.code '23505' para unique_violation.
            // Si el conflict estaba configurado con .upsert() lo manejaría solo,
            // pero con .insert() necesitamos capturar el 23505 como omitido.
            if (error.code === '23505') {
              return { suscripcionId: susc.id, resultado: 'omitido' as const };
            }
            throw new Error(error.message);
          }

          // data === null significa que el INSERT hizo ON CONFLICT (no vino error
          // pero tampoco devolvió fila — esto puede pasar con algunas versiones).
          if (!data) {
            return { suscripcionId: susc.id, resultado: 'omitido' as const };
          }

          const periodoId = data.id as string;

          // Publicar SOLO si hay algo que cobrar (suscripción activa, monto > 0).
          // Los trials (monto 0) no publican — nada que el job de auto-cobro
          // recurrente deba intentar cobrar.
          if (susc.estado === 'activa' && montoClp > 0) {
            await inngest.send({
              name: 'plataforma/suscripcion.periodo-generado',
              id: `suscripcion-periodo-generado-${periodoId}`,
              data: {
                tenantId: susc.tenantId,
                suscripcionId: susc.id,
                periodoId,
                montoClp,
                periodoInicio,
                periodoFin,
                periodicidad: susc.periodicidad,
              },
            });
          }

          return {
            suscripcionId: susc.id,
            periodoId,
            resultado: 'generado' as const,
          };
        } catch (err) {
          logger.error(
            `Error al generar período para suscripción ${susc.id}: ${(err as Error).message}`,
          );
          return {
            suscripcionId: susc.id,
            resultado: 'error' as const,
            error: (err as Error).message,
          };
        }
      });

      const settled = await Promise.allSettled(promesas);
      const resultados = settled.map((r) =>
        r.status === 'fulfilled' ? r.value : { resultado: 'error' as const, error: String(r.reason) },
      );

      const generadosCount = resultados.filter((r) => r.resultado === 'generado').length;
      const omitidosCount = resultados.filter((r) => r.resultado === 'omitido').length;
      const erroresCount = resultados.filter((r) => r.resultado === 'error').length;

      if (erroresCount > 0) {
        logger.error(`Errores al generar períodos: ${erroresCount}`);
      }

      return { generados: generadosCount, omitidos: omitidosCount, errores: erroresCount };
    });

    logger.info(`Períodos generados: ${generados}. Omitidos (ya existían): ${omitidos}.`);

    return { generados, omitidos };
  },
);
