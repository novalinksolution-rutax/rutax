/**
 * Job · plataforma/verificarSalud — watchdog de salud del sistema (QW3 + QW6).
 * =============================================================================
 * Trigger: Cron `15 * * * *` (cada hora a los :15).
 *
 * Convierte la telemetría de ejecución (infra.ejecuciones_job, poblada por el
 * middleware) y la integridad del motor entrega→dinero en ALERTAS accionables,
 * cerrando la parte de la auditoría §2.7/§3.2/QW3/QW6 que faltaba:
 *
 *   A. Crons stale — un proceso automático crítico que dejó de ejecutarse con
 *      éxito (o cuyo último run falló). Sin esto, un cron que se cae pasa
 *      inadvertido hasta que alguien nota el efecto financiero.
 *   B. Backlog acumulado — períodos que debieron cerrar y no cerraron, y
 *      excepciones de conciliación que pasaron su fecha límite (SLA).
 *   C. Integridad estructural permanente — líneas de cobro huérfanas
 *      (`detectarLineasCobroHuerfanas`), el detector que ningún job emitía.
 *
 * Detective puro respecto al dinero: NO muta líneas/períodos; solo inserta
 * excepciones (vía la bandeja existente) y emite alertas a la observabilidad.
 *
 * Lee la telemetría vía la RPC `salud_jobs_resumen` (el schema `infra` no se
 * expone a PostgREST — la RPC es la única superficie). Las lecturas de dinero/
 * operacion usan service_role con filtro de tenant explícito, igual que C7.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { capturarMensaje } from '@/lib/observabilidad';
import { detectarLineasCobroHuerfanas } from '@/modules/dinero/integridad';
import { ESTADOS_NO_TERMINALES_CONCILIACION } from '@/modules/dinero/conciliacion-clasificacion';

const TZ = 'America/Santiago';

/**
 * Crons vigilados: por cada uno, la antigüedad MÁXIMA tolerada de su última
 * ejecución exitosa (holgura ~2-3× su cadencia para no alertar por un run
 * atrasado). Es la fuente de verdad de "qué crons se vigilan"; ampliarla al
 * agregar un cron crítico nuevo. Los no listados no se vigilan por staleness
 * (siguen registrando telemetría y visibles en el tablero).
 */
const CRONS_VIGILADOS: ReadonlyArray<{ jobId: string; maxHoras: number; descripcion: string }> = [
  { jobId: 'dinero/cerrarPeriodo', maxHoras: 27, descripcion: 'Cierre diario de períodos de cobro (02:00)' },
  { jobId: 'dinero/generarLiquidacionConductor', maxHoras: 27, descripcion: 'Generación diaria de liquidaciones (02:00)' },
  { jobId: 'dinero/conciliarTresFuentes', maxHoras: 27, descripcion: 'Conciliación diaria de 3 fuentes (02:30)' },
  { jobId: 'dinero/alertaMorosidad', maxHoras: 27, descripcion: 'Alerta diaria de morosidad (09:00)' },
  { jobId: 'dinero/alertaFoliosProximos', maxHoras: 27, descripcion: 'Alerta diaria de folios CAF (09:00)' },
  { jobId: 'ml/refrescarTokens', maxHoras: 2, descripcion: 'Refresco de tokens ML (cada 30 min)' },
  { jobId: 'ml/sondeoSaludConexiones', maxHoras: 2, descripcion: 'Sondeo de salud de conexiones ML (cada 15 min)' },
  { jobId: 'plataforma/generarPeriodos', maxHoras: 24 * 33, descripcion: 'Generación mensual de períodos de suscripción' },
  { jobId: 'plataforma/marcarMorosidad', maxHoras: 27, descripcion: 'Marcar morosidad de suscripción (08:00)' },
];

/** Umbral de excepciones de conciliación vencidas (fecha_limite pasada) que dispara alerta. */
const UMBRAL_CONCILIACIONES_VENCIDAS = 0; // cualquier excepción vencida es un SLA incumplido

function hoyEnSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

interface FilaSaludJob {
  job_id: string;
  estado: string;
  error: string | null;
  iniciado_en: string | null;
  ultimo_ok_en: string | null;
}

/**
 * Predicado puro: dado el último run de un cron vigilado, ¿por qué está sin
 * salud? Devuelve el motivo legible, o `null` si está sano / sin datos aún.
 * Extraído para testear la regla de staleness sin BD.
 */
export function motivoCronSinSalud(
  fila: Pick<FilaSaludJob, 'estado' | 'error' | 'ultimo_ok_en'> | undefined,
  maxHoras: number,
  ahoraMs: number,
): string | null {
  // Sin telemetría todavía (deploy reciente, o cron aún no disparó): no alertar
  // — evita ruido el día 1. El tablero muestra el vacío al humano.
  if (!fila) return null;
  if (fila.estado === 'error') {
    return `último run falló${fila.error ? `: ${fila.error}` : ''}`;
  }
  if (fila.ultimo_ok_en) {
    const horas = (ahoraMs - new Date(fila.ultimo_ok_en).getTime()) / 3_600_000;
    if (horas > maxHoras) {
      return `sin ejecución exitosa hace ${horas.toFixed(1)}h (máx ${maxHoras}h)`;
    }
  }
  return null;
}

export const jobVerificarSalud = inngest.createFunction(
  {
    id: 'plataforma/verificarSalud',
    name: 'Plataforma · Watchdog de salud (crons, backlog, integridad)',
    triggers: [{ cron: '15 * * * *' }],
    retries: 1,
  },
  async ({ step, logger, runId }) => {
    const hoy = hoyEnSantiago();
    const ahoraMs = Date.now();

    // =========================================================================
    // A. Crons stale — último éxito demasiado viejo o último run en error.
    // =========================================================================
    const cronsAlertados = await step.run('watchdog-crons', async () => {
      const supabase = crearClienteServiceRole();
      const { data, error } = await supabase.rpc('salud_jobs_resumen');
      if (error) throw new Error(`Watchdog · Error al leer salud_jobs_resumen: ${error.message}`);

      const porJob = new Map<string, FilaSaludJob>(
        ((data ?? []) as FilaSaludJob[]).map((f) => [f.job_id, f]),
      );

      const alertados: Array<{ jobId: string; motivo: string }> = [];

      for (const vig of CRONS_VIGILADOS) {
        const fila = porJob.get(vig.jobId);
        const motivo = motivoCronSinSalud(fila, vig.maxHoras, ahoraMs);
        if (!motivo) continue;

        alertados.push({ jobId: vig.jobId, motivo });
        await capturarMensaje(
          `Cron '${vig.jobId}' (${vig.descripcion}) sin salud: ${motivo}.`,
          'error',
          {
            origen: 'job:plataforma/verificarSalud',
            correlacionId: runId,
            etiquetas: { job_vigilado: vig.jobId, motivo: fila?.estado === 'error' ? 'error' : 'stale' },
          },
        );
      }

      if (alertados.length > 0) {
        logger.warn(`Watchdog: ${alertados.length} cron(s) sin salud: ${alertados.map((a) => a.jobId).join(', ')}.`);
      }
      return alertados.length;
    });

    // =========================================================================
    // B. Backlog — períodos que no cerraron + conciliaciones vencidas (SLA).
    // =========================================================================
    const backlog = await step.run('backlog-dinero', async () => {
      const supabase = crearClienteServiceRole();

      // Períodos abiertos ya vencidos: el cron de cierre debió cerrarlos.
      const { count: periodosAbiertosVencidos, error: errPeriodos } = await supabase
        .schema('dinero')
        .from('periodos_cobro')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'abierto')
        .lt('fecha_fin', hoy);
      if (errPeriodos) throw new Error(`Watchdog · Error al contar períodos: ${errPeriodos.message}`);

      // Excepciones de conciliación en estado no-terminal con fecha_limite pasada.
      const { count: conciliacionesVencidas, error: errConc } = await supabase
        .schema('dinero')
        .from('eventos_conciliacion')
        .select('id', { count: 'exact', head: true })
        .in('estado', [...ESTADOS_NO_TERMINALES_CONCILIACION])
        .lt('fecha_limite', hoy);
      if (errConc) throw new Error(`Watchdog · Error al contar conciliaciones: ${errConc.message}`);

      const pAbiertos = periodosAbiertosVencidos ?? 0;
      const cVencidas = conciliacionesVencidas ?? 0;

      if (pAbiertos > 0) {
        await capturarMensaje(
          `Hay ${pAbiertos} período(s) de cobro vencido(s) aún 'abierto' — el cierre diario no los cerró.`,
          'error',
          { origen: 'job:plataforma/verificarSalud', correlacionId: runId, etiquetas: { tipo: 'periodos_sin_cerrar', cantidad: String(pAbiertos) } },
        );
      }
      if (cVencidas > UMBRAL_CONCILIACIONES_VENCIDAS) {
        await capturarMensaje(
          `Hay ${cVencidas} excepción(es) de conciliación vencida(s) (fecha límite superada).`,
          'warning',
          { origen: 'job:plataforma/verificarSalud', correlacionId: runId, etiquetas: { tipo: 'conciliaciones_vencidas', cantidad: String(cVencidas) } },
        );
      }

      return { periodosAbiertosVencidos: pAbiertos, conciliacionesVencidas: cVencidas };
    });

    // =========================================================================
    // C. Integridad estructural — líneas de cobro huérfanas por tenant.
    // =========================================================================
    const lineasHuerfanas = await step.run('integridad-lineas-huerfanas', async () => {
      const supabase = crearClienteServiceRole();

      const { data: tenants, error: errTenants } = await supabase
        .schema('identidad')
        .from('tenants')
        .select('id')
        .neq('estado', 'suspendido');
      if (errTenants) throw new Error(`Watchdog · Error al listar tenants: ${errTenants.message}`);

      let total = 0;
      for (const t of tenants ?? []) {
        const tenantId = t.id as string;
        try {
          const nuevas = await detectarLineasCobroHuerfanas(supabase, tenantId, runId);
          if (nuevas > 0) {
            total += nuevas;
            await capturarMensaje(
              `Integridad: ${nuevas} línea(s) de cobro huérfana(s) detectada(s).`,
              'warning',
              { origen: 'job:plataforma/verificarSalud', tenantId, correlacionId: runId, etiquetas: { tipo: 'lineas_huerfanas', nuevas: String(nuevas) } },
            );
          }
        } catch (err) {
          // Un tenant que falle no cancela el barrido de los demás.
          logger.error(`Watchdog integridad [tenant=${tenantId}]: ${(err as Error).message}`);
        }
      }
      return total;
    });

    logger.info(
      `Watchdog completado · crons_alertados=${cronsAlertados} · ` +
      `periodos_sin_cerrar=${backlog.periodosAbiertosVencidos} · ` +
      `conciliaciones_vencidas=${backlog.conciliacionesVencidas} · lineas_huerfanas=${lineasHuerfanas}.`,
    );

    return {
      resultado: 'completado',
      cronsAlertados,
      periodosAbiertosVencidos: backlog.periodosAbiertosVencidos,
      conciliacionesVencidas: backlog.conciliacionesVencidas,
      lineasHuerfanas,
    };
  },
);
