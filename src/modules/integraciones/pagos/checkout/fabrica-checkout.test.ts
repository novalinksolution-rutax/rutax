/**
 * Tests del gate sandbox/real de la fábrica de checkout (item 2).
 * Verifica la semántica de seguridad-por-defecto (molde payout/DTE): sin la
 * bandera en "false" o sin secret key → stub (NO cobra).
 */

import { describe, it, expect } from 'vitest';
import { obtenerPuertoCheckout } from './fabrica-checkout';
import { StubCheckoutAdapter } from './adaptadores/stub';
import { FintocCheckoutAdapter } from './adaptadores/fintoc';

describe('obtenerPuertoCheckout — gate sandbox/real', () => {
  it('sandbox (default) → StubCheckoutAdapter aunque haya secret key', () => {
    const puerto = obtenerPuertoCheckout({ secretKeyOrg: 'sk_test_123' });
    expect(puerto).toBeInstanceOf(StubCheckoutAdapter);
  });

  it('sin secret key → StubCheckoutAdapter aunque se pida real por env', () => {
    const puerto = obtenerPuertoCheckout({ secretKeyOrg: null });
    expect(puerto).toBeInstanceOf(StubCheckoutAdapter);
  });

  it('forzarReal + secret key → FintocCheckoutAdapter', () => {
    const puerto = obtenerPuertoCheckout({ forzarReal: true, secretKeyOrg: 'sk_live_123' });
    expect(puerto).toBeInstanceOf(FintocCheckoutAdapter);
  });

  it('el stub genera un link de test que NO es una pasarela real', async () => {
    const puerto = obtenerPuertoCheckout({ secretKeyOrg: null });
    const link = await puerto.crearLinkPago({
      montoClp: 99000,
      descripcion: 'Suscripción test',
      metadata: { periodo_id: 'per-1' },
    });
    expect(link.modo).toBe('test');
    expect(link.linkExternoId).toMatch(/^plink_test_/);
    expect(link.url).toContain('sandbox');
  });
});
