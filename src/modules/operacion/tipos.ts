/**
 * Tipos del módulo `operacion` — interfaces TypeScript y enums que espejan
 * exactamente los tipos de Postgres definidos en la migración 0005.
 *
 * Regla de límite: este archivo NO importa nada de `dinero`. Las columnas
 * financieras (monto_cobro_clp, etc.) existen en la BD pero solo Fase C las
 * escribe. Aquí solo se modelan para lectura (campos opcionales de solo lectura).
 */

// =============================================================================
// Enums — espejo de los tipos operacion.* en Postgres (migración 0005)
// =============================================================================

export const ESTADOS_PEDIDO = [
  "pendiente_asignacion",
  "asignado",
  "en_ruta",
  "entregado",
  "entregado_manual",
  "fallido",
  "fallido_manual",
  "cancelado",
  "devuelto",
] as const;

export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

/** Estados terminales: ninguna transición válida desde ellos. */
export const ESTADOS_TERMINALES: readonly EstadoPedido[] = [
  "entregado",
  "entregado_manual",
  "cancelado",
  "devuelto",
];

export const TIPOS_PEDIDO = ["flex", "same_day"] as const;
export type TipoPedido = (typeof TIPOS_PEDIDO)[number];

export const ORIGENES_PEDIDO = ["ml_ingesta", "same_day_manual", "backfill"] as const;
export type OrigenPedido = (typeof ORIGENES_PEDIDO)[number];

export const TIPOS_INCIDENCIA = [
  "destinatario_ausente",
  "direccion_erronea",
  "paquete_danado",
  "rechazo_destinatario",
  "problema_acceso",
  "reagendado",
  "otro",
] as const;
export type TipoIncidencia = (typeof TIPOS_INCIDENCIA)[number];

export const ESTADOS_INCIDENCIA = ["abierta", "en_gestion", "resuelta", "cerrada"] as const;
export type EstadoIncidencia = (typeof ESTADOS_INCIDENCIA)[number];

export const ESTADOS_MANIFIESTO = [
  "borrador",
  "confirmado",
  "en_ruta",
  "completado",
  "cancelado",
] as const;
export type EstadoManifiesto = (typeof ESTADOS_MANIFIESTO)[number];

// =============================================================================
// Entidades de dominio
// =============================================================================

export interface Pedido {
  id: string;
  tenantId: string;
  sellerId: string;
  tipoPedido: TipoPedido;
  origen: OrigenPedido;
  mlOrderId: string | null;
  mlShipmentId: string | null;
  estado: EstadoPedido;
  estadoMl: string | null;
  subestadoMl: string | null;
  ultimaSyncMlEn: string | null;
  driverIdAsignado: string | null;
  destinatarioNombre: string;
  destinatarioDireccion: string;
  destinatarioComuna: string;
  destinatarioTelefono: string | null;
  instruccionesEntrega: string | null;
  fechaCompromiso: string | null;
  tarifaAplicableId: string | null;
  // Columnas de Fase C — presentes en BD, solo lectura en Fase B
  readonly montoCobroClp?: number | null;
  readonly montoLiquidacionClp?: number | null;
  readonly cobroGenerado?: boolean;
  readonly liquidacionGenerada?: boolean;
  notasInternas: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

export interface Manifiesto {
  id: string;
  tenantId: string;
  driverId: string;
  nombre: string;
  fechaOperacion: string;
  estado: EstadoManifiesto;
  notas: string | null;
  creadoPorUsuarioId: string | null;
  confirmadoEn: string | null;
  completadoEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

export interface AsignacionPedido {
  id: string;
  tenantId: string;
  pedidoId: string;
  manifiestoId: string;
  driverId: string;
  sellerId: string;
  activa: boolean;
  asignadoPorUsuarioId: string | null;
  asignadoEn: string;
  desasignadoEn: string | null;
}

export interface Incidencia {
  id: string;
  tenantId: string;
  pedidoId: string;
  sellerId: string;
  tipo: TipoIncidencia;
  estado: EstadoIncidencia;
  descripcion: string | null;
  notasResolucion: string | null;
  afectaCobro: boolean;
  afectaLiquidacion: boolean;
  abiertaPorUsuarioId: string | null;
  resueltaPorUsuarioId: string | null;
  abiertaEn: string;
  resueltaEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

// =============================================================================
// Entradas de las operaciones de módulo
// =============================================================================

export interface FiltrosPedidos {
  tenantId: string;
  sellerId?: string;
  conductorId?: string;
  estado?: EstadoPedido;
  fecha?: string; // fecha_compromiso (ISO date)
  pagina?: number;
  limite?: number;
}

export interface PaginadoPedidos {
  datos: Pedido[];
  total: number;
  pagina: number;
  limite: number;
}

/** Quién ejecuta la transición: 'sistema' = job/webhook; 'interno' = usuario humano */
export type EjecutorTransicion = "sistema" | "interno";

export interface ActualizarEstadoEntrada {
  pedidoId: string;
  tenantId: string;
  estadoNuevo: EstadoPedido;
  /**
   * Optimistic locking: si el estado actual en BD difiere de este valor,
   * se lanza ErrorConflicto (condición de carrera resuelta — el job termina sin reintento).
   */
  estadoEsperado: EstadoPedido;
  ejecutor: EjecutorTransicion;
  /** Requerido para ejecutor='interno': quién realiza el cambio. */
  actuadoPorUsuarioId?: string;
  /** Requerido para correcciones manuales (ejecutor='interno'). */
  motivo?: string;
}

export interface CrearPedidoSameDayEntrada {
  tenantId: string;
  sellerId: string;
  destinatarioNombre: string;
  destinatarioDireccion: string;
  destinatarioComuna: string;
  destinatarioTelefono?: string;
  instruccionesEntrega?: string;
  fechaCompromiso?: string;
  notasInternas?: string;
}

export interface CrearManifiestoEntrada {
  tenantId: string;
  driverId: string;
  nombre: string;
  fechaOperacion: string;
  notas?: string;
  creadoPorUsuarioId?: string;
}

export interface AbrirIncidenciaEntrada {
  tenantId: string;
  pedidoId: string;
  sellerId: string;
  tipo: TipoIncidencia;
  descripcion?: string;
  abiertaPorUsuarioId?: string;
  /** Si true, la apertura fue iniciada por un usuario interno (requiere RBAC). */
  esAccionManual?: boolean;
}

export interface ActualizarIncidenciaEntrada {
  incidenciaId: string;
  tenantId: string;
  estado?: EstadoIncidencia;
  notasResolucion?: string;
  resueltaPorUsuarioId?: string;
}

export interface MetricasOperativas {
  totalPedidos: number;
  porEstado: Partial<Record<EstadoPedido, number>>;
  tasaEntrega: number; // 0.0 – 1.0
  incidenciasAbiertas: number;
  conexionesCaidas: number;
  /** Conductores del tenant con estado='activo' (no depende de la fecha). */
  conductoresActivos: number;
  /**
   * Conductores distintos con un manifiesto en estado 'confirmado' o
   * 'en_ruta' para `fecha_operacion` = la fecha de las métricas.
   */
  conductoresListosHoy: number;
  /**
   * Top 5 comunas con más pedidos del día (mismo criterio que `pedidosDia`),
   * ordenado descendente por cantidad. El resto de comunas se agrupa en una
   * entrada con comuna = "Otras" (si existe remanente).
   */
  paquetesPorComuna: Array<{ comuna: string; cantidad: number }>;
  /**
   * Pedidos cuya fecha_compromiso fue el día anterior a la fecha de las
   * métricas y que aún no llegaron a un estado terminal (entregado,
   * entregado_manual, fallido, fallido_manual, cancelado, devuelto).
   */
  rezagadosAyer: number;
}
