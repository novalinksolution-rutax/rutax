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

/**
 * Variante semántica de un estado. ÚNICA fuente de color de estado de la app:
 * estos nombres mapean a los tokens de marca (DESIGN_SYSTEM §9), no a la paleta
 * cruda de Tailwind. El color comunica estado; el texto traducido lo desambigua
 * (accesibilidad: el color nunca es el único portador de significado).
 */
export type VarianteEstado = "neutral" | "info" | "exito" | "advertencia" | "error" | "marca";

/**
 * Clases de badge por variante, sobre tokens semánticos (bg subtle + texto).
 * Coincide con las variantes del componente Badge; `border-transparent` neutraliza
 * el `border-border` por defecto que aplican los consumidores con la utilidad `border`.
 */
export const CLASES_BADGE_VARIANTE: Record<VarianteEstado, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  info: "bg-info-subtle text-info-subtle-foreground border-transparent",
  exito: "bg-success-subtle text-success-subtle-foreground border-transparent",
  advertencia: "bg-warning-subtle text-warning-subtle-foreground border-transparent",
  error: "bg-destructive-subtle text-destructive-subtle-foreground border-transparent",
  marca: "bg-primary/10 text-primary border-transparent",
};

/** Construye el mapa estado→clases a partir de un mapa estado→variante. */
function clasesPorEstado<E extends string>(
  variantes: Record<E, VarianteEstado>
): Record<E, string> {
  const salida = {} as Record<E, string>;
  for (const estado of Object.keys(variantes) as E[]) {
    salida[estado] = CLASES_BADGE_VARIANTE[variantes[estado]];
  }
  return salida;
}

export const COLOR_ESTADO_PEDIDO: Record<EstadoPedido, string> = clasesPorEstado<EstadoPedido>({
  pendiente_asignacion: "advertencia",
  asignado: "info",
  en_ruta: "info",
  entregado: "exito",
  entregado_manual: "exito",
  fallido: "error",
  fallido_manual: "error",
  cancelado: "neutral",
  devuelto: "advertencia",
});

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

export const COLOR_ESTADO_INCIDENCIA: Record<EstadoIncidencia, string> = clasesPorEstado<EstadoIncidencia>({
  abierta: "error",
  en_gestion: "advertencia",
  resuelta: "exito",
  cerrada: "neutral",
});

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

export const COLOR_ESTADO_MANIFIESTO: Record<EstadoManifiesto, string> = clasesPorEstado<EstadoManifiesto>({
  borrador: "advertencia",
  confirmado: "info",
  en_ruta: "info",
  completado: "exito",
  cancelado: "neutral",
});

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

export const COLOR_ESTADO_PERIODO: Record<EstadoPeriodo, string> = clasesPorEstado<EstadoPeriodo>({
  abierto: "info",
  cerrado: "neutral",
  facturado: "exito",
  anulado: "error",
});

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
      return CLASES_BADGE_VARIANTE.exito;
    case "advertencia":
      return CLASES_BADGE_VARIANTE.advertencia;
    case "error":
      return CLASES_BADGE_VARIANTE.error;
    case "neutro":
    default:
      return CLASES_BADGE_VARIANTE.neutral;
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

export const COLOR_ESTADO_LIQUIDACION: Record<EstadoLiquidacion, string> = clasesPorEstado<EstadoLiquidacion>({
  borrador: "neutral",
  emitida: "info",
  pagada: "exito",
});

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

export const COLOR_ESTADO_CONCILIACION: Record<EstadoEventoConciliacion, string> = clasesPorEstado<EstadoEventoConciliacion>({
  pendiente: "advertencia",
  revisado: "info",
  resuelto: "exito",
  ignorado: "neutral",
});

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

export const COLOR_ESTADO_MATCH_PAGO: Record<EstadoMatchPago, string> = clasesPorEstado<EstadoMatchPago>({
  sin_atribuir: "advertencia",
  atribuido: "info",
  conciliado: "exito",
  parcial: "advertencia",
  sobrante: "advertencia",
  descartado: "neutral",
});

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

export const COLOR_ESTADO_COBRO_PERIODO: Record<EstadoCobroPeriodo, string> = clasesPorEstado<EstadoCobroPeriodo>({
  no_aplica: "neutral",
  pendiente: "advertencia",
  parcial: "advertencia",
  pagado: "exito",
});

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
