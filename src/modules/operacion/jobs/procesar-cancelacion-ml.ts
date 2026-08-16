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
 * ⚠️ **LA LÓGICA DE NEGOCIO VIVE EN `./cancelacion-fuente-compartida.ts`.** Este
 * archivo quedó como una envoltura delgada que traduce el vocabulario de ML
 * (`mlShipmentId`, `substatusMl`, la acción de bitácora `pedido.cancelado_por_ml`)
 * al contrato genérico del núcleo compartido — el mismo que usa
 * `procesar-cancelacion-fuente.ts` para Shopify y cualquier fuente futura. Se
 * extrajo al agregar el segundo productor de este patrón (Shopify): ver el
 * comentario de cabecera de `cancelacion-fuente-compartida.ts` para el porqué.
 * Esta envoltura preserva EXACTAMENTE el comportamiento observable de antes
 * (mismas acciones de bitácora, mismo `detalle`, mismo objeto de retorno) —
 * `procesar-cancelacion-ml.test.ts` no se tocó y sigue en verde.
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
 *      no, levanta una excepción BLOQUEANTE en `dinero.eventos_conciliacion`".
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
 * devuelto): tratados como ANOMALÍA — bitácora para revisión humana, sin
 * reintento. Ver `cancelacion-fuente-compartida.ts`.
 *
 * IDEMPOTENCIA (el evento puede llegar dos veces — reintento de Inngest,
 * detección duplicada del lado de integraciones): ver
 * `cancelacion-fuente-compartida.ts` (idempotencia del estado + carrera con
 * `ErrorConflicto` + `abrirIncidencia` idempotente por diseño).
 *
 * MULTI-TENANT: toda lectura/escritura lleva `tenant_id` en el WHERE — nunca se
 * confía en que `pedidoId` sea suficiente.
 */

import { inngest } from '@/lib/inngest/cliente';
import {
  procesarCancelacionDetectadaEnFuente,
  type IdentidadCancelacionFuente,
} from './cancelacion-fuente-compartida';

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
   * actual desde BD.
   */
  estadoAnterior: string;
  /**
   * Subestado de Mercado Libre que disparó la detección (p. ej.
   * 'buyer_cancelled') — solo trazabilidad en bitácora, nunca lógica de
   * negocio: este job no consulta a ML.
   */
  substatusMl: string | null;
}

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

    const identidad: IdentidadCancelacionFuente = {
      accionCancelada: 'pedido.cancelado_por_ml',
      accionAnomalia: 'pedido.cancelacion_ml_no_reflejada',
      nombreFuenteLegible: 'Mercado Libre',
      detalleFuente: {
        ml_shipment_id: mlShipmentId,
        substatus_ml: substatusMl,
      },
      columnasExtra: ['ml_shipment_id'],
      advertenciaConsistencia: (filaCruda) => {
        const real = (filaCruda.ml_shipment_id as string | null) ?? null;
        if (real && real !== mlShipmentId) {
          return (
            `el pedido tiene ml_shipment_id='${real}', distinto del '${mlShipmentId}' del evento. ` +
            'Se continúa igual (pedidoId manda), pero conviene revisar la detección en integraciones.'
          );
        }
        return null;
      },
    };

    return procesarCancelacionDetectadaEnFuente(
      { step, logger, runId },
      { pedidoId, tenantId, sellerId, estadoAnterior },
      identidad,
    );
  },
);
