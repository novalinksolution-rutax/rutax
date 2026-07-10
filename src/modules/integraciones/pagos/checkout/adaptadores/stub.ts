/**
 * Adaptador STUB de checkout (sandbox) — NO llama a Fintoc, NO cobra.
 * =============================================================================
 * Lo devuelve la fábrica cuando el gate real NO está abierto
 * (`SUSCRIPCION_SANDBOX_MODE` != "false"). Genera un link ficticio y trazable
 * para poder probar el flujo backstage de punta a punta sin mover dinero — igual
 * que `StubPayoutAdapter`. El link `test` no lleva a ninguna pasarela real.
 */

import { randomBytes } from 'node:crypto';
import type { PuertoCheckoutSuscripcion, ResultadoLinkPago } from '../puerto-checkout';

export class StubCheckoutAdapter implements PuertoCheckoutSuscripcion {
  // El stub ignora los args (no cobra); implementar con menos parámetros es
  // válido para la interfaz y evita el warning de variable sin usar.
  async crearLinkPago(): Promise<ResultadoLinkPago> {
    const id = `plink_test_${randomBytes(8).toString('hex')}`;
    return {
      linkExternoId: id,
      // URL claramente de sandbox: nunca es una pasarela real de pago.
      url: `https://sandbox.fintoc.local/pagar/${id}`,
      modo: 'test',
    };
  }
}
