/**
 * Tests del normalizador puro del webhook de cobro de suscripción (item 2).
 * Sin I/O: verifica el mapeo de tipos de evento a estado y la extracción
 * defensiva del período (metadata) y del id del payment link.
 */

import { describe, it, expect } from 'vitest';
import { normalizarEventoPagoSuscripcion } from './normalizar-evento';

function evento(tipo: string, object: Record<string, unknown>, id = 'evt_123') {
  return { id, type: tipo, data: { object } };
}

describe('normalizarEventoPagoSuscripcion', () => {
  it('checkout_session.finished → pagado, con período de la metadata', () => {
    const r = normalizarEventoPagoSuscripcion(
      evento('checkout_session.finished', {
        amount: 99000,
        payment_link: 'plink_abc',
        metadata: { periodo_id: 'per-1', tenant_id: 'ten-1' },
      }),
    );
    expect(r).not.toBeNull();
    expect(r!.estado).toBe('pagado');
    expect(r!.periodoId).toBe('per-1');
    expect(r!.linkExternoId).toBe('plink_abc');
    expect(r!.montoClp).toBe(99000);
    expect(r!.eventoExternoId).toBe('evt_123');
  });

  it('payment_intent.succeeded → pagado', () => {
    const r = normalizarEventoPagoSuscripcion(
      evento('payment_intent.succeeded', { metadata: { periodo_id: 'per-2' } }),
    );
    expect(r!.estado).toBe('pagado');
    expect(r!.periodoId).toBe('per-2');
  });

  it('payment_intent.failed / .rejected → fallido', () => {
    expect(normalizarEventoPagoSuscripcion(evento('payment_intent.failed', {}))!.estado).toBe('fallido');
    expect(normalizarEventoPagoSuscripcion(evento('payment_intent.rejected', {}))!.estado).toBe('fallido');
  });

  it('expiraciones → expirado', () => {
    expect(normalizarEventoPagoSuscripcion(evento('payment_intent.expired', {}))!.estado).toBe('expirado');
    expect(normalizarEventoPagoSuscripcion(evento('checkout_session.expired', {}))!.estado).toBe('expirado');
  });

  it('extrae el id del link cuando viene como objeto {id}', () => {
    const r = normalizarEventoPagoSuscripcion(
      evento('checkout_session.finished', { payment_link: { id: 'plink_obj' } }),
    );
    expect(r!.linkExternoId).toBe('plink_obj');
  });

  it('lee metadata.periodo_id anidada en el payment_link', () => {
    const r = normalizarEventoPagoSuscripcion(
      evento('checkout_session.finished', {
        payment_link: { id: 'plink_x', metadata: { periodo_id: 'per-anidado' } },
      }),
    );
    expect(r!.periodoId).toBe('per-anidado');
  });

  it('tipo de evento no relevante → null (el webhook lo ignora con 200)', () => {
    expect(normalizarEventoPagoSuscripcion(evento('account.refreshed', {}))).toBeNull();
  });

  it('payload sin type/id → null', () => {
    expect(normalizarEventoPagoSuscripcion({ data: {} })).toBeNull();
    expect(normalizarEventoPagoSuscripcion(null)).toBeNull();
    expect(normalizarEventoPagoSuscripcion('nope')).toBeNull();
  });

  it('el payload sanitizado no filtra PII: solo metadatos de negocio', () => {
    const r = normalizarEventoPagoSuscripcion(
      evento('checkout_session.finished', {
        amount: 49000,
        payment_link: 'plink_s',
        customer_email: 'privado@courier.cl',
        metadata: { periodo_id: 'per-s' },
      }),
    );
    const claves = Object.keys(r!.payloadSanitizado);
    expect(claves).not.toContain('customer_email');
    expect(JSON.stringify(r!.payloadSanitizado)).not.toContain('privado@courier.cl');
  });
});
