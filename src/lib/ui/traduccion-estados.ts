/**
 * Traducción centralizada de enums del módulo operacion al español de Chile.
 *
 * Esta es la ÚNICA fuente de verdad para mostrar estados en la UI.
 * Todos los componentes que necesiten mostrar estados importan desde aquí.
 * Sin traducciones duplicadas ni distintas en diferentes partes del código.
 *
 * Fuente: tablas de traducción del documento docs/ux/fase-b-operacion.md (§B-1)
 */

import type { EstadoPedido, TipoIncidencia, EstadoManifiesto, EstadoIncidencia } from "@/modules/operacion/tipos";
import type {
  EstadoPeriodo,
  EstadoSii,
  EstadoLiquidacion,
  EstadoEventoConciliacion,
  TipoDiferenciaConciliacion,
  EstadoMatchPago,
  EstadoCobroPeriodo,
} from "@/modules/dinero/tipos";

// =============================================================================
// EstadoPedido
// =============================================================================

export const TEXTO_ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  pendiente_asignacion: "Pendiente de asignación",
  asignado: "Asignado",
  en_ruta: "En ruta",
  entregado: "Entregado",
  entregado_manual: "Entregado (corrección)",
  fallido: "Fallido",
  fallido_manual: "Fallido (corrección)",
  cancelado: "Cancelado",
  devuelto: "Devuelto",
};

export function traducirEstadoPedido(estado: EstadoPedido): string {
  return TEXTO_ESTADO_PEDIDO[estado] ?? estado;
}

// =============================================================================
// Color del badge por estado de pedido
// =============================================================================

export type ColorBadge =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "warning"
  | "success"
  | "info";

export const COLOR_ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  pendiente_asignacion: "bg-yellow-100 text-yellow-800 border-yellow-200",
  asignado: "bg-blue-100 text-blue-800 border-blue-200",
  en_ruta: "bg-indigo-100 text-indigo-800 border-indigo-200",
  entregado: "bg-green-100 text-green-800 border-green-200",
  entregado_manual: "bg-green-100 text-green-800 border-green-200",
  fallido: "bg-red-100 text-red-800 border-red-200",
  fallido_manual: "bg-red-100 text-red-800 border-red-200",
  cancelado: "bg-gray-100 text-gray-600 border-gray-200",
  devuelto: "bg-orange-100 text-orange-800 border-orange-200",
};

// =============================================================================
// TipoIncidencia
// =============================================================================

export const TEXTO_TIPO_INCIDENCIA: Record<TipoIncidencia, string> = {
  destinatario_ausente: "Destinatario ausente",
  direccion_erronea: "Dirección incorrecta",
  paquete_danado: "Paquete dañado",
  rechazo_destinatario: "Rechazado por destinatario",
  problema_acceso: "Problema de acceso",
  reagendado: "Reagendado",
  otro: "Otro",
};

export function traducirTipoIncidencia(tipo: TipoIncidencia): string {
  return TEXTO_TIPO_INCIDENCIA[tipo] ?? tipo;
}

// =============================================================================
// EstadoIncidencia
// =============================================================================

export const TEXTO_ESTADO_INCIDENCIA: Record<EstadoIncidencia, string> = {
  abierta: "Abierta",
  en_gestion: "En gestión",
  resuelta: "Resuelta",
  cerrada: "Cerrada",
};

export function traducirEstadoIncidencia(estado: EstadoIncidencia): string {
  return TEXTO_ESTADO_INCIDENCIA[estado] ?? estado;
}

export const COLOR_ESTADO_INCIDENCIA: Record<EstadoIncidencia, string> = {
  abierta: "bg-red-100 text-red-800 border-red-200",
  en_gestion: "bg-yellow-100 text-yellow-800 border-yellow-200",
  resuelta: "bg-green-100 text-green-800 border-green-200",
  cerrada: "bg-gray-100 text-gray-600 border-gray-200",
};

// =============================================================================
// EstadoManifiesto
// =============================================================================

export const TEXTO_ESTADO_MANIFIESTO: Record<EstadoManifiesto, string> = {
  borrador: "Borrador",
  confirmado: "Confirmado (listo para el conductor)",
  en_ruta: "En ruta",
  completado: "Completado",
  cancelado: "Cancelado",
};

export function traducirEstadoManifiesto(estado: EstadoManifiesto): string {
  return TEXTO_ESTADO_MANIFIESTO[estado] ?? estado;
}

export const COLOR_ESTADO_MANIFIESTO: Record<EstadoManifiesto, string> = {
  borrador: "bg-yellow-100 text-yellow-800 border-yellow-200",
  confirmado: "bg-blue-100 text-blue-800 border-blue-200",
  en_ruta: "bg-indigo-100 text-indigo-800 border-indigo-200",
  completado: "bg-green-100 text-green-800 border-green-200",
  cancelado: "bg-gray-100 text-gray-600 border-gray-200",
};

// =============================================================================
// Utilidades comunes
// =============================================================================

/** Umbral en horas para considerar una incidencia "sin gestión" (B-6) */
export const UMBRAL_INCIDENCIA_SIN_GESTION_HORAS = 4;

// =============================================================================
// EstadoPeriodoCobro — Fase C (criterio C-7)
// =============================================================================

/**
 * Traduce el estado de un período de cobro al español.
 * Criterio C-7: si estado === 'facturado' y folio es definido, incluye el folio.
 */
export function traducirEstadoPeriodoCobro(estado: EstadoPeriodo, folio?: number): string {
  if (estado === "facturado") {
    return folio !== undefined ? `Facturado — Folio ${folio}` : "Facturado";
  }
  const textos: Record<EstadoPeriodo, string> = {
    abierto: "Abierto",
    cerrado: "Cerrado",
    facturado: "Facturado",
    anulado: "Anulado",
  };
  return textos[estado] ?? estado;
}

export const COLOR_ESTADO_PERIODO: Record<EstadoPeriodo, string> = {
  abierto: "bg-blue-100 text-blue-800 border-blue-200",
  cerrado: "bg-gray-100 text-gray-600 border-gray-200",
  facturado: "bg-green-100 text-green-800 border-green-200",
  anulado: "bg-red-100 text-red-800 border-red-200",
};

// =============================================================================
// EstadoSii — Fase C (criterio C-5)
// =============================================================================

export interface TraduccionEstadoSii {
  texto: string;
  variante: "exito" | "advertencia" | "error" | "neutro";
  /** Nombre del ícono de lucide-react recomendado */
  icono?: string;
}

/**
 * Traduce el estado SII con variante y nombre de ícono.
 * Criterio C-5: aceptado_con_discrepancias → variante 'advertencia' (NUNCA verde ni rojo).
 */
export function traducirEstadoSii(estado: EstadoSii): TraduccionEstadoSii {
  switch (estado) {
    case "pendiente":
      return { texto: "Pendiente SII", variante: "neutro", icono: "Clock" };
    case "aceptado":
      return { texto: "Aceptado por SII", variante: "exito", icono: "CheckCircle" };
    case "rechazado":
      return { texto: "Rechazado por SII", variante: "error", icono: "XCircle" };
    case "aceptado_con_discrepancias":
      return { texto: "Aceptado con observaciones", variante: "advertencia", icono: "AlertTriangle" };
    default:
      return { texto: estado, variante: "neutro" };
  }
}

export function colorBadgeEstadoSii(variante: TraduccionEstadoSii["variante"]): string {
  switch (variante) {
    case "exito":
      return "bg-green-100 text-green-800 border-green-200";
    case "advertencia":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "error":
      return "bg-red-100 text-red-800 border-red-200";
    case "neutro":
    default:
      return "bg-gray-100 text-gray-600 border-gray-200";
  }
}

// =============================================================================
// EstadoLiquidacion — Fase C
// =============================================================================

export const TEXTO_ESTADO_LIQUIDACION: Record<EstadoLiquidacion, string> = {
  borrador: "Borrador",
  emitida: "Emitida",
  pagada: "Pagada",
};

export function traducirEstadoLiquidacion(estado: EstadoLiquidacion): string {
  return TEXTO_ESTADO_LIQUIDACION[estado] ?? estado;
}

export const COLOR_ESTADO_LIQUIDACION: Record<EstadoLiquidacion, string> = {
  borrador: "bg-gray-100 text-gray-600 border-gray-200",
  emitida: "bg-blue-100 text-blue-800 border-blue-200",
  pagada: "bg-green-100 text-green-800 border-green-200",
};

// =============================================================================
// EstadoEventoConciliacion — Fase C
// =============================================================================

export const TEXTO_ESTADO_CONCILIACION: Record<EstadoEventoConciliacion, string> = {
  pendiente: "Pendiente",
  revisado: "Revisado",
  resuelto: "Resuelto",
  ignorado: "Ignorado",
};

export function traducirEstadoConciliacion(estado: EstadoEventoConciliacion): string {
  return TEXTO_ESTADO_CONCILIACION[estado] ?? estado;
}

export const COLOR_ESTADO_CONCILIACION: Record<EstadoEventoConciliacion, string> = {
  pendiente: "bg-orange-100 text-orange-800 border-orange-200",
  revisado: "bg-blue-100 text-blue-800 border-blue-200",
  resuelto: "bg-green-100 text-green-800 border-green-200",
  ignorado: "bg-gray-100 text-gray-600 border-gray-200",
};

// =============================================================================
// TipoDiferenciaConciliacion — Fase C
// =============================================================================

export const TEXTO_TIPO_DIFERENCIA: Record<TipoDiferenciaConciliacion, string> = {
  pedido_entregado_sin_linea_cobro: "Pedido entregado sin línea de cobro",
  pedido_entregado_sin_linea_liquidacion: "Pedido entregado sin línea de liquidación",
  linea_cobro_sin_pedido_entregado: "Línea de cobro sin pedido entregado",
  folio_consumido_sin_dte_persistido: "Folio consumido sin DTE registrado",
  periodo_cerrado_con_lineas_sueltas: "Período cerrado con líneas sin asignar",
  monto_dte_difiere_de_lineas: "Monto del DTE no coincide con líneas",
};

export function traducirTipoDiferencia(tipo: TipoDiferenciaConciliacion): string {
  return TEXTO_TIPO_DIFERENCIA[tipo] ?? tipo;
}

// =============================================================================
// EstadoMatchPago — cobranza Fintoc (capa "pagado")
// =============================================================================

export const TEXTO_ESTADO_MATCH_PAGO: Record<EstadoMatchPago, string> = {
  sin_atribuir: "Sin atribuir",
  atribuido: "Atribuido",
  conciliado: "Conciliado",
  parcial: "Pago parcial",
  sobrante: "Sobrante",
  descartado: "Descartado",
};

export function traducirEstadoMatchPago(estado: EstadoMatchPago): string {
  return TEXTO_ESTADO_MATCH_PAGO[estado] ?? estado;
}

export const COLOR_ESTADO_MATCH_PAGO: Record<EstadoMatchPago, string> = {
  sin_atribuir: "bg-orange-100 text-orange-800 border-orange-200",
  atribuido: "bg-blue-100 text-blue-800 border-blue-200",
  conciliado: "bg-green-100 text-green-800 border-green-200",
  parcial: "bg-yellow-100 text-yellow-800 border-yellow-200",
  sobrante: "bg-purple-100 text-purple-800 border-purple-200",
  descartado: "bg-gray-100 text-gray-600 border-gray-200",
};

// =============================================================================
// EstadoCobroPeriodo — cobranza Fintoc (proyección del período)
// =============================================================================

export const TEXTO_ESTADO_COBRO_PERIODO: Record<EstadoCobroPeriodo, string> = {
  no_aplica: "Sin cobro",
  pendiente: "Por cobrar",
  parcial: "Pago parcial",
  pagado: "Pagado",
};

export function traducirEstadoCobroPeriodo(estado: EstadoCobroPeriodo): string {
  return TEXTO_ESTADO_COBRO_PERIODO[estado] ?? estado;
}

export const COLOR_ESTADO_COBRO_PERIODO: Record<EstadoCobroPeriodo, string> = {
  no_aplica: "bg-gray-100 text-gray-500 border-gray-200",
  pendiente: "bg-amber-100 text-amber-800 border-amber-200",
  parcial: "bg-yellow-100 text-yellow-800 border-yellow-200",
  pagado: "bg-green-100 text-green-800 border-green-200",
};

// =============================================================================
// Utilidades comunes
// =============================================================================

/**
 * Calcula las horas desde una fecha ISO hasta ahora.
 */
export function horasDesde(fechaIso: string): number {
  const ms = Date.now() - new Date(fechaIso).getTime();
  return ms / (1000 * 60 * 60);
}

/**
 * Verdadero si la incidencia abierta supera el umbral sin pasar a en_gestion.
 */
export function esIncidenciaSinGestion(estado: EstadoIncidencia, abiertaEn: string): boolean {
  if (estado !== "abierta") return false;
  return horasDesde(abiertaEn) > UMBRAL_INCIDENCIA_SIN_GESTION_HORAS;
}
