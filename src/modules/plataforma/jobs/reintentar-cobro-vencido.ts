/**
 * Job · plataforma/reintentarCobroVencido (F2 "Ola 3", ítem F — dunning).
 * =============================================================================
 * Trigger: Cron `30 8 * * *` (08:30 hora Santiago, diario) — justo después de
 * `plataforma/marcarMorosidad` (08:00), que es quien primero marca los
 * períodos `vencido`.
 *
 * Responsabilidad — dos ramas sobre TODO período `estado='vencido'`:
 *
 *  A. REINTENTO DEL AUTO-COBRO (solo si la suscripción tiene mandato activo):
 *     compone `ejecutarYPersistirAutoCobro` (`jobs/cobrar-periodo-auto.ts`) —
 *     NO duplica la lógica de cobro/persistencia, solo decide CUÁNDO
 *     reintentar según un backoff creciente (`BACKOFF_DIAS_REINTENTO_COBRO`) y
 *     un tope de intentos (`MAX_REINTENTOS_COBRO_VENCIDO`), ambos acotados por
 *     el PERÍODO DE GRACIA (`DIAS_GRACIA_MOROSIDAD`).
 *  B. ESCALAMIENTO — cuando un período supera el período de gracia (sin
 *     importar si tiene o no auto-cobro), SUGIERE la suspensión al
 *     super-admin (`capturarMensaje`, deduplicado "una vez" por período vía
 *     bitácora). NUNCA auto-suspende — la suspensión sigue siendo SIEMPRE una
 *     acción MANUAL del super-admin (`suspenderSuscripcion`), mismo principio
 *     que `jobs/marcar-morosidad.ts`.
 *
 * "Intentos previos" y "último intento" se derivan de `pagos_plataforma`
 * (`metodo='fintoc_recurrente', estado='fallido'`) — SIN columnas nuevas: cada
 * intento (inicial o de reintento) ya deja una fila ahí vía
 * `ejecutarYPersistirAutoCobro`.
 *
 * Idempotencia: `ejecutarYPersistirAutoCobro` usa `idempotencyKey =
 * susc-cobro-${periodoId}` (determinística) — un reintento de ESTE cron nunca
 * genera un doble cargo, sin importar cuántas veces se ejecute. Un fallo en
 * una suscripción no cancela las demás (`Promise.allSettled`).
 */

import { NonRetriableError } from 'inngest';
import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { capturarMensaje } from '@/lib/observabilidad';
import { ahoraEnSantiago, diferenciaEnDiasCalendario } from '@/lib/fecha-santiago';
import { ejecutarYPersistirAutoCobro } from './cobrar-periodo-auto';

/**
 * Backoff creciente: días de espera desde el ÚLTIMO intento fallido antes del
 * SIGUIENTE reintento, indexado por número de intentos previos (0 = todavía no
 * se ha reintentado desde que venció → reintenta de inmediato). El largo del
 * array también define `MAX_REINTENTOS_COBRO_VENCIDO`.
 */
export const BACKOFF_DIAS_REINTENTO_COBRO: readonly number[] = [1, 3, 7, 14];

/** Tope de reintentos automáticos de un mismo período vencido. */
export const MAX_REINTENTOS_COBRO_VENCIDO = BACKOFF_DIAS_REINTENTO_COBRO.length;

/** Período de gracia (días desde `vence_en`) antes de sugerir suspensión al super-admin. */
export const DIAS_GRACIA_MOROSIDAD = 15;

const ACCION_SUGERENCIA_SUSPENSION = 'plataforma.sugerencia_suspension_emitida';

export type AccionReintentoCobroVencido =
  | 'reintentar'
  | 'esperar_backoff'
  | 'max_reintentos_alcanzado'
  | 'gracia_agotada';

/**
 * Decide qué hacer con un período `vencido` con mandato de auto-cobro activo.
 * Función PURA — testeable sin BD ni runtime de Inngest (mismo patrón que
 * `decidirAccionAutoCobro`, `jobs/cobrar-periodo-auto.ts`).
 *
 * Orden de evaluación: la gracia agotada SIEMPRE gana (deja de reintentar y
 * escala), luego el tope de intentos, luego el backoff.
 */
export function decidirReintentoCobroVencido(args: {
  intentosFallidosPrevios: number;
  diasDesdeVencimiento: number;
  /** `null` si nunca hubo un intento (inicial o de reintento) para este período. */
  diasDesdeUltimoIntento: number | null;
}): AccionReintentoCobroVencido {
  if (args.diasDesdeVencimiento > DIAS_GRACIA_MOROSIDAD) return 'gracia_agotada';
  if (args.intentosFallidosPrevios >= MAX_REINTENTOS_COBRO_VENCIDO) return 'max_reintentos_alcanzado';

  if (args.diasDesdeUltimoIntento === null) return 'reintentar';

  const diasEspera = BACKOFF_DIAS_REINTENTO_COBRO[args.intentosFallidosPrevios] ?? Infinity;
  return args.diasDesdeUltimoIntento >= diasEspera ? 'reintentar' : 'esperar_backoff';
}

interface PeriodoVencidoElegible {
  periodoId: string;
  tenantId: string;
  suscripcionId: string;
  montoClp: number;
  periodoInicio: string;
  periodoFin: string;
  venceEn: string;
  autoCobroHabilitado: boolean;
  mandatoEstado: string;
  mandatoRef: string | null;
}

export const jobReintentarCobroVencido = inngest.createFunction(
  {
    id: 'plataforma/reintentarCobroVencido',
    name: 'Plataforma · Reintentar auto-cobro de períodos vencidos (dunning)',
    triggers: [{ cron: '30 8 * * *' }],
    retries: 1,
  },
  async ({ step, logger }) => {
    const hoy = ahoraEnSantiago().fecha;

    // =========================================================================
    // Step 1 — listar períodos vencidos + gate de la suscripción + intentos previos.
    // =========================================================================
    const elegibles = await step.run('listar-vencidos', async () => {
      const supabase = crearClienteServiceRole();

      const { data: periodos, error: errPeriodos } = await supabase
        .schema('plataforma')
        .from('periodos_suscripcion')
        .select('id, tenant_id, suscripcion_id, monto_clp, periodo_inicio, periodo_fin, vence_en')
        .eq('estado', 'vencido');
      if (errPeriodos) throw new Error(`Error al listar períodos vencidos: ${errPeriodos.message}`);
      if (!periodos || periodos.length === 0) return [];

      const suscripcionIds = [...new Set(periodos.map((p) => p.suscripcion_id as string))];
      const { data: suscripciones, error: errSusc } = await supabase
        .schema('plataforma')
        .from('suscripciones')
        .select('id, auto_cobro_habilitado, mandato_estado, mandato_ref')
        .in('id', suscripcionIds);
      if (errSusc) throw new Error(`Error al leer suscripciones: ${errSusc.message}`);
      const suscMap = new Map((suscripciones ?? []).map((s) => [s.id as string, s]));

      return periodos
        .filter((p) => p.vence_en) // sin fecha de vencimiento no hay gracia que calcular
        .map((p): PeriodoVencidoElegible => {
          const susc = suscMap.get(p.suscripcion_id as string);
          return {
            periodoId: p.id as string,
            tenantId: p.tenant_id as string,
            suscripcionId: p.suscripcion_id as string,
            montoClp: Number(p.monto_clp),
            periodoInicio: p.periodo_inicio as string,
            periodoFin: p.periodo_fin as string,
            venceEn: p.vence_en as string,
            autoCobroHabilitado: Boolean(susc?.auto_cobro_habilitado),
            mandatoEstado: (susc?.mandato_estado as string | null) ?? 'sin_mandato',
            mandatoRef: (susc?.mandato_ref as string | null) ?? null,
          };
        });
    });

    logger.info(`Períodos vencidos a evaluar: ${elegibles.length}`);

    if (elegibles.length === 0) {
      return { reintentados: 0, sugerenciasSuspension: 0 };
    }

    // =========================================================================
    // Step 2 — leer intentos previos (pagos_plataforma fallidos) por período.
    // =========================================================================
    const historialIntentos = await step.run('leer-historial-intentos', async () => {
      const supabase = crearClienteServiceRole();
      const periodoIds = elegibles.map((p) => p.periodoId);

      const { data: pagos, error } = await supabase
        .schema('plataforma')
        .from('pagos_plataforma')
        .select('periodo_id, registrado_en')
        .in('periodo_id', periodoIds)
        .eq('metodo', 'fintoc_recurrente')
        .eq('estado', 'fallido');
      if (error) throw new Error(`Error al leer historial de intentos: ${error.message}`);

      const porPeriodo = new Map<string, { intentos: number; ultimoIntentoEn: string }>();
      for (const pago of pagos ?? []) {
        const pid = pago.periodo_id as string;
        const registradoEn = pago.registrado_en as string;
        const actual = porPeriodo.get(pid);
        if (!actual) {
          porPeriodo.set(pid, { intentos: 1, ultimoIntentoEn: registradoEn });
        } else {
          actual.intentos += 1;
          if (registradoEn > actual.ultimoIntentoEn) actual.ultimoIntentoEn = registradoEn;
        }
      }
      return Object.fromEntries(porPeriodo);
    });

    // =========================================================================
    // Step 3 — decidir y ejecutar (reintento de cobro / sugerencia de suspensión).
    // =========================================================================
    const resultado = await step.run('procesar-vencidos', async () => {
      const supabase = crearClienteServiceRole();
      let reintentados = 0;
      let sugerenciasSuspension = 0;

      const settled = await Promise.allSettled(
        elegibles.map(async (periodo) => {
          const historial = historialIntentos[periodo.periodoId] as
            | { intentos: number; ultimoIntentoEn: string }
            | undefined;
          const diasDesdeVencimiento = diferenciaEnDiasCalendario(periodo.venceEn, hoy);
          const diasDesdeUltimoIntento = historial
            ? diferenciaEnDiasCalendario(historial.ultimoIntentoEn.slice(0, 10), hoy)
            : null;

          const gateAutoCobro = periodo.autoCobroHabilitado && periodo.mandatoEstado === 'activo' && periodo.mandatoRef;

          if (gateAutoCobro) {
            const accion = decidirReintentoCobroVencido({
              intentosFallidosPrevios: historial?.intentos ?? 0,
              diasDesdeVencimiento,
              diasDesdeUltimoIntento,
            });

            if (accion === 'reintentar') {
              try {
                await ejecutarYPersistirAutoCobro(supabase, {
                  tenantId: periodo.tenantId,
                  suscripcionId: periodo.suscripcionId,
                  periodoId: periodo.periodoId,
                  montoClp: periodo.montoClp,
                  periodoInicio: periodo.periodoInicio,
                  periodoFin: periodo.periodoFin,
                  mandatoRef: periodo.mandatoRef as string,
                });
                reintentados++;
              } catch (err) {
                // No reintentable (mandato no descifra / config del proveedor):
                // registrar y seguir con los demás períodos — este cron corre
                // de nuevo mañana, y `decidirReintentoCobroVencido` igual
                // escalará a `gracia_agotada` cuando corresponda.
                if (!(err instanceof NonRetriableError)) throw err;
                logger.warn(`Reintento de cobro no reintentable para período ${periodo.periodoId}: ${err.message}`);
              }
              return;
            }

            if (accion !== 'gracia_agotada') return; // esperar_backoff / max_reintentos_alcanzado: nada que hacer hoy
          }

          // Gracia agotada (con o sin auto-cobro) → sugerir suspensión, deduplicado "una vez" por período.
          if (diasDesdeVencimiento <= DIAS_GRACIA_MOROSIDAD) return;

          const { data: yaSugerido } = await supabase
            .from('bitacora_auditoria')
            .select('id')
            .eq('tenant_id', periodo.tenantId)
            .eq('accion', ACCION_SUGERENCIA_SUSPENSION)
            .eq('entidad_id', periodo.periodoId)
            .limit(1)
            .maybeSingle();
          if (yaSugerido) return;

          await registrarEnBitacora(supabase, {
            tenantId: periodo.tenantId,
            actorUsuarioId: null,
            actorTipo: 'sistema',
            accion: ACCION_SUGERENCIA_SUSPENSION,
            entidadTipo: 'periodo_suscripcion',
            entidadId: periodo.periodoId,
            detalle: { dias_atraso: diasDesdeVencimiento, dias_gracia: DIAS_GRACIA_MOROSIDAD },
          });

          await capturarMensaje(
            `Suscripción ${periodo.suscripcionId} (tenant ${periodo.tenantId}): período vencido hace ` +
              `${diasDesdeVencimiento} días (gracia: ${DIAS_GRACIA_MOROSIDAD}). Sugerencia: evaluar suspensión manual.`,
            'warning',
            {
              origen: 'job:plataforma/reintentarCobroVencido',
              tenantId: periodo.tenantId,
              etiquetas: { periodo_id: periodo.periodoId, dias_atraso: String(diasDesdeVencimiento) },
            },
          );
          sugerenciasSuspension++;
        }),
      );

      for (const r of settled) {
        if (r.status === 'rejected') logger.error(`Error al procesar un período vencido: ${String(r.reason)}`);
      }

      return { reintentados, sugerenciasSuspension };
    });

    logger.info(
      `Dunning: ${resultado.reintentados} reintento(s) de cobro, ${resultado.sugerenciasSuspension} sugerencia(s) de suspensión.`,
    );

    return resultado;
  },
);
