/**
 * Detección de cancelaciones en Mercado Libre — detectar y AVISAR, nunca aplicar.
 * =============================================================================
 * Por qué existe este archivo (y no una rama `if` repetida en dos jobs): la
 * cancelación se puede descubrir por dos caminos —el webhook (`procesar-shipment`)
 * y el barrido del cron (`ingesta-pedidos-ml`, fase B)— y el criterio de "esto es
 * una cancelación" tiene que ser UNO. Duplicarlo es cómo se arregla un bug en un
 * sitio y no en el otro.
 *
 * LÍMITE DE RESPONSABILIDAD (decisión del proyecto): `integraciones` **detecta y
 * publica**. NO mueve el estado del pedido a `cancelado`, NO abre incidencia y
 * NO toca líneas de dinero. Todo eso lo hace el consumidor de
 * `operacion/pedido.cancelado-en-ml`, que vive fuera de este módulo.
 *
 * POR QUÉ EL CRON ES IMPRESCINDIBLE PARA ESTO (verificado contra la doc oficial,
 * ver `docs/mercadolibre/04-ordenes-ventas.md`): `GET /orders/search?seller=` NO
 * devuelve órdenes canceladas — desaparecen del resultado en vez de aparecer
 * marcadas. O sea que la búsqueda de órdenes, por diseño, jamás puede detectar
 * una cancelación: hay que preguntarle al ENVÍO (`GET /shipments/{id}`), que sí
 * reporta `status: "cancelled"`.
 *
 * QUÉ **NO** SE GUARDA (decisión del usuario, 2026-08-13): ni quién canceló ni
 * el motivo. Solo el estado. Por eso NO se consulta `GET /orders/{id}` para el
 * `cancel_detail` — sería una llamada extra por pedido cancelado a cambio de un
 * dato que nadie va a leer.
 */

import { inngest } from "@/lib/inngest/cliente";
import { traducirEstadoMl } from "./traduccion-estados";
import type { EstadoPedidoInterno } from "./tipos-operacion";

/**
 * ¿El envío que reporta ML corresponde a una cancelación?
 *
 * Se apoya en `traducirEstadoMl` (la tabla oficial status/substatus → estado
 * interno) en vez de comparar contra la cadena `"cancelled"` a mano: si mañana
 * ML agrega un subestado que también significa cancelación, se agrega en UN
 * sitio y los dos caminos lo heredan.
 */
export function esCancelacionMl(
  estadoMl: string | null | undefined,
  subestadoMl?: string | null,
): boolean {
  if (!estadoMl) return false;
  return traducirEstadoMl(estadoMl, subestadoMl ?? null) === "cancelado";
}

export interface DatosCancelacionMl {
  pedidoId: string;
  tenantId: string;
  sellerId: string;
  mlShipmentId: string;
  /** Estado interno que tenía el pedido cuando se detectó la cancelación. */
  estadoAnterior: EstadoPedidoInterno | string;
  /** `substatus` crudo del envío, tal como lo reportó ML (puede faltar). */
  substatusMl: string | null;
}

/**
 * Publica `operacion/pedido.cancelado-en-ml`.
 *
 * Idempotencia: el `id` del evento es determinístico por pedido
 * (`pedido-cancelado-ml-${pedidoId}`), así que un webhook repetido, un reintento
 * de Inngest y el barrido del cron descubriendo lo mismo terminan en UNA sola
 * ejecución del consumidor. Es deliberado que la llave NO incluya el instante:
 * un pedido se cancela una vez.
 *
 * Nunca lanza: la publicación es best-effort desde el punto de vista del
 * llamador, que ya dejó el pedido sin tocar. Si el envío del evento falla, el
 * barrido del cron vuelve a encontrar el envío `cancelled` en la próxima corrida
 * (el pedido sigue en un estado no terminal) y lo reintenta. Devuelve `true` si
 * el evento salió.
 */
export async function publicarCancelacionEnMl(
  datos: DatosCancelacionMl,
  logger?: { warn: (m: string) => void },
): Promise<boolean> {
  try {
    await inngest.send({
      name: "operacion/pedido.cancelado-en-ml",
      id: `pedido-cancelado-ml-${datos.pedidoId}`,
      data: {
        pedidoId: datos.pedidoId,
        tenantId: datos.tenantId,
        sellerId: datos.sellerId,
        mlShipmentId: datos.mlShipmentId,
        estadoAnterior: datos.estadoAnterior,
        substatusMl: datos.substatusMl,
      },
    });
    return true;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    logger?.warn(
      `No se pudo publicar la cancelación del pedido ${datos.pedidoId}: ${mensaje}. ` +
        "El barrido de estados lo reintentará en la próxima corrida.",
    );
    return false;
  }
}
