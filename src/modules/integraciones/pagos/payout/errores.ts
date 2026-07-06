/**
 * Jerarquía de errores del puerto de PAYOUTS SALIENTES.
 * =============================================================================
 *
 * Espejo de `dte/errores.ts` y `pagos/errores.ts`. NINGÚN error incluye la
 * credencial del proveedor (API key de Fintoc payouts / banca), el secreto de
 * webhook ni ningún valor sensible — regla dura del proyecto. Los mensajes son
 * operativos y saneados.
 *
 * DISTINCIÓN CLAVE (la usa el job de `dinero` para decidir si reintenta):
 *   - `ErrorPayoutConfig`  → NO reintentable. Falta credencial, falta opt-in,
 *     config ausente, datos del destinatario inválidos. Reintentar no ayuda:
 *     requiere intervención (completar config / habilitar opt-in / corregir
 *     datos). El job marca el payout como `fallido` y alerta, NO reintenta.
 *   - `ErrorPayoutOperativo` → SÍ reintentable. Timeout, red, 429, 5xx. El job
 *     reintenta con backoff; el adaptador ya reintenta internamente, esto es la
 *     última red de seguridad a nivel de job.
 */

/**
 * Error base del puerto de payouts. Usar las subclases concretas — esta clase
 * captura cualquier error de payout sin discriminar la causa.
 */
export class ErrorPayout extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorPayout";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error de CONFIGURACIÓN o precondición del payout — NO reintentable.
 *
 * Causas: no existe `courier_config_payout`, falta la credencial cifrada del
 * proveedor, el tenant no tiene opt-in real, o los datos del destinatario son
 * inválidos. Reintentar sin resolver la causa solo quema cuota/tiempo: el job
 * debe marcar el payout `fallido`, alertar al courier y NO reintentar.
 *
 * `detalle` NUNCA incluye el valor de un secreto — solo describe qué falta.
 */
export class ErrorPayoutConfig extends ErrorPayout {
  /** Marca explícita para el job: este error no se reintenta. */
  readonly reintentable = false as const;

  constructor(detalle: string) {
    super(`Configuración de payout ausente o inválida: ${detalle}`);
    this.name = "ErrorPayoutConfig";
  }
}

/**
 * Error OPERATIVO/transitorio contra el proveedor de payout — SÍ reintentable.
 *
 * Causas: timeout, error de red, HTTP 429 (límite de tasa) o 5xx del proveedor.
 * El job puede reintentar con backoff (la `idempotencyKey` determinística evita
 * la doble transferencia). `codigoHttp` es opcional (puede ser un fallo de red
 * sin status). `mensajeProveedor` viene YA saneado: jamás la API key, el cuerpo
 * crudo completo ni headers de autenticación.
 */
export class ErrorPayoutOperativo extends ErrorPayout {
  /** Marca explícita para el job/utilidad de backoff: este error se reintenta. */
  readonly reintentable = true as const;
  readonly codigoHttp?: number;
  readonly retryAfterMs?: number;
  readonly mensajeProveedor: string;

  constructor(
    mensajeProveedor: string,
    opts?: { codigoHttp?: number; retryAfterMs?: number },
  ) {
    const prefijo =
      opts?.codigoHttp !== undefined ? `Proveedor de payout HTTP ${opts.codigoHttp}` : "Fallo operativo de payout";
    super(`${prefijo}: ${mensajeProveedor}`);
    this.name = "ErrorPayoutOperativo";
    this.mensajeProveedor = mensajeProveedor;
    if (opts?.codigoHttp !== undefined) this.codigoHttp = opts.codigoHttp;
    if (opts?.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
  }
}
