/**
 * Módulo `operacion` — superficie pública.
 *
 * Contrato definido en §5.1 del documento `docs/arquitectura/fase-b-operacion.md`.
 * Solo se re-exporta lo que otros módulos pueden consumir. Las implementaciones
 * internas (maquina-estados, errores de dominio) también se re-exportan porque
 * los jobs y el frontend los necesitan para distinguir tipos de error.
 *
 * Límite de módulo:
 * - `operacion` NUNCA importa de `dinero`.
 * - Las columnas financieras (monto_cobro_clp, cobro_generado, etc.) existen en
 *   los tipos pero solo Fase C (módulo `dinero`) las escribe.
 */

// --- Tipos e interfaces públicas --------------------------------------------
export type {
  Pedido,
  Manifiesto,
  AsignacionPedido,
  Incidencia,
  EstadoPedido,
  TipoPedido,
  OrigenPedido,
  TipoIncidencia,
  EstadoIncidencia,
  EstadoManifiesto,
  EjecutorTransicion,
  FiltrosPedidos,
  PaginadoPedidos,
  ActualizarEstadoEntrada,
  CrearPedidoSameDayEntrada,
  CrearManifiestoEntrada,
  AbrirIncidenciaEntrada,
  ActualizarIncidenciaEntrada,
  MetricasOperativas,
  // F6, ítem 1.3 — auto-asignación
  Conductor,
  ConductorZona,
  MotivoSinAsignar,
  PedidoSinAsignar,
  AsignacionPorConductor,
  ResultadoAutoAsignacion,
  ResultadoRedistribucion,
  ImpactoSla,
} from "./tipos";

export { ESTADOS_PEDIDO, ESTADOS_TERMINALES, TIPOS_PEDIDO, TIPOS_INCIDENCIA } from "./tipos";

// --- Errores de dominio -----------------------------------------------------
export {
  ErrorOperacion,
  ErrorTransicionInvalida,
  ErrorPedidoNoEncontrado,
  ErrorAsignacionConflicto,
} from "./errores";

// --- Máquina de estados (función pura — útil para validación en UI) ---------
export { validarTransicion, esTransicionValida } from "./maquina-estados";

// --- Pedidos ----------------------------------------------------------------
export {
  obtenerPedido,
  listarPedidos,
  actualizarEstadoPedido,
  crearPedidoSameDay,
  asegurarCodigoInterno,
} from "./pedidos";

// --- Código interno operativo (etiqueta con QR, same-day) --------------------
export {
  generarCodigoInterno,
  esCodigoInternoValido,
  PATRON_CODIGO_INTERNO,
} from "./codigo-interno";

// --- Etiqueta imprimible same-day (PDF + QR) ---------------------------------
export { generarEtiquetaSameDayPdf } from "./etiqueta-same-day-pdf";
export type { FormatoEtiqueta } from "./etiqueta-same-day-pdf";

// --- Manifiestos ------------------------------------------------------------
export {
  crearManifiesto,
  asignarPedidosAManifiesto,
  confirmarManifiesto,
  obtenerManifiestoActivo,
} from "./manifiestos";

// --- Incidencias ------------------------------------------------------------
export {
  abrirIncidencia,
  actualizarIncidencia,
  listarIncidenciasDePedido,
} from "./incidencias";

// --- Métricas (dashboard) ---------------------------------------------------
export { obtenerMetricasDelDia, obtenerImpactoSlaDeReasignacion } from "./metricas";

// --- Auto-asignación heurística (F6, ítem 1.3) ----------------------------
export {
  elegirConductor,
  autoAsignarPendientesDelDia,
  marcarConductorNoDisponibleYRedistribuir,
} from "./auto-asignacion";
export type { PedidoConZona, ConductorCandidato } from "./auto-asignacion";
