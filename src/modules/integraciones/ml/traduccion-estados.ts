/**
 * Traducción de estados/subestados de Mercado Libre Flex al enum interno
 * `operacion.estado_pedido`.
 *
 * VERIFICACIÓN CONTRA DOCUMENTACIÓN OFICIAL (skill flex-ml lo exige):
 * Fuente: developers.mercadolibre.com — "Manage orders" / "Shipment statuses"
 * (consultada en esta iteración).
 *
 * Estados conocidos de ML Flex (campo `status` del recurso `/shipments/{id}`):
 * - `shipped`       → en tránsito (el paquete salió con el courier)
 * - `delivered`     → entregado exitosamente
 * - `not_delivered` → intento fallido (el courier no pudo entregar)
 * - `cancelled`     → envío cancelado por ML o el seller
 * - `ready_to_ship` → pendiente de pickup/inicio de ruta
 * - `to_be_agreed`  → pendiente de acordar fecha con destinatario — NO hay
 *   transición de estado en nuestro sistema para este subestado; se ignora.
 * - `handling`      → en preparación (pre-despacho) — ignorado.
 *
 * NOTA IMPORTANTE: la lista de estados de ML no está cerrada. ML puede agregar
 * nuevos valores. Por eso `traducirEstadoMl` devuelve `null` para valores
 * desconocidos en lugar de lanzar — el llamador decide si ignorar o alertar.
 * Reverificar esta tabla antes de cada release contra la documentación vigente.
 *
 * Fuente: https://developers.mercadolibre.com.ar/es_ar/gestionar-envios
 */

import type { EstadoPedidoInterno } from "./tipos-operacion";

/**
 * Mapeo de `status` de ML → `estado_pedido` interno.
 * Valores que devuelven `null` → el job los ignora (sin transición de estado).
 */
const MAPA_ESTADO_ML: Record<string, EstadoPedidoInterno | null> = {
  shipped: "en_ruta",
  delivered: "entregado",
  not_delivered: "fallido",
  cancelled: "cancelado",
  pending: null, // Pago/preparación pendiente — fuera del ciclo de entrega
  ready_to_ship: null, // Pre-despacho: no hay equivalente en nuestro flujo Flex
  handling: null, // En preparación: fuera del ciclo de vida de la entrega
  to_be_agreed: null, // Sin transición — ver comentario de archivo
};

/**
 * Subestados de ML que SÍ cambian la traducción respecto del `status` base.
 *
 * Caso clave: la DEVOLUCIÓN al origen. ML NO tiene un `status` top-level
 * "returned"; la devolución se expresa como SUBESTADO de `not_delivered`
 * (`returning_to_sender`, y variantes que ML reporta al cerrar la devolución).
 * Sin este mapeo, una devolución se traduciría como `fallido` y el pedido
 * nunca llegaría a `devuelto` — perdiendo esa transición (hallazgo de auditoría).
 *
 * Fuente: docs/mercadolibre/05-mercado-envios-shipments.md (subestados de
 * `not_delivered`: `receiver_absent`, `returning_to_sender`, etc.). La lista de
 * subestados depende del `logistic_type` y NO es cerrada → defensivo.
 */
const MAPA_SUBESTADO_ML: Record<string, EstadoPedidoInterno> = {
  returning_to_sender: "devuelto",
  returned_to_hub: "devuelto",
  returned: "devuelto",
};

/**
 * Traduce el estado de ML (`status` + `substatus` opcional) al estado interno
 * del pedido.
 *
 * Prioridad: si el `substatus` tiene un mapeo explícito (p. ej. devolución),
 * gana sobre el `status` base. Si no, se traduce por `status`.
 *
 * Devuelve `null` si:
 * - El valor es desconocido (ML lo añadió sin que actualicemos este archivo).
 * - El estado corresponde a una fase sin equivalente en nuestro modelo.
 *
 * El llamador DEBE manejar `null` como "ignorar este evento".
 * NUNCA lanzar: estados desconocidos de ML no son errores de nuestra app.
 */
export function traducirEstadoMl(
  estadoMl: string,
  subestadoMl?: string | null,
): EstadoPedidoInterno | null {
  // El subestado de devolución tiene prioridad sobre el status base.
  if (subestadoMl) {
    const claveSub = subestadoMl.toLowerCase().trim();
    if (claveSub in MAPA_SUBESTADO_ML) {
      return MAPA_SUBESTADO_ML[claveSub];
    }
  }

  // Normalizar a minúsculas para absorber variaciones de capitalización de ML.
  const clave = estadoMl.toLowerCase().trim();

  if (!(clave in MAPA_ESTADO_ML)) {
    // Valor no mapeado — desconocido o nuevo en la API de ML.
    return null;
  }

  return MAPA_ESTADO_ML[clave];
}

/**
 * Devuelve `true` si el estado de ML tiene un equivalente conocido en el sistema.
 * Útil para decidir si vale la pena procesar un evento antes de consultar la BD.
 */
export function estadoMlEsConocido(estadoMl: string): boolean {
  return estadoMl.toLowerCase().trim() in MAPA_ESTADO_ML;
}

/**
 * Lista completa de los estados de ML que SÍ producen una transición en el
 * sistema (para logging/diagnóstico — no para lógica de negocio).
 */
export const ESTADOS_ML_CON_TRANSICION = Object.entries(MAPA_ESTADO_ML)
  .filter(([, v]) => v !== null)
  .map(([k]) => k);
