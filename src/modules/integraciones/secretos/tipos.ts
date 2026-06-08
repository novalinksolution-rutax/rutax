/**
 * Tipos del mecanismo central de cifrado/descifrado de secretos.
 *
 * Espejo en TS del enum `identidad.tipo_secreto` (migración 0003). Si se
 * amplía allá, ampliar aquí — un solo lugar de la verdad por capa.
 */
export type TipoSecreto =
  | "certificado_digital_courier"
  | "credenciales_proveedor_dte"
  | "token_oauth_ml_access"
  | "token_oauth_ml_refresh"
  | "archivo_caf";

/**
 * Referencia opaca devuelta tras cifrar: lo único que las tablas de negocio
 * (`courier_config_dte`, `conexiones_seller_ml`, etc.) deben persistir.
 * Nunca el valor, nunca metadata sensible.
 */
export type ReferenciaSecreto = string & { readonly __marca: "ReferenciaSecreto" };

export function comoReferenciaSecreto(id: string): ReferenciaSecreto {
  return id as ReferenciaSecreto;
}

/** Metadata NO sensible asociada a un secreto — jamás contiene el valor. */
export interface MetadataSecreto {
  /** Identificador de la clave de cifrado usada (rotación de claves). */
  kid?: string;
  /** Algoritmo de cifrado simétrico empleado. */
  alg?: string;
  /** Para archivos grandes (.pfx, CAF) guardados en Storage cifrado: ruta/objeto. */
  storageRef?: string;
  /** Cualquier otra etiqueta de auditoría no sensible (p. ej. "subido_por"). */
  [clave: string]: unknown;
}

export interface CifrarEntrada {
  tenantId: string;
  tipoSecreto: TipoSecreto;
  /** Valor en claro — texto (tokens, credenciales JSON) o binario (.pfx, CAF). */
  valor: string | Uint8Array;
  /** Fecha de expiración del secreto si aplica (p. ej. token_expira_en, certificado). */
  venceEn?: Date | null;
  metadata?: MetadataSecreto;
}

export interface CifrarResultado {
  /** El único dato que vuelve al llamador para persistir en la tabla de negocio. */
  referenciaExternaId: ReferenciaSecreto;
}

export interface DescifrarResultado {
  /** Valor en claro — el llamador es responsable de no loguearlo ni propagarlo. */
  valor: string | Uint8Array;
  tipoSecreto: TipoSecreto;
  venceEn: Date | null;
  metadata: MetadataSecreto;
}

/** Claves que NUNCA deben aparecer en `metadata` — espejo del CHECK de BD. */
export const CLAVES_PROHIBIDAS_EN_METADATA = [
  "valor",
  "token",
  "password",
  "secret",
  "access_token",
  "refresh_token",
] as const;
