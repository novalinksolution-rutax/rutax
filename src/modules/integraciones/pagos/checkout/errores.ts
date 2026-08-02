/**
 * Errores del puerto de CHECKOUT de suscripción (cobro Rutax→courier).
 * =============================================================================
 * Molde idéntico a `pagos/payout/errores.ts`:
 *  - `ErrorCheckoutConfig`  → NO reintentable (falta secret key / gate cerrado).
 *  - `ErrorCheckoutOperativo` → reintentable (429/5xx/red de Fintoc).
 * Ninguno lleva jamás la secret key ni datos sensibles en el mensaje.
 */

export class ErrorCheckoutConfig extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCheckoutConfig';
  }
}

export class ErrorCheckoutOperativo extends Error {
  readonly codigoHttp?: number;
  constructor(mensaje: string, opts?: { codigoHttp?: number }) {
    super(mensaje);
    this.name = 'ErrorCheckoutOperativo';
    if (opts?.codigoHttp !== undefined) this.codigoHttp = opts.codigoHttp;
  }
}
