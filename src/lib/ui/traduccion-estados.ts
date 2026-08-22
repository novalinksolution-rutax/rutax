/**
 * Traducción centralizada de enums del módulo operacion al español de Chile.
 *
 * Esta es la ÚNICA fuente de verdad para mostrar estados en la UI.
 * Todos los componentes que necesiten mostrar estados importan desde aquí.
 * Sin traducciones duplicadas ni distintas en diferentes partes del código.
 *
 * Fuente: tablas de traducción del documento docs/ux/fase-b-operacion.md (§B-1)
 */

import type { EstadoPedido, TipoIncidencia, EstadoManifiesto, EstadoIncidencia, EstadoGeocoding, CoberturaEstado, SituacionRetiro } from "@/modules/operacion/tipos";
import type {
  EstadoPeriodo,
  EstadoSii,
  EstadoLiquidacion,
  EstadoEventoConciliacion,
  TipoDiferenciaConciliacion,
  EstadoMatchPago,
  EstadoCobroPeriodo,
  EstadoPayout,
  CategoriaNegocioConciliacion,
  AccionSugeridaConciliacion,
} from "@/modules/dinero/tipos";
import type {
  EstadoSuscripcion,
  // `EstadoPeriodo` de `plataforma` colisiona de nombre con el de `dinero` (ya
  // importado arriba) — alias obligatorio.
  EstadoPeriodo as EstadoPeriodoSuscripcion,
  EstadoPago as EstadoPagoSuscripcion,
  EstadoMandato,
  MetodoPago,
} from "@/modules/plataforma/tipos";

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

// =============================================================================
// Puente a las variantes del componente <Badge> (fuente ÚNICA de render de
// estado). En vez de pintar `<span>` a mano con clases sueltas, la UI usa
// `<Badge variant={badgeDeVariante(...)}>`. Mantiene una sola altura, radio,
// borde y foco en las 41 pantallas (DESIGN_SYSTEM §4/§9, consistencia extrema).
// =============================================================================

/** Variantes admitidas por el componente Badge usadas para estados. */
export type BadgeVariante =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning"
  | "info"
  | "error"
  | "neutral"
  | "outline";

const VARIANTE_A_BADGE: Record<VarianteEstado, BadgeVariante> = {
  neutral: "neutral",
  info: "info",
  exito: "success",
  advertencia: "warning",
  error: "error",
  marca: "default",
};

/** Convierte una VarianteEstado (vocabulario interno) a variante de <Badge>. */
export function badgeDeVariante(variante: VarianteEstado): BadgeVariante {
  return VARIANTE_A_BADGE[variante];
}

/** Construye el mapa estado→variante-de-Badge a partir de un mapa estado→variante. */
function badgePorEstado<E extends string>(
  variantes: Record<E, VarianteEstado>
): Record<E, BadgeVariante> {
  const salida = {} as Record<E, BadgeVariante>;
  for (const estado of Object.keys(variantes) as E[]) {
    salida[estado] = VARIANTE_A_BADGE[variantes[estado]];
  }
  return salida;
}

const VARIANTE_ESTADO_PEDIDO: Record<EstadoPedido, VarianteEstado> = {
  pendiente_asignacion: "advertencia",
  asignado: "info",
  en_ruta: "info",
  entregado: "exito",
  entregado_manual: "exito",
  fallido: "error",
  fallido_manual: "error",
  cancelado: "neutral",
  devuelto: "advertencia",
};
export const COLOR_ESTADO_PEDIDO = clasesPorEstado(VARIANTE_ESTADO_PEDIDO);
export const BADGE_ESTADO_PEDIDO = badgePorEstado(VARIANTE_ESTADO_PEDIDO);

// =============================================================================
// SituacionRetiro — ¿está el bulto en poder del courier? (migración 20260812000002)
// =============================================================================
// Eje PROPIO de Rutax, ORTOGONAL a EstadoPedido: un pedido puede estar
// `pendiente_asignacion` y a la vez `retirado`, y esa combinación es justamente
// la que la pantalla de asignación ofrece. Nunca mezclar los dos vocabularios en
// un mismo badge — son dos preguntas distintas ("¿en qué punto del ciclo va?" y
// "¿lo tenemos físicamente?").
//
// `Record<SituacionRetiro, …>` es intencional: si mañana el enum de Postgres gana
// un cuarto valor y se refleja en SITUACIONES_RETIRO, estos mapas dejan de
// compilar hasta que alguien decida qué texto y qué color le corresponden.

export const TEXTO_SITUACION_RETIRO: Record<SituacionRetiro, string> = {
  // "Por retirar" y no "Pendiente": `pendiente` a secas se confunde con
  // `pendiente_asignacion` del estado del pedido, que es otra cosa.
  pendiente: "Por retirar",
  retirado: "Retirado",
  no_procesado: "No procesado",
};

export function traducirSituacionRetiro(situacion: SituacionRetiro): string {
  return TEXTO_SITUACION_RETIRO[situacion] ?? situacion;
}

// Sin rojo a propósito: ninguno de los tres es una incidencia. Que un candidato
// no se retire es el desenlace NORMAL de los pedidos que despacha otro courier —
// pintarlo de alarma sería gritar sobre la mitad del universo ingestado.
const VARIANTE_SITUACION_RETIRO: Record<SituacionRetiro, VarianteEstado> = {
  pendiente: "info",      // sigue en juego mientras dure la mañana de retiro
  retirado: "exito",      // está en poder del courier: cuenta para el día
  no_procesado: "neutral",// desenlace terminal sin acción pendiente
};
export const COLOR_SITUACION_RETIRO = clasesPorEstado(VARIANTE_SITUACION_RETIRO);
export const BADGE_SITUACION_RETIRO = badgePorEstado(VARIANTE_SITUACION_RETIRO);

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

const VARIANTE_ESTADO_INCIDENCIA: Record<EstadoIncidencia, VarianteEstado> = {
  abierta: "error",
  en_gestion: "advertencia",
  resuelta: "exito",
  cerrada: "neutral",
};
export const COLOR_ESTADO_INCIDENCIA = clasesPorEstado(VARIANTE_ESTADO_INCIDENCIA);
export const BADGE_ESTADO_INCIDENCIA = badgePorEstado(VARIANTE_ESTADO_INCIDENCIA);

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

const VARIANTE_ESTADO_MANIFIESTO: Record<EstadoManifiesto, VarianteEstado> = {
  borrador: "advertencia",
  confirmado: "info",
  en_ruta: "info",
  completado: "exito",
  cancelado: "neutral",
};
export const COLOR_ESTADO_MANIFIESTO = clasesPorEstado(VARIANTE_ESTADO_MANIFIESTO);
export const BADGE_ESTADO_MANIFIESTO = badgePorEstado(VARIANTE_ESTADO_MANIFIESTO);

// =============================================================================
// EstadoSeller — estado de la CUENTA del seller, no de su empresa
// =============================================================================
// `invitado` significa que el courier ya dio de alta a este cliente pero nadie
// de esa empresa entró todavía al portal. El seller EXISTE y puede tener
// pedidos igual (el courier le crea same-day sin que el otro haya entrado
// nunca): por eso aparece en los filtros del courier, y por eso conviene
// rotularlo en vez de esconderlo.

export type EstadoSeller = "invitado" | "activo" | "suspendido";

export const TEXTO_ESTADO_SELLER: Record<EstadoSeller, string> = {
  invitado: "Invitado",
  activo: "Activo",
  suspendido: "Suspendido",
};

export function traducirEstadoSeller(estado: string): string {
  return TEXTO_ESTADO_SELLER[estado as EstadoSeller] ?? estado;
}

const VARIANTE_ESTADO_SELLER: Record<EstadoSeller, VarianteEstado> = {
  invitado: "advertencia",
  activo: "exito",
  suspendido: "error",
};
export const BADGE_ESTADO_SELLER = badgePorEstado(VARIANTE_ESTADO_SELLER);

/**
 * Nombre del seller para un selector, con su estado colgado cuando NO está
 * activo: `Comercial Andes · Invitado`.
 *
 * El estado se omite en el caso normal a propósito. Rotular "Activo" en cada
 * fila sería ruido en todas para no decir nada en ninguna; el rótulo existe
 * justamente para explicar la excepción — "¿por qué aparece este nombre si esa
 * empresa nunca entró?".
 */
export function etiquetaSellerConEstado(nombre: string, estado: string | null | undefined): string {
  if (!estado || estado === "activo") return nombre;
  return `${nombre} · ${traducirEstadoSeller(estado)}`;
}

// =============================================================================
// EstadoGeocoding — F4, ítem 1.1 (migración 0013)
// =============================================================================

export const TEXTO_GEO_ESTADO: Record<EstadoGeocoding, string> = {
  pendiente: "Ubicando dirección…",
  resuelto: "Dirección ubicada",
  no_resuelto: "Dirección no ubicada",
  fuera_cobertura: "Fuera de cobertura",
};

export function traducirGeoEstado(estado: EstadoGeocoding): string {
  return TEXTO_GEO_ESTADO[estado] ?? estado;
}

const VARIANTE_GEO_ESTADO: Record<EstadoGeocoding, VarianteEstado> = {
  pendiente: "neutral",
  resuelto: "exito",
  no_resuelto: "error",
  fuera_cobertura: "error",
};
export const BADGE_GEO_ESTADO = badgePorEstado(VARIANTE_GEO_ESTADO);

// =============================================================================
// CoberturaEstado — F4, ítem 1.1 (migración 0013)
// =============================================================================

export const TEXTO_COBERTURA_ESTADO: Record<CoberturaEstado, string> = {
  pendiente: "Verificando cobertura…",
  tarifada: "Comuna tarifada",
  sin_tarifa_zona: "Comuna sin tarifa",
  requiere_revision: "Revisar dirección",
};

export function traducirCoberturaEstado(estado: CoberturaEstado): string {
  return TEXTO_COBERTURA_ESTADO[estado] ?? estado;
}

const VARIANTE_COBERTURA_ESTADO: Record<CoberturaEstado, VarianteEstado> = {
  pendiente: "neutral",
  tarifada: "exito",
  sin_tarifa_zona: "advertencia",
  requiere_revision: "advertencia",
};
export const BADGE_COBERTURA_ESTADO = badgePorEstado(VARIANTE_COBERTURA_ESTADO);

/**
 * Verdadero si el pedido requiere revisión manual de dirección/cobertura.
 * Usado para mostrar la bandeja "Direcciones por revisar" y los badges de alerta.
 */
export function requiereRevisionGeo(
  geoEstado: EstadoGeocoding,
  coberturaEstado: CoberturaEstado,
): boolean {
  return (
    geoEstado === "no_resuelto" ||
    geoEstado === "fuera_cobertura" ||
    coberturaEstado === "requiere_revision" ||
    coberturaEstado === "sin_tarifa_zona"
  );
}

/**
 * Minutos tras los cuales un pedido en `geo_estado='pendiente'` se considera
 * "rancio". El geocoding corre en segundos tras la ingesta, así que un pedido
 * que sigue pendiente pasado este umbral no está "en curso": su job nunca
 * corrió (Inngest caído, o data insertada fuera de la tubería de ingesta que
 * publica `operacion/pedido.ingestado`). Pasado el umbral, la UI deja de
 * mostrar el spinner infinito y ofrece reintentar la ubicación.
 */
export const UMBRAL_GEOCODING_RANCIO_MINUTOS = 15;

/**
 * Verdadero si un pedido lleva demasiado tiempo en `geo_estado='pendiente'` sin
 * geocodificarse — señal de que el geocoding está atascado, no en curso. Evita
 * el spinner "Ubicando dirección…" eterno cuando el job jamás va a resolver.
 */
export function geocodingPendienteRancio(
  geoEstado: EstadoGeocoding,
  geocodificadoEn: string | null,
  creadoEn: string,
): boolean {
  if (geoEstado !== "pendiente") return false;
  if (geocodificadoEn !== null) return false;
  return horasDesde(creadoEn) * 60 > UMBRAL_GEOCODING_RANCIO_MINUTOS;
}

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

const VARIANTE_ESTADO_PERIODO: Record<EstadoPeriodo, VarianteEstado> = {
  abierto: "info",
  cerrado: "neutral",
  facturado: "exito",
  anulado: "error",
};
export const COLOR_ESTADO_PERIODO = clasesPorEstado(VARIANTE_ESTADO_PERIODO);
export const BADGE_ESTADO_PERIODO = badgePorEstado(VARIANTE_ESTADO_PERIODO);

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

/** Variante del componente <Badge> para el estado SII. */
export function badgeEstadoSii(variante: TraduccionEstadoSii["variante"]): BadgeVariante {
  switch (variante) {
    case "exito":
      return "success";
    case "advertencia":
      return "warning";
    case "error":
      return "error";
    case "neutro":
    default:
      return "neutral";
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

const VARIANTE_ESTADO_LIQUIDACION: Record<EstadoLiquidacion, VarianteEstado> = {
  borrador: "neutral",
  emitida: "info",
  pagada: "exito",
};
export const COLOR_ESTADO_LIQUIDACION = clasesPorEstado(VARIANTE_ESTADO_LIQUIDACION);
export const BADGE_ESTADO_LIQUIDACION = badgePorEstado(VARIANTE_ESTADO_LIQUIDACION);

// =============================================================================
// EstadoPayout — payouts a conductores (F19, Bloque 3)
// =============================================================================

export const TEXTO_ESTADO_PAYOUT: Record<EstadoPayout, string> = {
  pendiente: "Pendiente",
  enviado: "Enviado",
  confirmado: "Confirmado",
  rechazado: "Rechazado",
  fallido: "Fallido",
};

export function traducirEstadoPayout(estado: EstadoPayout): string {
  return TEXTO_ESTADO_PAYOUT[estado] ?? estado;
}

const VARIANTE_ESTADO_PAYOUT: Record<EstadoPayout, VarianteEstado> = {
  pendiente: "neutral",
  enviado: "info",
  confirmado: "exito",
  rechazado: "error",
  fallido: "error",
};
export const COLOR_ESTADO_PAYOUT = clasesPorEstado(VARIANTE_ESTADO_PAYOUT);
export const BADGE_ESTADO_PAYOUT = badgePorEstado(VARIANTE_ESTADO_PAYOUT);

// =============================================================================
// EstadoEventoConciliacion — bandeja de excepciones (§1.1 P1, jul 2026)
// =============================================================================
// 8 estados (antes 4): no-terminales `pendiente`/`en_analisis`/`esperando_info`/
// `requiere_ajuste`; terminales `resuelta_auto`/`resuelta_manual`/
// `aceptada_justificada`/`ignorada`. Ver `TRANSICIONES_VALIDAS` en
// `@/modules/dinero/conciliacion-clasificacion` para la máquina de estados.

export const TEXTO_ESTADO_CONCILIACION: Record<EstadoEventoConciliacion, string> = {
  pendiente: "Pendiente",
  en_analisis: "En análisis",
  esperando_info: "Esperando información",
  requiere_ajuste: "Requiere ajuste",
  resuelta_auto: "Resuelta por el sistema",
  resuelta_manual: "Resuelta",
  aceptada_justificada: "Revisada (sin cambios)",
  ignorada: "Descartada",
};

export function traducirEstadoConciliacion(estado: EstadoEventoConciliacion): string {
  return TEXTO_ESTADO_CONCILIACION[estado] ?? estado;
}

const VARIANTE_ESTADO_CONCILIACION: Record<EstadoEventoConciliacion, VarianteEstado> = {
  pendiente: "advertencia",
  en_analisis: "info",
  esperando_info: "advertencia",
  requiere_ajuste: "advertencia",
  resuelta_auto: "exito",
  resuelta_manual: "exito",
  aceptada_justificada: "neutral",
  ignorada: "neutral",
};
export const COLOR_ESTADO_CONCILIACION = clasesPorEstado(VARIANTE_ESTADO_CONCILIACION);
export const BADGE_ESTADO_CONCILIACION = badgePorEstado(VARIANTE_ESTADO_CONCILIACION);

// =============================================================================
// CategoriaNegocioConciliacion — §1.1 P1
// =============================================================================

export const TEXTO_CATEGORIA_NEGOCIO_CONCILIACION: Record<CategoriaNegocioConciliacion, string> = {
  cumplimiento_dte: "Cumplimiento DTE",
  fuga_ingreso: "Fuga de ingreso",
  pagos_pendientes: "Pagos pendientes",
  integridad_datos: "Integridad de datos",
};

export function traducirCategoriaNegocioConciliacion(categoria: CategoriaNegocioConciliacion): string {
  return TEXTO_CATEGORIA_NEGOCIO_CONCILIACION[categoria] ?? categoria;
}

const VARIANTE_CATEGORIA_NEGOCIO_CONCILIACION: Record<CategoriaNegocioConciliacion, VarianteEstado> = {
  // Fuga de ingreso y cumplimiento DTE son las categorías con mayor riesgo
  // financiero/tributario directo — se resaltan en rojo (mismo criterio que
  // `esFugaDirecta` más abajo).
  cumplimiento_dte: "error",
  fuga_ingreso: "error",
  pagos_pendientes: "advertencia",
  integridad_datos: "neutral",
};
export const COLOR_CATEGORIA_NEGOCIO_CONCILIACION = clasesPorEstado(VARIANTE_CATEGORIA_NEGOCIO_CONCILIACION);
export const BADGE_CATEGORIA_NEGOCIO_CONCILIACION = badgePorEstado(VARIANTE_CATEGORIA_NEGOCIO_CONCILIACION);

// =============================================================================
// AccionSugeridaConciliacion — §1.1 P1
// =============================================================================

export const TEXTO_ACCION_SUGERIDA_CONCILIACION: Record<AccionSugeridaConciliacion, string> = {
  revisar_tarifa_aplicada: "Revisar tarifa aplicada",
  confirmar_con_seller: "Confirmar con el seller",
  confirmar_con_conductor: "Confirmar con el conductor",
  generar_cobro_manual: "Crear cobro manual",
  generar_ajuste_liquidacion: "Crear ajuste de liquidación",
  reasignar_lineas_a_periodo: "Reasignar líneas al período",
  reenviar_o_verificar_dte: "Reenviar o verificar el DTE",
  gestionar_cobranza_seller: "Cobrar al seller",
  gestionar_pago_conductor: "Gestionar el pago al conductor",
  marcar_error_del_motor: "Marcar como error del motor",
  sin_accion_requerida: "Sin acción requerida",
  revisar_estado_externo: "Revisar estado externo",
};

export function traducirAccionSugeridaConciliacion(accion: AccionSugeridaConciliacion): string {
  return TEXTO_ACCION_SUGERIDA_CONCILIACION[accion] ?? accion;
}

// =============================================================================
// TipoDiferenciaConciliacion — Fase C
// =============================================================================

export const TEXTO_TIPO_DIFERENCIA: Record<TipoDiferenciaConciliacion, string> = {
  // Tipos originales (C6)
  pedido_entregado_sin_linea_cobro: "Pedido entregado sin línea de cobro",
  pedido_entregado_sin_linea_liquidacion: "Pedido entregado sin línea de liquidación",
  linea_cobro_sin_pedido_entregado: "Línea de cobro sin pedido entregado",
  folio_consumido_sin_dte_persistido: "Folio consumido sin DTE registrado",
  periodo_cerrado_con_lineas_sueltas: "Período cerrado con líneas sin asignar",
  monto_dte_difiere_de_lineas: "Monto del DTE no coincide con líneas",
  // Tipos nuevos (C7 / F17 — detectores de 3 fuentes)
  pagado_conductor_sin_cobro_seller: "Pagado al conductor sin cobro al seller (fuga)",
  cobrado_seller_no_pagado_conductor: "Cobrado al seller sin liquidar al conductor",
  reprogramacion_no_cobrada: "Reprogramación no cobrada",
  minimo_omitido: "Mínimo de facturación no aplicado",
  pago_seller_faltante: "Pago del seller pendiente de recibir",
  pago_conductor_faltante: "Pago al conductor pendiente de emitir",
  // Webhook de payout saliente (Fase 3, migración 20260708000002)
  payout_revertido_post_confirmacion: "Payout revertido tras confirmarse",
  // Webhook/polling de payout (migración 20260709000001) — separado de la
  // reversión genuina de arriba por recomendación de QA.
  payout_estado_no_reconocido: "Estado de pago no reconocido",
  // Integridad estructural (migración 20260805000001)
  linea_cobro_sin_periodo: "Línea de cobro sin período (no se facturará)",
  // Punto ciego H2 (migración 20260811000002): lado liquidación de
  // linea_cobro_sin_pedido_entregado — el conductor ya cobró (o va a cobrar)
  // una entrega cancelada/devuelta.
  linea_liquidacion_sin_pedido_entregado: "Línea de liquidación sin pedido entregado",
  // Reasignación de conductor no propagada (migración 20260812000001)
  liquidacion_atribuida_a_conductor_incorrecto: "Liquidación atribuida al conductor equivocado",
  retiro_sin_monto_configurado: "Retiro sin monto configurado",
};

export function traducirTipoDiferencia(tipo: TipoDiferenciaConciliacion): string {
  return TEXTO_TIPO_DIFERENCIA[tipo] ?? tipo;
}

/**
 * Verdadero si el tipo de diferencia corresponde a fuga directa de revenue.
 * Estos tipos se muestran con variante "error" (alarma) en la bandeja.
 *
 * D1: `pagado_conductor_sin_cobro_seller` — se pagó sin cobrar (pérdida directa).
 * D3: `reprogramacion_no_cobrada` — recargo omitido.
 * D4: `minimo_omitido` — mínimo de facturación no aplicado.
 */
export function esFugaDirecta(tipo: TipoDiferenciaConciliacion): boolean {
  return (
    tipo === "pagado_conductor_sin_cobro_seller" ||
    tipo === "reprogramacion_no_cobrada" ||
    tipo === "minimo_omitido"
  );
}

/** Variante de badge para el tipo de diferencia. Fuga directa → error; resto → advertencia. */
export function badgeTipoDiferencia(tipo: TipoDiferenciaConciliacion): BadgeVariante {
  if (esFugaDirecta(tipo)) return "error";
  return "warning";
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

const VARIANTE_ESTADO_MATCH_PAGO: Record<EstadoMatchPago, VarianteEstado> = {
  sin_atribuir: "advertencia",
  atribuido: "info",
  conciliado: "exito",
  parcial: "advertencia",
  sobrante: "advertencia",
  descartado: "neutral",
};
export const COLOR_ESTADO_MATCH_PAGO = clasesPorEstado(VARIANTE_ESTADO_MATCH_PAGO);
export const BADGE_ESTADO_MATCH_PAGO = badgePorEstado(VARIANTE_ESTADO_MATCH_PAGO);

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

const VARIANTE_ESTADO_COBRO_PERIODO: Record<EstadoCobroPeriodo, VarianteEstado> = {
  no_aplica: "neutral",
  pendiente: "advertencia",
  parcial: "advertencia",
  pagado: "exito",
};
export const COLOR_ESTADO_COBRO_PERIODO = clasesPorEstado(VARIANTE_ESTADO_COBRO_PERIODO);
export const BADGE_ESTADO_COBRO_PERIODO = badgePorEstado(VARIANTE_ESTADO_COBRO_PERIODO);

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

// =============================================================================
// EstadoSuscripcion — suscripción SaaS del courier a Rutax (backstage `plataforma`)
// =============================================================================
// Mismos colores que `src/app/admin/suscripciones/tabla-suscripciones.tsx`
// (vista del super-admin): trial=azul/info, activa=verde/éxito,
// suspendida=ámbar/advertencia, cancelada=neutral.

export const TEXTO_ESTADO_SUSCRIPCION: Record<EstadoSuscripcion, string> = {
  trial: "Prueba",
  activa: "Activa",
  suspendida: "Suspendida",
  cancelada: "Cancelada",
};

export function traducirEstadoSuscripcion(estado: EstadoSuscripcion): string {
  return TEXTO_ESTADO_SUSCRIPCION[estado] ?? estado;
}

const VARIANTE_ESTADO_SUSCRIPCION: Record<EstadoSuscripcion, VarianteEstado> = {
  trial: "info",
  activa: "exito",
  suspendida: "advertencia",
  cancelada: "neutral",
};
export const COLOR_ESTADO_SUSCRIPCION = clasesPorEstado(VARIANTE_ESTADO_SUSCRIPCION);
export const BADGE_ESTADO_SUSCRIPCION = badgePorEstado(VARIANTE_ESTADO_SUSCRIPCION);

// =============================================================================
// EstadoPeriodoSuscripcion — período de cobro de la suscripción del courier
// =============================================================================

export const TEXTO_ESTADO_PERIODO_SUSCRIPCION: Record<EstadoPeriodoSuscripcion, string> = {
  pendiente: "Pendiente",
  pagado: "Pagado",
  vencido: "Vencido",
};

export function traducirEstadoPeriodoSuscripcion(estado: EstadoPeriodoSuscripcion): string {
  return TEXTO_ESTADO_PERIODO_SUSCRIPCION[estado] ?? estado;
}

const VARIANTE_ESTADO_PERIODO_SUSCRIPCION: Record<EstadoPeriodoSuscripcion, VarianteEstado> = {
  pendiente: "advertencia",
  pagado: "exito",
  vencido: "error",
};
export const COLOR_ESTADO_PERIODO_SUSCRIPCION = clasesPorEstado(VARIANTE_ESTADO_PERIODO_SUSCRIPCION);
export const BADGE_ESTADO_PERIODO_SUSCRIPCION = badgePorEstado(VARIANTE_ESTADO_PERIODO_SUSCRIPCION);

// =============================================================================
// EstadoPagoSuscripcion — un pago del historial de la suscripción del courier
// =============================================================================

export const TEXTO_ESTADO_PAGO_SUSCRIPCION: Record<EstadoPagoSuscripcion, string> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  fallido: "Fallido",
};

export function traducirEstadoPagoSuscripcion(estado: EstadoPagoSuscripcion): string {
  return TEXTO_ESTADO_PAGO_SUSCRIPCION[estado] ?? estado;
}

const VARIANTE_ESTADO_PAGO_SUSCRIPCION: Record<EstadoPagoSuscripcion, VarianteEstado> = {
  pendiente: "advertencia",
  confirmado: "exito",
  fallido: "error",
};
export const COLOR_ESTADO_PAGO_SUSCRIPCION = clasesPorEstado(VARIANTE_ESTADO_PAGO_SUSCRIPCION);
export const BADGE_ESTADO_PAGO_SUSCRIPCION = badgePorEstado(VARIANTE_ESTADO_PAGO_SUSCRIPCION);

// =============================================================================
// EstadoMandato — mandato de auto-cobro Fintoc de la suscripción del courier
// =============================================================================

export const TEXTO_ESTADO_MANDATO: Record<EstadoMandato, string> = {
  sin_mandato: "Sin activar",
  pendiente: "Confirmando con tu banco",
  activo: "Activo",
  cancelado: "Desactivado",
  fallido: "Con problemas",
};

export function traducirEstadoMandato(estado: EstadoMandato): string {
  return TEXTO_ESTADO_MANDATO[estado] ?? estado;
}

const VARIANTE_ESTADO_MANDATO: Record<EstadoMandato, VarianteEstado> = {
  sin_mandato: "neutral",
  pendiente: "info",
  activo: "exito",
  cancelado: "neutral",
  fallido: "error",
};
export const COLOR_ESTADO_MANDATO = clasesPorEstado(VARIANTE_ESTADO_MANDATO);
export const BADGE_ESTADO_MANDATO = badgePorEstado(VARIANTE_ESTADO_MANDATO);

// =============================================================================
// MetodoPago — método de un pago de la suscripción del courier a Rutax
// =============================================================================

const TEXTO_METODO_PAGO: Record<MetodoPago, string> = {
  fintoc_link: "Cobro automático",
  fintoc_recurrente: "Cobro automático",
  transferencia_manual: "Transferencia",
  cortesia: "Cortesía",
};

export function traducirMetodoPago(metodo: MetodoPago): string {
  return TEXTO_METODO_PAGO[metodo] ?? metodo;
}

// =============================================================================
// Bloque 0.3 del rediseño — los vocabularios que vivían fuera de este archivo
// =============================================================================
//
// Los seis de abajo estaban repartidos en archivos de pantalla: dos como mapas
// sueltos y cuatro como `switch` con clases de color escritas a mano
// (`border-success-subtle text-success`, `variant="destructive"`). Ninguno
// pasaba por el sistema de tonos, así que ninguno recibía sus correcciones —y
// cuatro de ellos ni siquiera usaban `BadgeEstado`.
//
// Los tipos van declarados acá como uniones de literales, no importados del
// dominio: son el contrato de PRESENTACIÓN. Si el dominio agrega un valor, el
// mapa devuelve `undefined`, el llamador cae en su valor por defecto, y la
// prueba mecánica de `tonos-estado.test.ts` sigue cuadrando contra las claves
// que sí existen acá.

// --- Salud de la conexión con la fuente (§12.3 del registro) -----------------
// Estaba en `(tenant)/sellers/page.tsx`.
//
// ⚠️ El registro distingue **caída** (`fault`) de **desconectada** (`inert`), y
// el código NO las distingue: token vencido, permiso revocado y fallo de
// descifrado terminan los tres en `desvinculada` con el mismo texto. Se deja en
// `fault`, que es el caso que exige actuar, y separarlas es trabajo del `bloque
// de falla externa` (bloque 9c).

export type EstadoSaludConexion = "sana" | "atencion" | "desvinculada" | "pendiente";

export const TEXTO_SALUD_CONEXION: Record<EstadoSaludConexion, string> = {
  sana: "Conectado",
  atencion: "Requiere atención",
  desvinculada: "Desconectado",
  pendiente: "Sin conectar",
};

const VARIANTE_SALUD_CONEXION: Record<EstadoSaludConexion, VarianteEstado> = {
  sana: "exito",
  atencion: "advertencia",
  desvinculada: "error",
  pendiente: "neutral",
};
export const BADGE_SALUD_CONEXION = badgePorEstado(VARIANTE_SALUD_CONEXION);

export function traducirSaludConexion(estado: string): string {
  return TEXTO_SALUD_CONEXION[estado as EstadoSaludConexion] ?? estado;
}

// --- Invitación a una persona del equipo (§9.3 del registro) -----------------
// Estaba en `(tenant)/equipo/panel-equipo.tsx`.

export type EstadoInvitacionEquipo = "pendiente" | "aceptada" | "expirada" | "revocada";

export const TEXTO_INVITACION: Record<EstadoInvitacionEquipo, string> = {
  pendiente: "Pendiente",
  aceptada: "Aceptada",
  expirada: "Expirada",
  revocada: "Revocada",
};

const VARIANTE_INVITACION: Record<EstadoInvitacionEquipo, VarianteEstado> = {
  pendiente: "advertencia",
  aceptada: "exito",
  expirada: "neutral",
  revocada: "neutral",
};
export const BADGE_INVITACION = badgePorEstado(VARIANTE_INVITACION);

export function traducirEstadoInvitacion(estado: string): string {
  return TEXTO_INVITACION[estado as EstadoInvitacionEquipo] ?? estado;
}

// --- Folio CAF ---------------------------------------------------------------
// Estaba en `(tenant)/onboarding/folios/panel-folios-caf.tsx`, como `switch`.
//
// El registro (Anexo A) dice que el folio NO es un objeto compartido: "es un
// número consumible, no un objeto con estados propios más allá de
// disponible/consumido". Por eso `vigente` va en `neutral` y no en verde: lo
// que de verdad hay que mirar —"por agotarse"— lo calcula la fila con su barra
// de consumo, y el bloqueo lo pone la verificación previa.

export type EstadoFolioCaf = "vigente" | "agotado" | "vencido";

export const TEXTO_FOLIO_CAF: Record<EstadoFolioCaf, string> = {
  vigente: "Vigente",
  agotado: "Agotado",
  vencido: "Vencido",
};

const VARIANTE_FOLIO_CAF: Record<EstadoFolioCaf, VarianteEstado> = {
  vigente: "neutral",
  agotado: "neutral",
  vencido: "error",
};
export const BADGE_FOLIO_CAF = badgePorEstado(VARIANTE_FOLIO_CAF);

export function traducirEstadoFolioCaf(estado: string): string {
  return TEXTO_FOLIO_CAF[estado as EstadoFolioCaf] ?? estado;
}

// --- Certificación ante el proveedor DTE -------------------------------------
// Estaba en `(tenant)/onboarding/dte/formulario-configuracion-dte.tsx`.

export type EstadoCertificacionDte = "activo" | "en_proceso" | "con_problemas" | "pendiente";

export const TEXTO_CERTIFICACION_DTE: Record<EstadoCertificacionDte, string> = {
  activo: "Activo",
  en_proceso: "En proceso",
  con_problemas: "Con problemas",
  pendiente: "Pendiente",
};

const VARIANTE_CERTIFICACION_DTE: Record<EstadoCertificacionDte, VarianteEstado> = {
  activo: "exito",
  en_proceso: "info",
  con_problemas: "error",
  pendiente: "neutral",
};
export const BADGE_CERTIFICACION_DTE = badgePorEstado(VARIANTE_CERTIFICACION_DTE);

export function traducirEstadoCertificacionDte(estado: string): string {
  return TEXTO_CERTIFICACION_DTE[estado as EstadoCertificacionDte] ?? estado;
}

// --- Conexión bancaria de cobranza -------------------------------------------
// Estaba en `(tenant)/onboarding/cobranza/formulario-conexion-cobranza.tsx`.

export type EstadoConexionCobranza = "conectado" | "error" | "revocado" | "desconectado";

export const TEXTO_CONEXION_COBRANZA: Record<EstadoConexionCobranza, string> = {
  conectado: "Conectado",
  error: "Con problemas",
  revocado: "Revocado",
  desconectado: "Desconectado",
};

const VARIANTE_CONEXION_COBRANZA: Record<EstadoConexionCobranza, VarianteEstado> = {
  conectado: "exito",
  error: "error",
  revocado: "neutral",
  desconectado: "neutral",
};
export const BADGE_CONEXION_COBRANZA = badgePorEstado(VARIANTE_CONEXION_COBRANZA);

export function traducirEstadoConexionCobranza(estado: string): string {
  return TEXTO_CONEXION_COBRANZA[estado as EstadoConexionCobranza] ?? estado;
}

// --- Salud de un job de infraestructura --------------------------------------
// Estaba en `admin/salud/page.tsx`, dentro de un componente local llamado
// `BadgeEstado` que SOMBREABA al del sistema con otra API. No está en el
// registro de objetos —es infraestructura, no dominio— pero comparte tonos.

export type EstadoSaludJob = "ok" | "error" | "ejecutando";

export const TEXTO_SALUD_JOB: Record<EstadoSaludJob, string> = {
  ok: "OK",
  error: "Error",
  ejecutando: "En curso",
};

const VARIANTE_SALUD_JOB: Record<EstadoSaludJob, VarianteEstado> = {
  ok: "exito",
  error: "error",
  ejecutando: "info",
};
export const BADGE_SALUD_JOB = badgePorEstado(VARIANTE_SALUD_JOB);

export function traducirEstadoSaludJob(estado: string): string {
  return TEXTO_SALUD_JOB[estado as EstadoSaludJob] ?? estado;
}

// --- Respuesta del SII, como mapa ---------------------------------------------
// `traducirEstadoSii` ya existía más arriba, pero con otra forma —devuelve
// `{texto, variante, icono}` con las variantes escritas `neutro`, no `neutral`—
// así que el sistema de tonos no lo veía. Este mapa lo expone como los demás,
// sin tocar la función original, que sigue teniendo llamadores.

const VARIANTE_ESTADO_SII_MAPA: Record<EstadoSii, VarianteEstado> = {
  pendiente: "neutral",
  aceptado: "exito",
  rechazado: "error",
  aceptado_con_discrepancias: "advertencia",
};
export const BADGE_ESTADO_SII = badgePorEstado(VARIANTE_ESTADO_SII_MAPA);

export function traducirEstadoSiiTexto(estado: EstadoSii): string {
  return traducirEstadoSii(estado).texto;
}
