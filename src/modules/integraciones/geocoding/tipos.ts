/**
 * Tipos del puerto de geocoding.
 * =====================================================================
 *
 * El núcleo de `operacion` NO importa estos tipos: el job (que vive en
 * `integraciones`) es quien traduce entre estos tipos y el esquema
 * `operacion.pedidos`. Estos tipos describen el contrato del puerto y
 * el resultado normalizado que todo adaptador (stub/google) devuelve.
 *
 * NOTA para `backend` (espejo de columnas): el job escribe en
 * `operacion.pedidos` las columnas lat, long, geo_estado, geo_confianza,
 * geocodificado_en y cobertura_estado (migración 0013). Los enums de BD
 * `operacion.geo_estado` y `operacion.cobertura_estado` deben mantenerse
 * en sincronía con `EstadoGeocoding` y `CoberturaEstado` de este módulo.
 */

/** Proveedor que resolvió (o intentó resolver) una dirección. */
export type ProveedorGeocoding = 'google' | 'here' | 'stub';

/**
 * Estado del resultado de geocodificación de UNA dirección.
 * Coincide con el CHECK de `integraciones.geocoding_cache.geo_estado` y con
 * los valores no-`pendiente` del enum `operacion.geo_estado`.
 */
export type EstadoGeocoding = 'resuelto' | 'no_resuelto' | 'fuera_cobertura';

/**
 * Estado de cobertura/tarificación que el JOB calcula (no el adaptador).
 * Espeja el enum `operacion.cobertura_estado` (sin `pendiente`, que es el
 * default antes de geocodificar).
 */
export type CoberturaEstado = 'tarifada' | 'sin_tarifa_zona' | 'requiere_revision';

/**
 * Insumos para geocodificar. Solo datos de dirección — NUNCA nombre ni
 * teléfono del destinatario (minimización de datos personales): el adaptador
 * no necesita esos campos y no deben viajar a un proveedor externo.
 */
export interface ParametrosGeocoding {
  /** Dirección de calle del destinatario (sin normalizar; el helper la normaliza). */
  direccion: string;
  /** Comuna declarada en el pedido (sin normalizar). */
  comuna: string;
  /** Región. Por defecto la RM; el stub y el adaptador google asumen RM. */
  region?: string;
}

/**
 * Resultado normalizado de geocodificación. Todo adaptador concreto devuelve
 * esta forma — el job nunca ve la respuesta cruda del proveedor.
 */
export interface ResultadoGeocoding {
  /** `true` si `estado === 'resuelto'` (lat/long válidos). Conveniencia. */
  resuelto: boolean;
  /** Latitud. `null` salvo `estado === 'resuelto'`. */
  lat: number | null;
  /** Longitud. `null` salvo `estado === 'resuelto'`. */
  long: number | null;
  /**
   * Confianza 0.0–1.0. `null` si no se resolvió. El adaptador la deriva del
   * `location_type` del proveedor (google) o la fija constante (stub = 0.5).
   */
  confianza: number | null;
  /** Estado del resultado. */
  estado: EstadoGeocoding;
  /**
   * Comuna canónica que el proveedor/stub asoció al resultado (catálogo
   * `COMUNAS_RM`), o `null` si no se pudo determinar. El job la compara con
   * la comuna declarada para detectar discrepancias (`requiere_revision`).
   */
  comunaResuelta: string | null;
  /** Proveedor que produjo el resultado. */
  proveedor: ProveedorGeocoding;
}
