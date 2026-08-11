/**
 * Acciones de bitácora que representan un cambio de estado ejecutado por una
 * PERSONA (interno, seller o conductor) — cualquier fila de
 * `bitacora_auditoria` con una de estas acciones gana atribución humana en el
 * "Historial de estados" del detalle del pedido. La ausencia de una fila con
 * alguna de estas acciones para el pedido significa que el cambio vino de la
 * sincronización con Mercado Libre (ejecutor='sistema'), que hoy NO escribe
 * bitácora — por eso ese caso cae al texto genérico "Sincronización automática".
 *
 * BUG real (2026-08-11, verificado en producción — pedido
 * feb7040c-21e4-4380-82ac-f6f3230ecb01): a esta lista le faltaba
 * 'pedido.cancelado'. La cancelación manual usa una acción de bitácora
 * DISTINTA a la corrección genérica de estado — ver `src/modules/operacion/
 * pedidos.ts`, comentario "'pedido.cancelado' en vez de
 * 'pedido.estado_corregido_manual' — nunca las dos" —, así que un pedido
 * cancelado a mano por un usuario quedaba sin ninguna fila en el historial y
 * la pantalla mostraba "Sincronización automática", contradiciendo la sección
 * "Cancelación" (que sí muestra el nombre de quien lo canceló) dos centímetros
 * más arriba.
 */
export const ACCIONES_HISTORIAL_ESTADO_PEDIDO = [
  "pedido.estado_corregido_manual",
  "pedido.cancelado",
] as const;
