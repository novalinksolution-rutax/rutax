/**
 * Errores del puerto de AUTO-COBRO RECURRENTE (suscripción Rutax → courier).
 * =============================================================================
 * Molde idéntico a `checkout/errores.ts` / `payout/errores.ts`:
 *  - `ErrorSuscripcionConfig`   → NO reintentable (falta secret key / gate cerrado).
 *  - `ErrorSuscripcionOperativo` → problema del proveedor (429/5xx/red), saneado.
 * Ninguno lleva jamás la secret key, el mandatoToken ni datos sensibles.
 */

export class ErrorSuscripcionConfig extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorSuscripcionConfig';
  }
}

export class ErrorSuscripcionOperativo extends Error {
  readonly codigoHttp?: number;
  constructor(mensaje: string, opts?: { codigoHttp?: number }) {
    super(mensaje);
    this.name = 'ErrorSuscripcionOperativo';
    if (opts?.codigoHttp !== undefined) this.codigoHttp = opts.codigoHttp;
  }
}
