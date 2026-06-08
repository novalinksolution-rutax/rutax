/**
 * Tipos del dominio operacional que el módulo `integraciones/ml` necesita
 * conocer para traducir estados de ML al modelo interno.
 *
 * Espejo restringido del enum `operacion.estado_pedido` (migración 0005).
 * Mantener sincronizado si el enum cambia. El módulo `operacion` (construido
 * por el agente `backend`) exportará su propia versión canónica; este espejo
 * existe para que `integraciones` no dependa del módulo `operacion` en tiempo
 * de compilación durante Fase B.
 *
 * Regla de límite: `integraciones` NO importa de `operacion`. Solo importa
 * tipos mínimos necesarios para la traducción.
 */

export type EstadoPedidoInterno =
  | "pendiente_asignacion"
  | "asignado"
  | "en_ruta"
  | "entregado"
  | "entregado_manual"
  | "fallido"
  | "fallido_manual"
  | "cancelado"
  | "devuelto";

/**
 * Contrato mínimo del módulo `operacion` que los jobs de `integraciones` usan.
 * El módulo `backend`/`operacion` exportará la implementación real. Aquí se
 * define la interfaz para que los jobs puedan ser probados con mocks sin
 * depender del módulo `operacion` real.
 */
export interface ActualizarEstadoEntrada {
  pedidoId: string;
  estadoNuevo: EstadoPedidoInterno;
  /** Optimistic locking: rechaza si el estado actual difiere. */
  estadoEsperado: EstadoPedidoInterno;
  actuadoPor: "sistema_ml";
  motivo?: string;
}

export interface PedidoResumen {
  id: string;
  tenantId: string;
  sellerId: string;
  mlShipmentId: string;
  estado: EstadoPedidoInterno;
  estadoMl: string | null;
}

/**
 * Error lanzado por `actualizarEstadoPedido` cuando el estado actual del
 * pedido difiere del `estadoEsperado` (condición de carrera resuelta por
 * otra ejecución concurrente). El job de procesamiento de shipments lo
 * captura y termina sin reintento — la otra ejecución ya ganó.
 */
export class ErrorConflicto extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorConflicto";
  }
}
