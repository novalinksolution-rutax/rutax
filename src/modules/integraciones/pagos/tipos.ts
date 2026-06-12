/**
 * Tipos del dominio del puerto de conciliación de pagos (cobranza courier→seller).
 * =============================================================================
 *
 * El núcleo (`dinero`, jobs de matching) NUNCA ve un `Movement` crudo de Fintoc:
 * solo este `MovimientoPago` normalizado. El adaptador (`fintoc/adaptador.ts`)
 * es el único que conoce la forma de Fintoc y la traduce a estos tipos.
 *
 * Decisiones de normalización (ver `docs/arquitectura/cobranza-fintoc.md` §5b):
 * - El RUT de la contraparte (`sender_account.holder_id`) llega de Fintoc SIN
 *   puntos ni guion, pero puede traer formato inconsistente entre instituciones.
 *   `normalizarRut` lo deja en una forma canónica (solo dígitos + DV en mayúscula)
 *   para comparar contra el RUT del seller. La normalización vive AQUÍ (TS), no en
 *   BD — la columna `contraparte_rut_normalizado` recibe el valor ya normalizado.
 * - `sender_account` es NULLABLE en Fintoc (~81 de 300 movimientos lo traen) →
 *   `contraparteRutNormalizado` y `contraparteNombre` pueden ser `null`. El
 *   matching debe tolerarlo (cae a `sin_atribuir`, no adivina).
 * - Montos en CLP entero (invariante del proyecto). `esEntrante = montoClp > 0`
 *   se conserva como booleano explícito para que el matching no re-derive el signo.
 */

/** Tipo de movimiento bancario normalizado (espejo reducido del `type` de Fintoc). */
export type TipoMovimientoPago = "transferencia" | "otro";

/**
 * Movimiento bancario normalizado del dominio. Es lo ÚNICO que el adaptador de
 * pagos expone hacia `dinero` — nunca el `Movement` crudo de Fintoc.
 */
export interface MovimientoPago {
  /** `Movement.id` de Fintoc (string opaco). Llave de idempotencia de ingesta. */
  movimientoExternoId: string;
  /** Monto en CLP entero. Positivo = entra dinero a la cuenta del courier. */
  montoClp: number;
  /** Derivado de `montoClp > 0` — entrante (cobro potencial del seller). */
  esEntrante: boolean;
  /** `transferencia` (atribuible a un seller) u `otro` (comisión, etc.). */
  tipo: TipoMovimientoPago;
  /** Fecha del movimiento en ISO date (`YYYY-MM-DD`), zona del proveedor. */
  fechaMovimiento: string;
  /**
   * RUT de la contraparte normalizado (solo dígitos + DV en mayúscula, sin
   * puntos ni guion), o `null` si Fintoc no expuso `sender_account` para este
   * movimiento. NUNCA se infiere — `null` significa "no atribuible por RUT".
   */
  contraparteRutNormalizado: string | null;
  /** Nombre del titular de la contraparte, o `null` si no vino. */
  contraparteNombre: string | null;
  /** Glosa/comentario del movimiento, o `null`. Señal auxiliar, no llave única. */
  glosa: string | null;
  /** Estado del movimiento según Fintoc (p. ej. `"confirmed"`). */
  estado: string;
  /**
   * Payload crudo del movimiento (para auditoría y reproceso en
   * `pagos_recibidos.payload_crudo`). NO contiene secretos: el `link_token` y el
   * secreto de webhook nunca viajan dentro de un `Movement`.
   */
  payloadCrudo: Record<string, unknown>;
}

/**
 * Normaliza un RUT chileno a su forma canónica para comparación: solo dígitos
 * del cuerpo + dígito verificador (K en mayúscula), SIN puntos ni guion.
 *
 * Fintoc entrega `holder_id` ya sin formato (p. ej. `"745931278"`), pero esta
 * función es defensiva ante variantes (`"74.593.127-8"`, `"74593127-K"`,
 * espacios) para que la comparación con el RUT del seller sea estable
 * independientemente de cómo cada institución lo reporte.
 *
 * Devuelve `null` para entradas vacías/no parseables (jamás inventa un RUT).
 * NO valida el dígito verificador: solo canoniza el formato (la validación de
 * DV, si se requiere, es responsabilidad del módulo de identidad, no del
 * adaptador de pagos — el adaptador es hoja del grafo).
 */
export function normalizarRut(rutCrudo: string | null | undefined): string | null {
  if (rutCrudo == null) return null;
  // Quitar todo lo que no sea dígito o K/k (DV). Esto elimina puntos, guion y
  // espacios en un solo paso.
  const limpio = rutCrudo.replace(/[^0-9kK]/g, "").toUpperCase();
  if (limpio.length < 2) return null; // necesita al menos cuerpo + DV.
  return limpio;
}
