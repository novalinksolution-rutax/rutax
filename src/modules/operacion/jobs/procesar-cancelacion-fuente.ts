/**
 * Job · operacion/procesarCancelacionFuente
 * =============================================================================
 * Trigger: evento `operacion/pedido.cancelado-en-fuente`
 * (publicado por `integraciones` — hoy solo el adaptador de Shopify, ver
 * `integraciones/shopify/ingesta-pedidos.ts` → `publicarCancelacionShopify` —
 * al detectar que una orden se canceló en la tienda sin pasar por Rutax)
 *
 * Es el CONSUMIDOR que faltaba: `lib/inngest/eventos.ts` documenta que
 * `EventoPedidoCanceladoEnFuente` se publica "SIN CONSUMIDOR, A PROPÓSITO" —
 * `integraciones` detecta y avisa, `operacion` aplica. Hasta esta tarea una
 * cancelación en Shopify quedaba solo en el log del job y en
 * `infra.ejecuciones_job`: el pedido seguía vivo en Rutax, se podía asignar y
 * despachar a alguien que ya canceló, y su línea de cobro al seller
 * sobrevivía. Este job cierra ese cabo.
 *
 * TODA LA LÓGICA DE NEGOCIO VIVE EN `./cancelacion-fuente-compartida.ts` —
 * el mismo núcleo que usa `procesar-cancelacion-ml.ts`. Ver el comentario de
 * cabecera de ese archivo para el porqué de la extracción. Este archivo es la
 * envoltura que traduce el vocabulario SOURCE-NEUTRAL del evento (`fuente`,
 * `idExterno`, `referenciaExterna`, `canceladoEnFuenteEn`) a la identidad que
 * el núcleo necesita para que la bitácora nombre la fuente REAL — nunca
 * "Mercado Libre" sobre un pedido que Mercado Libre nunca vio (ver el
 * comentario de `EventoPedidoCanceladoEnFuente` en `lib/inngest/eventos.ts`).
 *
 * POR QUÉ ACCIONES DE BITÁCORA GENÉRICAS (`pedido.cancelado_por_fuente_externa`
 * / `pedido.cancelacion_fuente_no_reflejada`) Y NO UNA POR PROVEEDOR: el evento
 * que dispara este job ya es source-neutral a propósito (para que Falabella o
 * la próxima fuente cuelguen del mismo contrato sin tocar nada) — bautizar la
 * acción de bitácora por proveedor (`..._por_shopify`) obligaría a agregar una
 * acción nueva, y por tanto tocar este archivo, cada vez que entre una fuente.
 * La trazabilidad de CUÁL fuente fue no se pierde: `detalle.fuente` la lleva
 * siempre, literal y sin adivinar — es el dato por el que se filtra en la
 * bitácora, no el nombre de la acción.
 *
 * PRINCIPIO (mismo que rige a `procesar-cancelacion-ml.ts`): una cancelación
 * en la fuente es un HECHO CONSUMADO. El estado se refleja SIEMPRE. Dinero NO
 * se decide aquí — `actualizarEstadoPedido` publica el evento financiero y C1
 * decide la rama (anula si el período sigue abierto, excepción bloqueante si
 * ya está cerrado), exactamente igual que para ML.
 *
 * MULTI-TENANT: toda lectura/escritura lleva `tenant_id` en el WHERE.
 */

import { inngest } from '@/lib/inngest/cliente';
import type { EventoPedidoCanceladoEnFuente } from '@/lib/inngest/eventos';
import {
  procesarCancelacionDetectadaEnFuente,
  type IdentidadCancelacionFuente,
} from './cancelacion-fuente-compartida';

/** Nombre legible de cada fuente conocida, para el texto de bitácora e incidencia. Cae al valor crudo si aparece una fuente no mapeada. */
const NOMBRES_FUENTE_LEGIBLES: Record<string, string> = {
  shopify: 'Shopify',
};

function nombreFuenteLegible(fuente: string): string {
  return NOMBRES_FUENTE_LEGIBLES[fuente] ?? fuente;
}

export const jobProcesarCancelacionFuente = inngest.createFunction(
  {
    id: 'operacion/procesarCancelacionFuente',
    name: 'Operación · Reflejar cancelación detectada en una fuente externa',
    triggers: [{ event: 'operacion/pedido.cancelado-en-fuente' }],
    retries: 4,
  },
  async ({ event, step, logger, runId }) => {
    const { pedidoId, tenantId, sellerId, fuente, idExterno, referenciaExterna, estadoAnterior, canceladoEnFuenteEn } =
      event.data as EventoPedidoCanceladoEnFuente['data'];

    const identidad: IdentidadCancelacionFuente = {
      accionCancelada: 'pedido.cancelado_por_fuente_externa',
      accionAnomalia: 'pedido.cancelacion_fuente_no_reflejada',
      nombreFuenteLegible: nombreFuenteLegible(fuente),
      detalleFuente: {
        fuente,
        id_externo: idExterno,
        referencia_externa: referenciaExterna,
        cancelado_en_fuente_en: canceladoEnFuenteEn,
      },
      columnasExtra: ['id_externo'],
      advertenciaConsistencia: (filaCruda) => {
        const real = (filaCruda.id_externo as string | null) ?? null;
        if (real && real !== idExterno) {
          return (
            `el pedido tiene id_externo='${real}', distinto del '${idExterno}' del evento. Se continúa ` +
            'igual (pedidoId manda), pero conviene revisar la detección en integraciones.'
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
