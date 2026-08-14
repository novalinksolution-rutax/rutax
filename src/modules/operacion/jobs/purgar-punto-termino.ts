/**
 * Purga del punto de término de ruta del conductor.
 * =============================================================================
 * Cierra la condición C5 de `docs/seguridad/punto-de-termino-conductor.md`:
 * *"Purga: al revocar, al desvincular y por inactividad. **No basta
 * `activa = false`**"*.
 *
 * ## Por qué existe este job, y por qué se escribe JUNTO con la tabla
 *
 * El molde de esta tabla es `operacion.ubicacion_conductor`, que se retiró el
 * 2026-08-14 precisamente por no tenerlo. Ahí los tres caminos de borrado
 * dependían de que alguien hiciera algo —completar un manifiesto, desmontar un
 * componente, revocar desde una interfaz que nunca existió— y los tres fallaban
 * juntos en el escenario normal. Sin job, la última posición del día (a menudo
 * el domicilio del conductor) sobrevivía sin límite de tiempo. La lección no es
 * "faltó un job": es que **un borrado que depende de una acción humana no es un
 * borrado**. Por eso este se entrega en el mismo cambio que la tabla.
 *
 * ## Lo que NO se copia del molde de purga (`purgar-evidencias.ts`)
 *
 * **Las retenciones legales.** Allí una evidencia sobrevive a su edad si hay
 * incidencia abierta o cobro impago, porque PRUEBA algo. El punto de término no
 * prueba nada: no respalda un pago, no defiende un cobro, no tiene valor
 * contable. **Nunca se retiene por un asunto abierto** y no pasa por
 * `pedidosConRetencion()`. Si alguna vez alguien quiere "conservarlo por si
 * acaso", eso es conservar el domicilio de un trabajador sin motivo.
 *
 * ## Los tres motivos de borrado
 *
 *   1. `conductor_no_activo` — red de §5.4. El vínculo laboral era la única
 *      razón por la que el dato existía. La acción que da de baja al conductor
 *      debería borrarlo en el momento
 *      (`borrarPuntoTerminoPorDesvinculacion`), pero al 2026-08-14 **esa acción
 *      todavía no existe en el repo**: hoy este job es el único que lo cubre.
 *   2. `sin_consentimiento_vigente` — red de §5.3. La fila no puede existir sin
 *      la base de licitud que la sostiene. Si por un bug la revocación borró el
 *      consentimiento pero no la fila, esto lo corrige al día siguiente.
 *   3. `inactividad` — 90 días sin un solo manifiesto. Un conductor que no
 *      trabaja hace tres meses no necesita que se le guarde dónde vive. 90 días
 *      alinea con la retención de imágenes ya vigente y con lo decidido para el
 *      piloto.
 *
 * ## Cadencia
 *
 * Diaria, 03:40 de Santiago — diez minutos después de `purgarEvidencias`, para
 * no competir por conexiones. La cadencia HORARIA que el documento pide en §7
 * es para el otro paso (`purgar-ubicaciones-rancias`, el hallazgo H-1), donde
 * el reloj sí importaba porque el dato entraba durante el turno y el conductor
 * llegaba a su casa de noche. Aquí no: el punto de término lo escribe el propio
 * conductor a mano y su vida útil se mide en meses, no en horas.
 */

import { inngest } from '@/lib/inngest/cliente';
import { fechaLocalEnSantiago, sumarDiasCalendario } from '@/lib/fecha-santiago';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { leerTodasLasFilas } from '@/lib/supabase/leer-paginado';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { FINALIDAD_PUNTO_TERMINO } from '@/modules/operacion/punto-termino-conductor';

/** Días sin actividad operativa tras los que el punto de término se borra. */
export const DIAS_INACTIVIDAD_PUNTO_TERMINO = 90;

/**
 * Tamaño de lote. Por debajo del `max_rows` de PostgREST (1000) y lejos del
 * largo máximo de URL de un `.in(...)` — las dos formas de romperse en silencio
 * que ya mordieron a este repo.
 */
const LOTE = 100;

export type MotivoPurga =
  | 'conductor_no_activo'
  | 'sin_consentimiento_vigente'
  | 'inactividad';

/** Una fila candidata, con lo mínimo para decidir. Sin coordenadas: no hacen falta. */
export interface FilaPuntoTermino {
  conductor_id: string;
  tenant_id: string;
}

export interface EntradaClasificacion {
  filas: FilaPuntoTermino[];
  /** conductor_id → estado en `identidad.conductores`. */
  estadoConductor: Map<string, string>;
  /** conductor_id de los que TIENEN consentimiento vigente de punto de término. */
  conConsentimiento: Set<string>;
  /** conductor_id con al menos un manifiesto dentro de la ventana de actividad. */
  conActividad: Set<string>;
}

/**
 * Decide, para cada fila, si se borra y por qué. Pura y exportada: es la lógica
 * que hay que poder probar sin levantar media base de datos.
 *
 * El orden de los motivos importa solo para el diagnóstico (una fila puede
 * cumplir varios); se reporta el primero, que es el más específico.
 *
 * ⚠️ Un conductor cuyo estado no se pudo leer se trata como NO activo y se
 * borra. Es el sentido correcto de fallar: ante la duda, no conservar un dato
 * personal que ya nadie puede justificar.
 */
export function clasificarPuntosTermino(
  entrada: EntradaClasificacion,
): { fila: FilaPuntoTermino; motivo: MotivoPurga }[] {
  const aBorrar: { fila: FilaPuntoTermino; motivo: MotivoPurga }[] = [];

  for (const fila of entrada.filas) {
    const estado = entrada.estadoConductor.get(fila.conductor_id);

    if (estado !== 'activo') {
      aBorrar.push({ fila, motivo: 'conductor_no_activo' });
      continue;
    }
    if (!entrada.conConsentimiento.has(fila.conductor_id)) {
      aBorrar.push({ fila, motivo: 'sin_consentimiento_vigente' });
      continue;
    }
    if (!entrada.conActividad.has(fila.conductor_id)) {
      aBorrar.push({ fila, motivo: 'inactividad' });
    }
  }

  return aBorrar;
}

/**
 * Fecha (yyyy-mm-dd) a partir de la cual una jornada cuenta como actividad.
 *
 * Se calcula en el CALENDARIO de Santiago, no restando milisegundos a un
 * instante UTC: `manifiestos.fecha_operacion` es una fecha civil chilena, y el
 * job corre de madrugada, que es justo cuando el día UTC y el día chileno son
 * distintos. Restar 90×24 h y truncar en UTC movería el corte un día según la
 * época del año (el guard `fecha-santiago.guard.test.ts` lo atrapa).
 */
export function fechaCorteActividad(ahora: Date, dias: number): string {
  return sumarDiasCalendario(fechaLocalEnSantiago(ahora), -dias);
}

export const jobPurgarPuntoTermino = inngest.createFunction(
  {
    id: 'operacion/purgarPuntoTermino',
    name: 'Operación · Purgar punto de término del conductor (retención)',
    // 03:40 de Santiago, diez minutos después de purgarEvidencias.
    triggers: [{ cron: 'TZ=America/Santiago 40 3 * * *' }],
    retries: 2,
  },
  async ({ step, logger, runId }) => {
    const corteActividad = fechaCorteActividad(
      new Date(),
      DIAS_INACTIVIDAD_PUNTO_TERMINO,
    );

    const resultado = await step.run('purgar-puntos-termino', async () => {
      const supabase = crearClienteServiceRole();

      let borradas = 0;
      let revisadas = 0;
      /** tenant → { motivo → cuántas }. La bitácora se emite por courier. */
      const porTenant: Record<string, Record<MotivoPurga, number>> = {};
      const acumular = (t: string) =>
        (porTenant[t] ??= {
          conductor_no_activo: 0,
          sin_consentimiento_vigente: 0,
          inactividad: 0,
        });

      // Paginación por CLAVE (conductor_id > cursor), no por offset: el offset
      // se descoloca cuando el propio recorrido borra filas, y saltaría
      // candidatos sin que nada lo delate.
      let cursor = '00000000-0000-0000-0000-000000000000';

      for (;;) {
        const { data, error } = await supabase
          .schema('operacion')
          .from('punto_termino_conductor')
          .select('conductor_id, tenant_id')
          .gt('conductor_id', cursor)
          .order('conductor_id')
          .limit(LOTE);

        if (error) {
          throw new Error(`Purga punto de término · Error al leer candidatos: ${error.message}`);
        }

        const filas = (data ?? []) as FilaPuntoTermino[];
        if (filas.length === 0) break;

        revisadas += filas.length;
        cursor = filas[filas.length - 1].conductor_id;
        const ids = filas.map((f) => f.conductor_id);

        // --- Estado del conductor ---------------------------------------------
        const { data: conductores, error: errCond } = await supabase
          .schema('identidad')
          .from('conductores')
          .select('id, estado')
          .in('id', ids);
        if (errCond) {
          throw new Error(`Purga punto de término · Error al leer conductores: ${errCond.message}`);
        }
        const estadoConductor = new Map<string, string>(
          (conductores ?? []).map((c) => [c.id as string, c.estado as string]),
        );

        // --- Consentimiento vigente DE ESTA FINALIDAD --------------------------
        // Se traen todos los registros de la finalidad para el lote y se resuelve
        // el vigente en memoria: el modelo es "el más reciente manda", y eso no
        // se puede expresar en un solo filtro de PostgREST.
        const consentimientos = await leerTodasLasFilas<{
          conductor_id: string;
          acepto: boolean;
          revocado_en: string | null;
          otorgado_en: string;
        }>('consentimientos de punto de término', (desde, hasta) =>
          supabase
            .schema('operacion')
            .from('consentimientos_ubicacion')
            .select('conductor_id, acepto, revocado_en, otorgado_en')
            .eq('finalidad', FINALIDAD_PUNTO_TERMINO)
            .in('conductor_id', ids)
            .order('otorgado_en', { ascending: false })
            .range(desde, hasta),
        );

        const conConsentimiento = new Set<string>();
        const yaVisto = new Set<string>();
        for (const c of consentimientos) {
          if (yaVisto.has(c.conductor_id)) continue; // solo el más reciente manda
          yaVisto.add(c.conductor_id);
          if (c.acepto === true && c.revocado_en === null) {
            conConsentimiento.add(c.conductor_id);
          }
        }

        // --- Actividad operativa en la ventana ---------------------------------
        const { data: manifiestos, error: errMan } = await supabase
          .schema('operacion')
          .from('manifiestos')
          .select('driver_id')
          .in('driver_id', ids)
          .gte('fecha_operacion', corteActividad);
        if (errMan) {
          throw new Error(`Purga punto de término · Error al leer manifiestos: ${errMan.message}`);
        }
        const conActividad = new Set<string>(
          (manifiestos ?? []).map((m) => m.driver_id as string),
        );

        // --- Decidir y borrar --------------------------------------------------
        const aBorrar = clasificarPuntosTermino({
          filas,
          estadoConductor,
          conConsentimiento,
          conActividad,
        });
        if (aBorrar.length === 0) continue;

        // Por tenant: el DELETE lleva SIEMPRE su filtro de tenant, aunque
        // conductor_id sea la PK. Un id que viene de una lectura previa nunca se
        // usa solo.
        const porTenantIds = new Map<string, string[]>();
        for (const { fila, motivo } of aBorrar) {
          const lista = porTenantIds.get(fila.tenant_id) ?? [];
          lista.push(fila.conductor_id);
          porTenantIds.set(fila.tenant_id, lista);
          acumular(fila.tenant_id)[motivo] += 1;
        }

        for (const [tenantId, conductorIds] of porTenantIds) {
          const { error: errDel } = await supabase
            .schema('operacion')
            .from('punto_termino_conductor')
            .delete()
            .eq('tenant_id', tenantId)
            .in('conductor_id', conductorIds);
          if (errDel) {
            throw new Error(
              `Purga punto de término · Error al borrar: ${errDel.message}`,
            );
          }
          borradas += conductorIds.length;
        }

        if (filas.length < LOTE) break;
      }

      return { borradas, revisadas, porTenant };
    });

    // -----------------------------------------------------------------------
    // Bitácora: UN ASIENTO POR COURIER, no uno global y no uno por fila.
    //
    // Por courier porque el borrado de datos personales pertenece a SU rastro de
    // auditoría, y porque el CHECK `bitacora_auditoria_tenant_nulo_solo_plataforma`
    // reserva `tenant_id` nulo a acciones de plataforma con actor super_admin.
    //
    // Y NUNCA por fila: anotar cada borrado dejaría un registro permanente de
    // qué conductor tenía punto de término, que es justo lo contrario de lo que
    // persigue la política. El asiento dice que la purga corrió y con qué
    // criterio, sin nombrar a nadie.
    // -----------------------------------------------------------------------
    await step.run('registrar-bitacora', async () => {
      const supabase = crearClienteServiceRole();
      const tenants = Object.keys(resultado.porTenant);

      for (const tenantId of tenants) {
        const motivos = resultado.porTenant[tenantId];
        await registrarEnBitacora(supabase, {
          tenantId,
          actorUsuarioId: null,
          actorTipo: 'sistema',
          accion: 'operacion.punto_termino_purgado_por_retencion',
          entidadTipo: 'politica_retencion',
          entidadId: null,
          detalle: {
            dias_inactividad: DIAS_INACTIVIDAD_PUNTO_TERMINO,
            borrados_por_conductor_no_activo: motivos.conductor_no_activo,
            borrados_por_sin_consentimiento: motivos.sin_consentimiento_vigente,
            borrados_por_inactividad: motivos.inactividad,
            // Sin conductor_id, sin coordenadas, sin comunas: el asiento
            // registra el HECHO, nunca a quién ni dónde.
            job_run_id: runId,
          },
        });
      }

      return { tenantsRegistrados: tenants.length };
    });

    logger.info(
      `Purga punto de término completada · revisadas=${resultado.revisadas} · ` +
        `borradas=${resultado.borradas}.`,
    );

    return {
      resultado: 'completado',
      revisadas: resultado.revisadas,
      borradas: resultado.borradas,
    };
  },
);
