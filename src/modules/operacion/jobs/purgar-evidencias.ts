/**
 * Purga de evidencias de entrega por retención (Ley 21.719 · minimización).
 * =============================================================================
 * Cumple la política decidida el 2026-08-05, que separa a propósito dos cosas
 * que pesan muy distinto:
 *
 *   - **Imágenes (foto y firma): 90 días.** Es lo invasivo. Una foto de entrega
 *     puede mostrar la casa, a la persona que abrió y el entorno. 90 días cubren
 *     el cierre del período, la factura, el pago y el reclamo, con margen.
 *   - **Metadatos (quién, cuándo, coordenada, distancia al destino): 1 año.**
 *     Pesan nada, no son la imagen de nadie, y son justo lo que se necesita para
 *     defender un cobro meses después ("se entregó, a 12 metros de la dirección").
 *
 * Es minimización de verdad: se va lo invasivo y se queda lo que prueba.
 *
 * NO se purga `operacion.ubicacion_conductor` porque no hay nada que purgar: su
 * llave primaria es `conductor_id`, o sea una fila por conductor que se
 * sobrescribe. No existe rastro histórico, y por eso la minimización que exige la
 * Ley 21.431 sobre datos del repartidor ya estaba intacta.
 *
 * ## Retenciones legales (lo que NO se borra aunque cumpla la edad)
 *
 * Una evidencia atada a algo vivo no se toca, porque es la prueba de un asunto
 * que sigue abierto:
 *   1. El pedido tiene una incidencia `abierta` o `en_gestion`.
 *   2. El período de cobro del pedido no está pagado (`estado_cobro <> 'pagado'`).
 *
 * Esas filas se cuentan y se reportan, no se saltan en silencio: si una retención
 * crece sin parar es señal de que hay algo atascado aguas arriba.
 *
 * ## Por qué borra en dos pasos y no en uno
 *
 * El objeto de Storage y la fila viven en sistemas distintos y no hay transacción
 * que los abarque. Se borra PRIMERO el objeto y solo después se anula el path: si
 * el proceso muere en medio, queda una fila apuntando a un objeto que ya no está
 * —inofensivo, y el siguiente run lo corrige— en vez de un objeto huérfano al que
 * ya nadie apunta, que sería un dato personal vivo e invisible.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { capturarMensaje } from '@/lib/observabilidad';

/** Días que viven las imágenes (foto y firma) antes de borrarse. */
export const DIAS_RETENCION_IMAGENES = 90;

/** Días que viven los metadatos del POD antes de borrarse la fila entera. */
export const DIAS_RETENCION_METADATOS = 365;

/**
 * Tamaño de lote. Deliberadamente por debajo del `max_rows` de PostgREST (1000) y
 * lejos del largo máximo de URL de un `.in(...)`: las dos formas de romperse en
 * silencio que ya mordieron a `detectarLineasCobroHuerfanas`.
 */
const LOTE = 200;

/** Resta días a una fecha y devuelve el ISO del instante de corte. */
export function fechaCorte(ahora: Date, dias: number): string {
  const corte = new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
  return corte.toISOString();
}

interface FilaEvidencia {
  id: string;
  tenant_id: string;
  pedido_id: string;
  foto_object_path: string | null;
  firma_object_path: string | null;
}

/**
 * Pedidos que NO pueden perder su evidencia todavía, de entre los candidatos.
 * Se calcula sobre el lote, no sobre toda la base: el `.in()` va acotado.
 */
export async function pedidosConRetencion(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
  pedidoIds: string[],
): Promise<Set<string>> {
  const retenidos = new Set<string>();
  if (pedidoIds.length === 0) return retenidos;

  // 1. Incidencia viva.
  const { data: incidencias, error: errInc } = await supabase
    .schema('operacion')
    .from('incidencias')
    .select('pedido_id')
    .eq('tenant_id', tenantId)
    .in('pedido_id', pedidoIds)
    .in('estado', ['abierta', 'en_gestion']);
  if (errInc) throw new Error(`Purga · Error al leer incidencias: ${errInc.message}`);
  for (const i of incidencias ?? []) retenidos.add(i.pedido_id as string);

  // 2. Cobro no pagado. Se llega por la línea de cobro, que es quien conoce el
  //    período del pedido.
  const { data: lineas, error: errLin } = await supabase
    .schema('dinero')
    .from('lineas_cobro')
    .select('pedido_id, periodo_cobro_id')
    .eq('tenant_id', tenantId)
    .in('pedido_id', pedidoIds)
    .eq('anulada', false);
  if (errLin) throw new Error(`Purga · Error al leer lineas_cobro: ${errLin.message}`);

  const periodoDePedido = new Map<string, string>();
  for (const l of lineas ?? []) {
    const periodoId = l.periodo_cobro_id as string | null;
    // Una línea SIN período es, por definición, un cobro que aún no entró en
    // ninguna factura: retiene igual (y ya tiene su propia excepción en la
    // bandeja, ver `linea_cobro_sin_periodo`).
    if (!periodoId) retenidos.add(l.pedido_id as string);
    else periodoDePedido.set(l.pedido_id as string, periodoId);
  }

  const periodoIds = [...new Set(periodoDePedido.values())];
  if (periodoIds.length > 0) {
    const { data: periodos, error: errPer } = await supabase
      .schema('dinero')
      .from('periodos_cobro')
      .select('id, estado_cobro')
      .eq('tenant_id', tenantId)
      .in('id', periodoIds);
    if (errPer) throw new Error(`Purga · Error al leer periodos_cobro: ${errPer.message}`);

    const pagados = new Set(
      (periodos ?? [])
        .filter((p) => p.estado_cobro === 'pagado' || p.estado_cobro === 'no_aplica')
        .map((p) => p.id as string),
    );
    for (const [pedidoId, periodoId] of periodoDePedido) {
      if (!pagados.has(periodoId)) retenidos.add(pedidoId);
    }
  }

  return retenidos;
}

export const jobPurgarEvidencias = inngest.createFunction(
  {
    id: 'operacion/purgarEvidencias',
    name: 'Operación · Purgar evidencias vencidas (retención)',
    // 03:30 de Santiago, después del cierre de períodos (02:00) y de las
    // liquidaciones (02:00): así el estado de cobro del día ya está asentado
    // cuando se decide qué se puede borrar.
    triggers: [{ cron: 'TZ=America/Santiago 30 3 * * *' }],
    retries: 2,
  },
  async ({ step, logger, runId }) => {
    const ahora = new Date();
    const corteImagenes = fechaCorte(ahora, DIAS_RETENCION_IMAGENES);
    const corteMetadatos = fechaCorte(ahora, DIAS_RETENCION_METADATOS);

    // -----------------------------------------------------------------------
    // Paso 1 · Imágenes vencidas (90 días): borrar del bucket y anular el path.
    // -----------------------------------------------------------------------
    const imagenes = await step.run('purgar-imagenes', async () => {
      const supabase = crearClienteServiceRole();
      let objetosBorrados = 0;
      let filasActualizadas = 0;
      let retenidas = 0;
      // Por courier, para que la bitácora de cada uno registre lo suyo.
      const porTenant: Record<string, { objetos: number; filas: number; retenidas: number }> = {};
      const acumular = (t: string) =>
        (porTenant[t] ??= { objetos: 0, filas: 0, retenidas: 0 });

      for (const tabla of ['pruebas_entrega', 'evidencias_entrega'] as const) {
        // `evidencias_entrega` NO tiene `firma_object_path`: es el registro
        // informativo de Flex, donde el POD lo gobierna Mercado Envíos y solo se
        // guarda una foto. Hay que ajustar el `select` **y el filtro**: nombrar
        // una columna inexistente en el `.or(...)` hace fallar la consulta entera
        // (`column ... does not exist`), no la ignora.
        const tieneFirma = tabla === 'pruebas_entrega';
        const columnas = tieneFirma
          ? 'id, tenant_id, pedido_id, foto_object_path, firma_object_path'
          : 'id, tenant_id, pedido_id, foto_object_path';
        const filtroConImagen = tieneFirma
          ? 'foto_object_path.not.is.null,firma_object_path.not.is.null'
          : 'foto_object_path.not.is.null';

        for (let desde = 0; ; desde += LOTE) {
          const { data, error } = await supabase
            .schema('operacion')
            .from(tabla)
            .select(columnas)
            .lt('capturado_en', corteImagenes)
            .or(filtroConImagen)
            .order('id')
            .range(desde, desde + LOTE - 1);

          if (error) throw new Error(`Purga · Error al leer ${tabla}: ${error.message}`);
          const filas = (data ?? []) as unknown as FilaEvidencia[];
          if (filas.length === 0) break;

          // Las retenciones se calculan por tenant: cada consulta lleva su filtro.
          const porTenant = new Map<string, FilaEvidencia[]>();
          for (const f of filas) {
            const lista = porTenant.get(f.tenant_id) ?? [];
            lista.push(f);
            porTenant.set(f.tenant_id, lista);
          }

          for (const [tenantId, filasTenant] of porTenant) {
            const retenidos = await pedidosConRetencion(
              supabase,
              tenantId,
              filasTenant.map((f) => f.pedido_id),
            );

            const purgables = filasTenant.filter((f) => !retenidos.has(f.pedido_id));
            const retenidasTenant = filasTenant.length - purgables.length;
            retenidas += retenidasTenant;
            acumular(tenantId).retenidas += retenidasTenant;
            if (purgables.length === 0) continue;

            const rutas = purgables
              .flatMap((f) => [f.foto_object_path, f.firma_object_path])
              .filter((r): r is string => !!r);

            if (rutas.length > 0) {
              // PRIMERO el objeto: ver el encabezado de este archivo.
              const { error: errStorage } = await supabase.storage
                .from('pod-evidencias')
                .remove(rutas);
              if (errStorage) {
                throw new Error(`Purga · Error al borrar objetos: ${errStorage.message}`);
              }
              objetosBorrados += rutas.length;
              acumular(tenantId).objetos += rutas.length;
            }

            const { error: errUpd } = await supabase
              .schema('operacion')
              .from(tabla)
              .update(
                tieneFirma
                  ? { foto_object_path: null, firma_object_path: null }
                  : { foto_object_path: null },
              )
              .eq('tenant_id', tenantId)
              .in('id', purgables.map((f) => f.id));
            if (errUpd) throw new Error(`Purga · Error al anular paths: ${errUpd.message}`);
            filasActualizadas += purgables.length;
            acumular(tenantId).filas += purgables.length;
          }

          if (filas.length < LOTE) break;
        }
      }

      return { objetosBorrados, filasActualizadas, retenidas, porTenant };
    });

    // -----------------------------------------------------------------------
    // Paso 2 · Metadatos vencidos (1 año): borrar la fila.
    // -----------------------------------------------------------------------
    const metadatos = await step.run('purgar-metadatos', async () => {
      const supabase = crearClienteServiceRole();
      let filasBorradas = 0;
      let retenidas = 0;
      const porTenant: Record<string, { filas: number; retenidas: number }> = {};
      const acumular = (t: string) => (porTenant[t] ??= { filas: 0, retenidas: 0 });

      for (const tabla of ['pruebas_entrega', 'evidencias_entrega'] as const) {
        for (;;) {
          const { data, error } = await supabase
            .schema('operacion')
            .from(tabla)
            .select('id, tenant_id, pedido_id')
            .lt('capturado_en', corteMetadatos)
            .order('id')
            .limit(LOTE);

          if (error) throw new Error(`Purga · Error al leer ${tabla}: ${error.message}`);
          const filas = (data ?? []) as unknown as FilaEvidencia[];
          if (filas.length === 0) break;

          const porTenant = new Map<string, FilaEvidencia[]>();
          for (const f of filas) {
            const lista = porTenant.get(f.tenant_id) ?? [];
            lista.push(f);
            porTenant.set(f.tenant_id, lista);
          }

          let borradasEnVuelta = 0;
          for (const [tenantId, filasTenant] of porTenant) {
            const retenidos = await pedidosConRetencion(
              supabase,
              tenantId,
              filasTenant.map((f) => f.pedido_id),
            );
            const purgables = filasTenant.filter((f) => !retenidos.has(f.pedido_id));
            const retenidasTenant = filasTenant.length - purgables.length;
            retenidas += retenidasTenant;
            acumular(tenantId).retenidas += retenidasTenant;
            if (purgables.length === 0) continue;

            const { error: errDel } = await supabase
              .schema('operacion')
              .from(tabla)
              .delete()
              .eq('tenant_id', tenantId)
              .in('id', purgables.map((f) => f.id));
            if (errDel) throw new Error(`Purga · Error al borrar ${tabla}: ${errDel.message}`);
            filasBorradas += purgables.length;
            acumular(tenantId).filas += purgables.length;
            borradasEnVuelta += purgables.length;
          }

          // Sin avance no hay vuelta siguiente: si todo el lote está retenido, el
          // `limit` devolvería las mismas filas para siempre.
          if (borradasEnVuelta === 0) break;
        }
      }

      return { filasBorradas, retenidas, porTenant };
    });

    // -----------------------------------------------------------------------
    // Paso 3 · Bitácora: UN ASIENTO POR COURIER, no uno global.
    //
    // Es lo correcto por dos motivos, y el segundo lo impone la base. El primero
    // es que el borrado de datos personales de un courier pertenece a SU rastro
    // de auditoría: si algún día tiene que responderle a alguien qué pasó con la
    // foto de su entrega, la respuesta tiene que estar en su bitácora, no en un
    // registro global que además no puede ver. El segundo es el CHECK
    // `bitacora_auditoria_tenant_nulo_solo_plataforma`: `tenant_id` nulo se
    // reserva a acciones de plataforma con actor `super_admin`, y esto no lo es.
    //
    // Un asiento por corrida y por courier, no por fila: lo auditable es que la
    // purga corrió y con qué política. Anotar cada borrado sería, además, dejar
    // un registro permanente de qué evidencia existió — justo lo contrario de lo
    // que persigue la política.
    // -----------------------------------------------------------------------
    await step.run('registrar-bitacora', async () => {
      const supabase = crearClienteServiceRole();
      const tenants = new Set([
        ...Object.keys(imagenes.porTenant),
        ...Object.keys(metadatos.porTenant),
      ]);

      for (const tenantId of tenants) {
        const img = imagenes.porTenant[tenantId] ?? { objetos: 0, filas: 0, retenidas: 0 };
        const met = metadatos.porTenant[tenantId] ?? { filas: 0, retenidas: 0 };

        await registrarEnBitacora(supabase, {
          tenantId,
          actorUsuarioId: null,
          actorTipo: 'sistema',
          accion: 'operacion.evidencias_purgadas_por_retencion',
          entidadTipo: 'politica_retencion',
          entidadId: null,
          detalle: {
            dias_retencion_imagenes: DIAS_RETENCION_IMAGENES,
            dias_retencion_metadatos: DIAS_RETENCION_METADATOS,
            objetos_borrados: img.objetos,
            filas_con_imagen_anulada: img.filas,
            filas_borradas: met.filas,
            retenidas_por_asunto_abierto: img.retenidas + met.retenidas,
            job_run_id: runId,
          },
        });
      }

      return { tenantsRegistrados: tenants.size };
    });

    const retenidasTotal = imagenes.retenidas + metadatos.retenidas;

    // Una retención grande no es un error, pero sí algo que mirar: significa
    // evidencia vieja atada a incidencias o cobros que siguen abiertos.
    if (retenidasTotal > 0) {
      await capturarMensaje(
        `Retención: ${retenidasTotal} evidencia(s) vencida(s) NO se purgaron por tener incidencia abierta o cobro impago.`,
        'info',
        {
          origen: 'job:operacion/purgarEvidencias',
          correlacionId: runId,
          etiquetas: { tipo: 'retencion_evidencias', retenidas: String(retenidasTotal) },
        },
      );
    }

    logger.info(
      `Purga completada · objetos=${imagenes.objetosBorrados} · ` +
        `imagenes_anuladas=${imagenes.filasActualizadas} · ` +
        `filas_borradas=${metadatos.filasBorradas} · retenidas=${retenidasTotal}.`,
    );

    return {
      resultado: 'completado',
      objetosBorrados: imagenes.objetosBorrados,
      filasConImagenAnulada: imagenes.filasActualizadas,
      filasBorradas: metadatos.filasBorradas,
      retenidas: retenidasTotal,
    };
  },
);
