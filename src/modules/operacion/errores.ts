/**
 * Errores de dominio del módulo `operacion`.
 *
 * Convención idéntica a `identidad/errores.ts`: errores esperables de negocio
 * tienen su propia clase, distinguibles de errores de infraestructura por los
 * llamadores (Server Actions, jobs) sin parsear mensajes de Postgres.
 */

export class ErrorOperacion extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "ErrorOperacion";
    this.codigo = codigo;
  }
}

/**
 * La transición solicitada no es válida según la máquina de estados del pedido
 * (§3 del documento de arquitectura de Fase B).
 *
 * Ejemplos: intentar mover un pedido de 'entregado' a cualquier estado, o
 * mover de 'pendiente_asignacion' a 'en_ruta' directamente.
 */
export class ErrorTransicionInvalida extends ErrorOperacion {
  readonly estadoActual: string;
  readonly estadoNuevo: string;

  constructor(estadoActual: string, estadoNuevo: string, detalle?: string) {
    const msg =
      detalle ??
      `Transición inválida: '${estadoActual}' → '${estadoNuevo}' no está permitida por la máquina de estados`;
    super("transicion_invalida", msg);
    this.name = "ErrorTransicionInvalida";
    this.estadoActual = estadoActual;
    this.estadoNuevo = estadoNuevo;
  }
}

/**
 * El pedido solicitado no existe en el tenant, o no es visible para el actor.
 */
export class ErrorPedidoNoEncontrado extends ErrorOperacion {
  readonly pedidoId: string;

  constructor(pedidoId: string) {
    super("pedido_no_encontrado", `El pedido '${pedidoId}' no existe o no pertenece al tenant`);
    this.name = "ErrorPedidoNoEncontrado";
    this.pedidoId = pedidoId;
  }
}

/**
 * Conflicto de asignación: el pedido ya tiene una asignación activa en otro
 * manifiesto (cross-tenant, o lógica de negocio violada).
 *
 * También se usa para optimistic locking cuando el estado actual difiere del
 * estadoEsperado — en ese caso el job captura el error y termina sin reintento.
 */
export class ErrorAsignacionConflicto extends ErrorOperacion {
  constructor(mensaje: string) {
    super("asignacion_conflicto", mensaje);
    this.name = "ErrorAsignacionConflicto";
  }
}
