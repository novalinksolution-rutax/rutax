/**
 * Tests del normalizador puro del webhook de auto-cobro recurrente.
 * Sin I/O: verifica el mapeo de tipos de evento al evento del dominio, la
 * extracción defensiva de metadata (tenant/suscripcion/periodo) y el saneo de
 * motivos de error. Espejo de `checkout/normalizar-evento.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { normalizarEventoRecurrente } from './normalizar-evento-recurrente';

function evento(tipo: string, object: Record<string, unknown>, id = 'evt_123') {
  return { id, type: tipo, data: { object } };
}

describe('normalizarEventoRecurrente', () => {
  it('checkout_session.finished → mandato_activado, con ids de la metadata', () => {
    const r = normalizarEventoRecurrente(
      evento('checkout_session.finished', {
        id: 'cs_1',
        status: 'finished',
        subscription: 'sub_abc',
        metadata: { tenant_id: 'ten-1', suscripcion_id: 'susc-1' },
      }),
    );
    expect(r.tipo).toBe('mandato_activado');
    if (r.tipo === 'mandato_activado') {
      expect(r.mandatoExternoId).toBe('sub_abc');
      expect(r.tenantId).toBe('ten-1');
      expect(r.suscripcionId).toBe('susc-1');
    }
  });

  it('checkout_session.finished con estado fallido → mandato_fallido', () => {
    const r = normalizarEventoRecurrente(
      evento('checkout_session.finished', {
        id: 'cs_x',
        status: 'rejected',
        metadata: { tenant_id: 'ten-9', suscripcion_id: 'susc-9' },
      }),
    );
    expect(r.tipo).toBe('mandato_fallido');
    if (r.tipo === 'mandato_fallido') {
      // Sin subscription/payment_method → cae al id de la propia sesión.
      expect(r.mandatoExternoId).toBe('cs_x');
      expect(r.tenantId).toBe('ten-9');
    }
  });

  it('subscription.canceled → mandato_fallido (mandato caído, requiere re-vinculación)', () => {
    const r = normalizarEventoRecurrente(
      evento('subscription.canceled', { id: 'sub_z', metadata: { tenant_id: 'ten-z' } }),
    );
    expect(r.tipo).toBe('mandato_fallido');
    if (r.tipo === 'mandato_fallido') {
      expect(r.mandatoExternoId).toBe('sub_z');
      expect(r.tenantId).toBe('ten-z');
    }
  });

  it('payment_intent.succeeded → cobro_exitoso con periodo y monto', () => {
    const r = normalizarEventoRecurrente(
      evento('payment_intent.succeeded', {
        id: 'pi_1',
        amount: 99000,
        metadata: { periodo_id: 'per-1', tenant_id: 'ten-1' },
      }),
    );
    expect(r.tipo).toBe('cobro_exitoso');
    if (r.tipo === 'cobro_exitoso') {
      expect(r.cobroExternoId).toBe('pi_1');
      expect(r.periodoId).toBe('per-1');
      expect(r.tenantId).toBe('ten-1');
      expect(r.montoClp).toBe(99000);
    }
  });

  it('invoice.payment_succeeded → cobro_exitoso, lee payment_intent anidado', () => {
    const r = normalizarEventoRecurrente(
      evento('invoice.payment_succeeded', {
        id: 'inv_1',
        amount: 49000,
        payment_intent: { id: 'pi_anid', metadata: { periodo_id: 'per-anid' } },
      }),
    );
    expect(r.tipo).toBe('cobro_exitoso');
    if (r.tipo === 'cobro_exitoso') {
      expect(r.cobroExternoId).toBe('pi_anid');
      expect(r.periodoId).toBe('per-anid');
      expect(r.montoClp).toBe(49000);
    }
  });

  it('payment_intent.failed → cobro_fallido con motivo saneado', () => {
    const r = normalizarEventoRecurrente(
      evento('payment_intent.failed', {
        id: 'pi_f',
        metadata: { periodo_id: 'per-f' },
        error: { code: 'insufficient_funds', message: 'Fondos insuficientes' },
      }),
    );
    expect(r.tipo).toBe('cobro_fallido');
    if (r.tipo === 'cobro_fallido') {
      expect(r.cobroExternoId).toBe('pi_f');
      expect(r.periodoId).toBe('per-f');
      expect(r.motivoSaneado).toBe('[insufficient_funds] Fondos insuficientes');
    }
  });

  it('payment_intent.rejected → cobro_fallido; motivo por failure_reason plano', () => {
    const r = normalizarEventoRecurrente(
      evento('payment_intent.rejected', { id: 'pi_r', failure_reason: 'rejected_by_bank' }),
    );
    expect(r.tipo).toBe('cobro_fallido');
    if (r.tipo === 'cobro_fallido') {
      expect(r.motivoSaneado).toBe('rejected_by_bank');
    }
  });

  it('metadata ausente → ids en null, sigue clasificando el evento', () => {
    const r = normalizarEventoRecurrente(evento('payment_intent.succeeded', { id: 'pi_sin', amount: 1000 }));
    expect(r.tipo).toBe('cobro_exitoso');
    if (r.tipo === 'cobro_exitoso') {
      expect(r.periodoId).toBeNull();
      expect(r.tenantId).toBeNull();
    }
  });

  it('cobro exitoso sin amount → montoClp 0 (defensivo, no lanza)', () => {
    const r = normalizarEventoRecurrente(evento('payment_intent.succeeded', { id: 'pi_nm' }));
    expect(r.tipo).toBe('cobro_exitoso');
    if (r.tipo === 'cobro_exitoso') expect(r.montoClp).toBe(0);
  });

  it('tipo no relevante → ignorado (el webhook responde 200)', () => {
    const r = normalizarEventoRecurrente(evento('account.refreshed', {}));
    expect(r.tipo).toBe('ignorado');
    if (r.tipo === 'ignorado') expect(r.razon).toContain('account.refreshed');
  });

  it('payload sin type / no objeto → ignorado, nunca lanza', () => {
    expect(normalizarEventoRecurrente({ data: {} }).tipo).toBe('ignorado');
    expect(normalizarEventoRecurrente(null).tipo).toBe('ignorado');
    expect(normalizarEventoRecurrente('nope').tipo).toBe('ignorado');
  });

  it('el motivo saneado no filtra PII ni campos crudos inesperados', () => {
    const r = normalizarEventoRecurrente(
      evento('payment_intent.failed', {
        id: 'pi_pii',
        customer_email: 'privado@courier.cl',
        error: { code: 'card_declined' },
      }),
    );
    if (r.tipo === 'cobro_fallido') {
      expect(r.motivoSaneado ?? '').not.toContain('privado@courier.cl');
      expect(r.motivoSaneado).toBe('[card_declined]');
    }
  });
});
