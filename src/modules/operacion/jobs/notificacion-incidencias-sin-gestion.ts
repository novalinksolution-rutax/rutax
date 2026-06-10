/**
 * Job G-06 · operacion/notificacionIncidenciasSinGestion
 * =====================================================================
 * Trigger: Cron `* /30 * * * *` (cada 30 minutos, todos los días)
 * Nota: el cron real usa 5 campos sin segundos (el Inngest Dev Server local
 * NO soporta 6 campos — ver `alerta-folios-proximos.ts` y `conexion-caida.ts`).
 *
 * Responsabilidad:
 * - Recorrer TODAS las incidencias de TODOS los tenants con
 *   `estado IN ('abierta', 'en_gestion')`.
 * - Detectar las que llevan más de `UMBRAL_INCIDENCIA_SIN_GESTION_HORAS` horas
 *   abiertas sin pasar a gestión (criterio B-6).
 * - Registrar una notificación interna en bitácora (máx. 1 por incidencia por
 *   día, en zona horaria America/Santiago) y loguearla con `logger.warn`.
 *
 * Idempotencia:
 * - Antes de registrar, verificar que no existe ya una entrada en
 *   `bitacora_auditoria` con `accion = 'operacion.notificacion_incidencia_sin_gestion'`,
 *   `entidad_tipo = 'incidencia'`, `entidad_id = incidencia.id` y `tenant_id`
 *   correspondiente, creada hoy (Santiago). Si existe, se omite.
 *
 * SEGURIDAD:
 * - El log y el detalle de bitácora incluyen SOLO: tenant_id, pedido_id,
 *   seller_id, incidencia.id, tipo de incidencia y horas_abierta.
 * - NUNCA datos personales del destinatario (nombre, dirección, teléfono).
 * - El envío real de notificación (email vía Resend) queda pendiente para
 *   Fase C/devops — ver TODO en el paso 2, igual que en `conexion-caida.ts`.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';

const TZ = 'America/Santiago';

/** Umbral en horas para considerar una incidencia "sin gestión" (criterio B-6). */
export const UMBRAL_INCIDENCIA_SIN_GESTION_HORAS = 4;

/**
 * Devuelve la fecha de hoy en formato YYYY-MM-DD en zona horaria de Santiago.
 * Se usa como clave de deduplicación: máximo una notificación por incidencia
 * por día.
 */
function hoyEnSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Calcula las horas transcurridas desde una fecha ISO hasta ahora.
 *
 * Lógica pura, copiada de `src/lib/ui/traduccion-estados.ts` (función
 * `horasDesde`) para no acoplar el módulo `operacion` (servidor) a `lib/ui`
 * (que puede tener dependencias client-only). Si ambas implementaciones
 * divergen en el futuro, esta es la fuente de verdad para jobs de servidor.
 */
export function horasDesde(fechaIso: string): number {
  const ms = Date.now() - new Date(fechaIso).getTime();
  return ms / (1000 * 60 * 60);
}

/**
 * Verdadero si la incidencia está abierta y supera el umbral de horas sin
 * pasar a gestión (criterio B-6). Réplica pura de `esIncidenciaSinGestion`
 * de `lib/ui/traduccion-estados.ts`.
 */
export function esIncidenciaSinGestion(estado: string, abiertaEn: string): boolean {
  if (estado !== 'abierta') return false;
  return horasDesde(abiertaEn) > UMBRAL_INCIDENCIA_SIN_GESTION_HORAS;
}

/** Forma mínima de una fila de `operacion.incidencias` para este job. */
export interface IncidenciaParaNotificar {
  id: string;
  tenant_id: string;
  seller_id: string;
  pedido_id: string;
  tipo: string;
  estado: string;
  abierta_en: string;
}

/**
 * Filtra, a partir de las incidencias con estado IN ('abierta', 'en_gestion'),
 * las que llevan más de `UMBRAL_INCIDENCIA_SIN_GESTION_HORAS` horas abiertas
 * sin pasar a gestión. Función pura — testeable sin Supabase.
 */
export function filtrarIncidenciasSinGestion(
  incidencias: IncidenciaParaNotificar[],
): IncidenciaParaNotificar[] {
  return incidencias.filter((inc) => esIncidenciaSinGestion(inc.estado, inc.abierta_en));
}

export const jobNotificacionIncidenciasSinGestion = inngest.createFunction(
  {
    id: 'operacion/notificacionIncidenciasSinGestion',
    name: 'Operación · Notificar incidencias sin gestión',
    triggers: [{ cron: '*/30 * * * *' }],
    retries: 1,
  },
  async ({ step, logger }) => {
    // Paso 1: Detectar incidencias abiertas/en_gestion que superan el umbral.
    const incidenciasSinGestion = await step.run('detectar-incidencias-sin-gestion', async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .from('incidencias')
        .select('id, tenant_id, seller_id, pedido_id, tipo, estado, abierta_en')
        .in('estado', ['abierta', 'en_gestion']);

      if (error) throw new Error(`Error al leer incidencias: ${error.message}`);

      // Filtrar en TypeScript (cálculo de horas no es expresable en el filtro de Supabase JS).
      return filtrarIncidenciasSinGestion((data ?? []) as IncidenciaParaNotificar[]);
    });

    logger.info(`Incidencias sin gestión detectadas: ${incidenciasSinGestion.length}`);

    if (incidenciasSinGestion.length === 0) {
      return { incidenciasDetectadas: 0, notificacionesEmitidas: 0 };
    }

    // Paso 2: emitir notificación por cada incidencia (máx. 1 por día, dedupe en bitácora).
    const notificacionesEmitidas = await step.run('emitir-notificaciones', async () => {
      const supabase = crearClienteServiceRole();
      const hoy = hoyEnSantiago();
      let emitidas = 0;

      for (const incidencia of incidenciasSinGestion) {
        const tenantId = incidencia.tenant_id;
        const horasAbierta = horasDesde(incidencia.abierta_en);

        // Verificar que no se haya notificado ya hoy para esta incidencia.
        const { data: notificacionHoy } = await supabase
          .from('bitacora_auditoria')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('accion', 'operacion.notificacion_incidencia_sin_gestion')
          .eq('entidad_tipo', 'incidencia')
          .eq('entidad_id', incidencia.id)
          .gte('creado_en', `${hoy}T00:00:00`)
          .lte('creado_en', `${hoy}T23:59:59`)
          .limit(1)
          .maybeSingle();

        if (notificacionHoy) {
          logger.info(
            `Tenant ${tenantId}: incidencia ${incidencia.id} ya notificada hoy. Omitiendo.`,
          );
          continue;
        }

        // Registrar en bitácora.
        // SOLO datos no sensibles: tenant_id, pedido_id, seller_id, tipo, horas_abierta.
        // NUNCA datos personales del destinatario.
        await registrarEnBitacora(supabase, {
          tenantId,
          actorUsuarioId: null,
          actorTipo: 'sistema',
          accion: 'operacion.notificacion_incidencia_sin_gestion',
          entidadTipo: 'incidencia',
          entidadId: incidencia.id,
          detalle: {
            pedido_id: incidencia.pedido_id,
            seller_id: incidencia.seller_id,
            tipo: incidencia.tipo,
            horas_abierta: Math.round(horasAbierta * 100) / 100,
          },
        });

        logger.warn(
          `Tenant ${tenantId}: incidencia ${incidencia.id} (pedido ${incidencia.pedido_id}, ` +
          `tipo ${incidencia.tipo}) sin gestión hace ${horasAbierta.toFixed(1)}h.`,
        );

        // TODO (Fase C/devops): implementar envío de email/notificación push
        // con Resend al supervisor/dueño del tenant, igual que en
        // `conexion-caida.ts`. Estructura lista — falta solo el llamado al
        // proveedor de email (datos del destinatario interno se resuelven vía
        // `identidad.usuarios_perfil` + `auth.admin.getUserById`, sin tokens
        // ni secretos en el log).

        emitidas++;
      }

      return emitidas;
    });

    logger.info(`Notificaciones de incidencias sin gestión emitidas: ${notificacionesEmitidas}.`);

    return {
      incidenciasDetectadas: incidenciasSinGestion.length,
      notificacionesEmitidas,
    };
  },
);
