/**
 * Job · operacion/procesarCancelacionMl
 * =============================================================================
 * Trigger: evento `operacion/pedido.cancelado-en-ml`
 * (publicado por `integraciones` — adaptador ML/Flex — al detectar que un
 * comprador o un vendedor canceló un envío directamente en Mercado Libre, sin
 * pasar por Rutax)
 *
 * Contrato del evento (definido por la tarea; `integraciones` es quien lo
 * publica; se declara localmente en `DatosPedidoCanceladoEnMl` porque el
 * evento todavía no vive en `src/lib/inngest/eventos.ts` — fuera de mi
 * territorio en esta tarea, mismo patrón que usa `dinero/jobs/generar-lineas.ts`
 * con `event.data as {...}`):
 *   { pedidoId, tenantId, sellerId, mlShipmentId, estadoAnterior, substatusMl }
 *
 * PRINCIPIO QUE GOBIERNA ESTE JOB (CLAUDE.md — decisión del usuario, ago-2026):
 * una cancelación en ML es un HECHO CONSUMADO, no una solicitud. No se puede
 * "rechazar" porque el dinero esté cerrado: ya ocurrió. El estado se refleja
 * SIEMPRE, venga el pedido del estado que venga. Lo único que varía es qué
 * hacemos con las consecuencias:
 *
 *   1. Estado: pasa a 'cancelado' por el mismo y único camino de escritura de
 *      estado que usa toda transición de pedido — `actualizarEstadoPedido`
 *      (pedidos.ts). Aquí NO se duplica la máquina de estados, la resolución
 *      de incidencias previas (7c) ni el evento financiero: ya viven ahí.
 *   2. Si el pedido estaba 'asignado' o 'en_ruta' (el conductor lleva el bulto
 *      físico en la van): además de cancelar, se levanta una incidencia nueva
 *      — alguien tiene que devolver ese paquete y el coordinador debe
 *      enterarse. Para cualquier otro estado vivo (pendiente_asignacion,
 *      fallido, fallido_manual) no se abre incidencia por este motivo.
 *   3. Dinero: NO se decide en este job. `actualizarEstadoPedido` publica
 *      `dinero/pedido.estado_financiero_relevante` con `estadoNuevo:'cancelado'`
 *      exactamente igual que para la cancelación manual — y el job C1
 *      (`dinero/jobs/generar-lineas.ts`, paso 'anular-lineas-si-devolucion')
 *      YA implementa "anula si el período/liquidación está abierto/borrador; si
 *      no, levanta una excepción BLOQUEANTE en `dinero.eventos_conciliacion`"
 *      (`linea_cobro_sin_pedido_entregado` con `bloquea_facturacion=true` /
 *      `linea_liquidacion_sin_pedido_entregado` con `bloquea_pago=true` —
 *      ambos tipos y su migración YA existen, ver `20260811000002_dinero_
 *      conciliacion_linea_liquidacion_sin_pedido.sql`). Ese job es agnóstico de
 *      POR QUÉ el pedido llegó a 'cancelado': el evento no lleva "quién" ni
 *      "por qué", solo el estado. Repetir esa lógica aquí duplicaría una
 *      fuente de verdad ya construida y probada (`generar-lineas-handler.test.ts`).
 *      Este job SOLO dispara la transición; C1 decide la rama de dinero, como
 *      ya lo hace para toda cancelación, humana o no.
 *   4. NO se guarda quién canceló ni el motivo (decisión del usuario): no se
 *      pasan `actuadoPorUsuarioId` ni `motivo` a `actualizarEstadoPedido`, así
 *      que `cancelado_por_usuario_id`/`motivo_cancelacion` quedan NULL. No se
 *      consulta a ML por el motivo. La bitácora (accion
 *      'pedido.cancelado_por_ml', distinta de 'pedido.cancelado') es lo que
 *      documenta que este pedido lo canceló ML y no un humano.
 *
 * Estados terminales previos a la cancelación (entregado/entregado_manual/
 * devuelto): el invariante de la máquina de estados ("los terminales no
 * admiten transiciones de salida", ver `maquina-estados.ts`) NO se rompe aquí.
 * Es un caso que la decisión del usuario no contempló explícitamente (los 5
 * estados vivos sí) y que en la práctica no debería ocurrir (ML no deja
 * cancelar un envío ya entregado). Se trata como ANOMALÍA: se deja constancia
 * en bitácora para revisión humana y NO se reintenta — mismo patrón que ya
 * usa `procesar-shipment.ts` (integraciones) al capturar `ErrorTransicionInvalida`
 * y terminar sin relanzar. Ver el informe de la tarea: es una decisión que el
 * usuario debería revisar si alguna vez se observa en producción.
 *
 * IDEMPOTENCIA (el evento puede llegar dos veces — reintento de Inngest,
 * detección duplicada del lado de integraciones):
 *   - Si el pedido YA está 'cancelado' al leerlo (paso 1), es no-op total: sin
 *     segunda entrada de bitácora, sin reabrir nada, sin una segunda incidencia.
 *   - Si dos invocaciones concurrentes leen el mismo estado y compiten por el
 *     UPDATE, `actualizarEstadoPedido` resuelve la carrera con optimistic
 *     locking (`ErrorConflicto`, WHERE estado=estadoEsperado) — se captura como
 *     "ya lo manejó la otra invocación", no como fallo, y no se abre incidencia
 *     desde la invocación perdedora (evita una carrera de doble apertura,
 *     aunque `abrirIncidencia` también es idempotente por sí sola).
 *   - `abrirIncidencia` (`incidencias.ts`) es idempotente por diseño: si ya hay
 *     una incidencia abierta para el pedido, devuelve la existente sin duplicar.
 *
 * MULTI-TENANT: toda lectura/escritura lleva `tenant_id` en el WHERE — nunca se
 * confía en que `pedidoId` sea suficiente.
 *
 * TERRITORIO: consumidor puro de `operacion`. Nunca llama a `integraciones` ni
 * a Mercado Libre — el evento ya trae todo lo necesario y la regla del
 * proyecto es no consultar ML desde aquí. Solo usa `service_role` + los
 * caminos ya existentes de `operacion` (`actualizarEstadoPedido`,
 * `desactivarAsignacionActivaPedido`, `abrirIncidencia`) — el mismo "único
 * camino" que usa la cancelación manual, para que exista un solo lugar que
 * lleve un pedido a 'cancelado' con todas sus consecuencias.
 */

import { inngest } from '@/lib/inngest/cliente';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { ErrorConflicto } from '@/modules/identidad/errores';
import { actualizarEstadoPedido, desactivarAsignacionActivaPedido } from '../pedidos';
import { abrirIncidencia } from '../incidencias';
import { ESTADOS_TERMINALES } from '../tipos';
import type { EstadoPedido } from '../tipos';

/**
 * Forma de `event.data` de `operacion/pedido.cancelado-en-ml` — contrato fijo
 * de la tarea, publicado por `integraciones`. Ver cabecera del archivo.
 */
interface DatosPedidoCanceladoEnMl {
  pedidoId: string;
  tenantId: string;
  sellerId: string;
  mlShipmentId: string;
  /**
   * Estado del pedido en Rutax que `integraciones` observó AL DETECTAR la
   * cancelación — un snapshot, no una verdad vigente: entre la detección y el
   * procesamiento de este job el estado real pudo cambiar. Se usa SOLO para
   * trazabilidad en bitácora; el control de flujo siempre relee el estado
   * actual desde BD (paso 1) y nunca decide sobre este valor.
   */
  estadoAnterior: string;
  /**
   * Subestado de Mercado Libre que disparó la detección (p. ej.
   * 'buyer_cancelled') — solo trazabilidad en bitácora, nunca lógica de
   * negocio: este job no consulta a ML.
   */
  substatusMl: string | null;
}

/** Estados desde los que la cancelación reportada por ML deja al conductor con un bulto por devolver. */
const ESTADOS_QUE_REQUIEREN_INCIDENCIA_DE_RETIRO: ReadonlySet<EstadoPedido> = new Set([
  'asignado',
  'en_ruta',
]);

export const jobProcesarCancelacionMl = inngest.createFunction(
  {
    id: 'operacion/procesarCancelacionMl',
    name: 'Operación · Reflejar cancelación detectada en Mercado Libre',
    triggers: [{ event: 'operacion/pedido.cancelado-en-ml' }],
    retries: 4,
  },
  async ({ event, step, logger, runId }) => {
    const { pedidoId, tenantId, sellerId, mlShipmentId, estadoAnterior, substatusMl } =
      event.data as DatosPedidoCanceladoEnMl;

    // Paso 1: leer el estado REAL del pedido — nunca confiar en `estadoAnterior`
    // del evento (puede estar obsoleto; ver el comentario del tipo arriba).
    const contexto = await step.run('leer-pedido', async () => {
      const supabase = crearClienteServiceRole();
      const { data: pedido, error } = await supabase
        .from('pedidos')
        .select('id, estado, tipo_pedido, seller_id, driver_id_asignado, ml_shipment_id')
        .eq('id', pedidoId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw new Error(`Error al leer el pedido: ${error.message}`);

      if (!pedido) {
        return { encontrado: false as const };
      }

      return {
        encontrado: true as const,
        estadoActual: pedido.estado as EstadoPedido,
        tipoPedido: (pedido.tipo_pedido as string | null) ?? null,
        sellerIdReal: pedido.seller_id as string,
        mlShipmentIdReal: (pedido.ml_shipment_id as string | null) ?? null,
      };
    });

    // Defensivo: `integraciones` resuelve pedidoId antes de publicar el evento,
    // así que esto no debería ocurrir. Si el pedido no existe en este tenant no
    // hay nada que reflejar — se registra y se termina SIN reintento (no es un
    // fallo transitorio: reintentar no hace aparecer un pedido inexistente).
    if (!contexto.encontrado) {
      logger.warn(
        `operacion/pedido.cancelado-en-ml: pedido ${pedidoId} no existe en el tenant ${tenantId} — nada que reflejar.`,
      );
      return { pedidoId, tenantId, resultado: 'pedido_no_encontrado' as const };
    }

    if (contexto.mlShipmentIdReal && contexto.mlShipmentIdReal !== mlShipmentId) {
      // No bloquea (decisión #1: el estado se refleja siempre) — solo deja
      // rastro de que la detección y el pedido resuelto no coinciden, para que
      // se revise el lado de integraciones.
      logger.warn(
        `operacion/pedido.cancelado-en-ml: el pedido ${pedidoId} tiene ml_shipment_id=` +
          `'${contexto.mlShipmentIdReal}', distinto del '${mlShipmentId}' del evento. Se continúa ` +
          `igual (pedidoId manda), pero conviene revisar la detección en integraciones.`,
      );
    }

    // Idempotencia — el caso más común de "evento repetido": ya está
    // cancelado, no-op total, sin nueva bitácora ni incidencia.
    if (contexto.estadoActual === 'cancelado') {
      logger.info(`operacion/pedido.cancelado-en-ml: pedido ${pedidoId} ya estaba cancelado — no-op.`);
      return { pedidoId, tenantId, resultado: 'ya_cancelado' as const };
    }

    // Estado terminal DISTINTO de 'cancelado' (entregado/entregado_manual/
    // devuelto): la máquina de estados no admite salidas desde un terminal —
    // invariante que este job no rompe. Se registra la anomalía para revisión
    // humana y se termina sin reintento (ver cabecera del archivo).
    if (ESTADOS_TERMINALES.includes(contexto.estadoActual)) {
      await step.run('registrar-anomalia-terminal', async () => {
        const supabase = crearClienteServiceRole();
        await registrarEnBitacora(supabase, {
          tenantId,
          actorUsuarioId: null,
          actorTipo: 'sistema',
          accion: 'pedido.cancelacion_ml_no_reflejada',
          entidadTipo: 'pedido',
          entidadId: pedidoId,
          detalle: {
            ml_shipment_id: mlShipmentId,
            estado_actual_rutax: contexto.estadoActual,
            estado_anterior_reportado: estadoAnterior,
            substatus_ml: substatusMl,
            motivo:
              `Mercado Libre reportó la cancelación del envío, pero el pedido ya está ` +
              `'${contexto.estadoActual}' en Rutax (estado terminal) — no se puede reflejar sin ` +
              `romper la máquina de estados. Requiere revisión manual.`,
            job_run_id: runId,
          },
        });
      });

      logger.warn(
        `operacion/pedido.cancelado-en-ml: pedido ${pedidoId} ya está en estado terminal ` +
          `'${contexto.estadoActual}' — la cancelación de ML NO se refleja (requiere revisión manual).`,
      );
      return {
        pedidoId,
        tenantId,
        resultado: 'terminal_previo_no_reflejado' as const,
        estadoActual: contexto.estadoActual,
      };
    }

    // A partir de aquí, estadoActual ∈ {pendiente_asignacion, asignado,
    // en_ruta, fallido, fallido_manual} — todos vivos.
    const estadoAntesDeLaCancelacion = contexto.estadoActual;
    const requiereIncidenciaDeRetiro = ESTADOS_QUE_REQUIEREN_INCIDENCIA_DE_RETIRO.has(
      estadoAntesDeLaCancelacion,
    );

    // Paso 2: reflejar la cancelación — bitácora ANTES del efecto (CLAUDE.md:
    // "bitácora antes que efectos externos"), luego el ÚNICO camino de
    // escritura de estado (`actualizarEstadoPedido`: máquina de estados,
    // sla_cumplido=null, resolución de incidencia previa si la había (7c), y el
    // evento financiero post-commit), y por último desactivar la asignación
    // activa (mismo orden y misma razón que `cancelarPedido`: el evento
    // financiero necesita `driver_id_asignado` ANTES de que la desasignación lo
    // ponga en null).
    const resultadoCancelacion = await step.run('reflejar-cancelacion', async () => {
      const supabase = crearClienteServiceRole();

      await registrarEnBitacora(supabase, {
        tenantId,
        actorUsuarioId: null,
        actorTipo: 'sistema',
        accion: 'pedido.cancelado_por_ml',
        entidadTipo: 'pedido',
        entidadId: pedidoId,
        detalle: {
          ml_shipment_id: mlShipmentId,
          tipo_pedido: contexto.tipoPedido,
          estado_anterior_rutax: estadoAntesDeLaCancelacion,
          estado_anterior_reportado: estadoAnterior,
          substatus_ml: substatusMl,
          job_run_id: runId,
        },
      });

      try {
        await actualizarEstadoPedido(supabase, {
          pedidoId,
          tenantId,
          estadoNuevo: 'cancelado',
          estadoEsperado: estadoAntesDeLaCancelacion,
          ejecutor: 'sistema',
          // Sin actuadoPorUsuarioId ni motivo, A PROPÓSITO (decisión #4): nadie
          // humano canceló y no se consulta a ML el motivo — las columnas
          // cancelado_por_usuario_id/motivo_cancelacion quedan NULL. La bitácora
          // de arriba es lo único que documenta el origen ML de esta cancelación.
        });
      } catch (err) {
        if (err instanceof ErrorConflicto) {
          // Otra invocación concurrente (reintento de Inngest, evento
          // duplicado) ya movió el pedido — no es un fallo real, es la carrera
          // resolviéndose. La invocación ganadora (o su propio paso 3) es la
          // que decide la incidencia; esta se retira sin más efectos.
          logger.info(
            `operacion/pedido.cancelado-en-ml: conflicto de optimistic locking en pedido ${pedidoId} ` +
              `— otra invocación ya lo canceló. Tratado como no-op.`,
          );
          return { transicionAplicada: false as const };
        }
        throw err;
      }

      // Mismo efecto colateral bloqueante que `cancelarPedido` (§5 fila 1 del
      // doc de arquitectura de edición/cancelación): si no se desactiva, la
      // parada cancelada sigue viva en la app del conductor.
      await desactivarAsignacionActivaPedido(supabase, pedidoId, tenantId);

      return { transicionAplicada: true as const };
    });

    // Paso 3 (condicional): el conductor llevaba el bulto físico — levantar
    // una incidencia para que el coordinador coordine la devolución (decisión
    // #2). Solo si la transición ocurrió en ESTA invocación: si otra invocación
    // ganó la carrera del paso 2, se confía en que ella decide esto.
    if (resultadoCancelacion.transicionAplicada && requiereIncidenciaDeRetiro) {
      await step.run('abrir-incidencia-retiro-pendiente', async () => {
        const supabase = crearClienteServiceRole();
        await abrirIncidencia(supabase, {
          tenantId,
          pedidoId,
          sellerId: contexto.sellerIdReal || sellerId,
          // Sin tipo propio en el catálogo (operacion/tipos.ts TIPOS_INCIDENCIA)
          // para "cancelado en ML con el conductor en camino" — se usa 'otro'
          // con descripción explícita, mismo patrón que ya usa `pedidos.ts`
          // (paso 7a) para incidencias abiertas automáticamente por el sistema:
          // "tipo genérico — el supervisor la refina". Ver informe de la tarea.
          tipo: 'otro',
          descripcion:
            `Pedido cancelado en Mercado Libre mientras el conductor lo llevaba ` +
            `(estaba '${estadoAntesDeLaCancelacion}'). Hay que coordinar la devolución del bulto.`,
          esAccionManual: false,
        });
      });
    }

    logger.info(
      `operacion/pedido.cancelado-en-ml: pedido ${pedidoId} procesado. ` +
        `estadoAnterior=${estadoAntesDeLaCancelacion}, transicionAplicada=${resultadoCancelacion.transicionAplicada}, ` +
        `incidenciaAbierta=${resultadoCancelacion.transicionAplicada && requiereIncidenciaDeRetiro}.`,
    );

    return {
      pedidoId,
      tenantId,
      resultado: resultadoCancelacion.transicionAplicada
        ? ('cancelado' as const)
        : ('conflicto_concurrente' as const),
      estadoAnterior: estadoAntesDeLaCancelacion,
      incidenciaAbierta: resultadoCancelacion.transicionAplicada && requiereIncidenciaDeRetiro,
    };
  },
);
