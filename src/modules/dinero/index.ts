/**
 * Superficie pública del módulo `dinero`.
 *
 * Solo se exporta lo que los consumidores externos (frontend, otros módulos)
 * necesitan ver. Los jobs Inngest (C1-C7) son consumidores internos y no forman
 * parte de la superficie pública.
 *
 * Regla de límite (§7.2 del doc. de arquitectura):
 * - `dinero` no importa funciones de `operacion` — solo tipos puros.
 * - `dinero` no llama al proveedor DTE directamente — solo a través de
 *   `integraciones/dte/puerto.ts`.
 * - `dinero` registra en bitácora a través de `identidad/auditoria.ts`.
 */

// Tipos
export type {
  LineaCobro,
  LineaLiquidacion,
  PeriodoCobro,
  DocumentoDte,
  Liquidacion,
  EventoConciliacion,
  EventoConciliacionHistorial,
  ConfigPeriodo,
  EstadoPeriodo,
  TipoPeriodoFacturacion,
  EstadoSii,
  EstadoLiquidacion,
  OrigenGeneracion,
  TipoDiferenciaConciliacion,
  EstadoEventoConciliacion,
  CategoriaNegocioConciliacion,
  AccionSugeridaConciliacion,
  TipoCambioConciliacion,
  ActorTipoHistorial,
  PagoRecibido,
  EstadoMatchPago,
  EstadoCobroPeriodo,
  PayoutConductor,
  EstadoPayout,
  MetodoPayout,
} from './tipos';

// Clasificación y máquina de estados de la bandeja de excepciones (§1.1 P1) —
// funciones puras, útiles para `frontend`/`qa` sin duplicar la lógica.
export {
  categoriaNegocioPorTipo,
  accionSugeridaPorTipo,
  fechaLimiteDefaultPorCategoria,
  TRANSICIONES_VALIDAS,
  esTransicionValida,
  esEstadoTerminal,
  ESTADOS_NO_TERMINALES_CONCILIACION,
} from './conciliacion-clasificacion';

// Consultas de lectura (para Server Components)
export {
  listarLineasCobroPorPeriodo,
  listarPeriodosCobro,
  obtenerPeriodoCobro,
  listarDocumentosDte,
  listarLiquidaciones,
  obtenerLiquidacion,
  listarEventosConciliacion,
  listarHistorialEventoConciliacion,
  listarPagosRecibidos,
  obtenerTrazaDineroPorPedido,
  obtenerPayoutPorLiquidacion,
} from './consultas';

export type { TrazaDineroPedido, FiltrosEventosConciliacion } from './consultas';

// Server Actions (para formularios y operaciones desde el frontend)
export {
  cerrarPeriodoManualmente,
  marcarLiquidacionPagada,
  transicionarEventoConciliacion,
  reabrirEventoConciliacion,
  asignarEventoConciliacion,
  fijarFechaLimiteConciliacion,
  fijarBloqueosConciliacion,
  cambiarAccionSugeridaConciliacion,
  agregarComentarioConciliacion,
  atribuirPagoManualmente,
  descartarPago,
} from './acciones';
