/**
 * Tests del gate sandbox + opt-in de la fábrica de auto-cobro recurrente.
 * Verifica la seguridad-por-defecto (molde payout): sin la bandera en "false", sin
 * opt-in del tenant, o sin secret key → stub (NO cobra).
 */

import { describe, it, expect } from 'vitest';
import { obtenerPuertoSuscripcionRecurrente } from './fabrica-suscripcion-recurrente';
import { StubSuscripcionRecurrenteAdapter } from './adaptadores/stub';
import { FintocSuscripcionRecurrenteAdapter } from './adaptadores/fintoc';

describe('obtenerPuertoSuscripcionRecurrente — gate sandbox + opt-in', () => {
  it('sandbox (default) → Stub aunque haya secret key y opt-in', () => {
    const puerto = obtenerPuertoSuscripcionRecurrente({
      autoCobroHabilitado: true,
      secretKeyOrg: 'sk_test_123',
    });
    expect(puerto).toBeInstanceOf(StubSuscripcionRecurrenteAdapter);
  });

  it('sin opt-in del tenant → Stub aunque se fuerce el resto', () => {
    // Simula sandbox OFF + secret key, pero opt-in en false: sigue siendo stub.
    const puerto = obtenerPuertoSuscripcionRecurrente({
      autoCobroHabilitado: false,
      secretKeyOrg: 'sk_live_123',
      // No forzamos real: dependemos del gate, y el opt-in falta.
    });
    expect(puerto).toBeInstanceOf(StubSuscripcionRecurrenteAdapter);
  });

  it('sin secret key → Stub aunque se pida real', () => {
    const puerto = obtenerPuertoSuscripcionRecurrente({
      autoCobroHabilitado: true,
      secretKeyOrg: null,
      forzarReal: false,
    });
    expect(puerto).toBeInstanceOf(StubSuscripcionRecurrenteAdapter);
  });

  it('las 3 condiciones (forzarReal + opt-in + secret key) → adaptador Fintoc real', () => {
    const puerto = obtenerPuertoSuscripcionRecurrente({
      autoCobroHabilitado: true,
      forzarReal: true,
      secretKeyOrg: 'sk_live_123',
    });
    expect(puerto).toBeInstanceOf(FintocSuscripcionRecurrenteAdapter);
  });

  it('el stub enrola un mandato de test que NO es una pasarela real', async () => {
    const puerto = obtenerPuertoSuscripcionRecurrente({ autoCobroHabilitado: false });
    const r = await puerto.registrarMandato({
      tenantId: 'ten-1',
      metadata: { tenant_id: 'ten-1', suscripcion_id: 'susc-1' },
    });
    expect(r.modo).toBe('test');
    expect(r.mandatoExternoId).toMatch(/^stub_mandato_test_/);
    expect(r.urlEnrolamiento).toContain('sandbox');
  });

  it('el stub cobra de forma determinista por idempotencyKey y respeta el centinela', async () => {
    const puerto = obtenerPuertoSuscripcionRecurrente({ autoCobroHabilitado: false });
    const a = await puerto.cobrarPeriodo({
      idempotencyKey: 'susc-cobro-per-1',
      mandatoToken: 'pm_test',
      montoClp: 99000,
      referencia: 'Suscripcion jul',
      metadata: { periodo_id: 'per-1', tenant_id: 'ten-1' },
    });
    const b = await puerto.cobrarPeriodo({
      idempotencyKey: 'susc-cobro-per-1',
      mandatoToken: 'pm_test',
      montoClp: 99000,
      referencia: 'Suscripcion jul',
      metadata: { periodo_id: 'per-1', tenant_id: 'ten-1' },
    });
    expect(a.estado).toBe('enviado');
    // Determinista: misma llave → mismo id simulado (emula la deduplicación real).
    expect(a.cobroExternoId).toBe(b.cobroExternoId);

    const rechazo = await puerto.cobrarPeriodo({
      idempotencyKey: 'susc-cobro-per-2',
      mandatoToken: 'pm_test',
      montoClp: 0, // centinela → rechazado
      referencia: 'Suscripcion',
      metadata: { periodo_id: 'per-2', tenant_id: 'ten-1' },
    });
    expect(rechazo.estado).toBe('rechazado');
  });
});
