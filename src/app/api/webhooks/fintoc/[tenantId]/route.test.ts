/**
 * Pruebas de POST /api/webhooks/fintoc/:tenantId — cobranza courier→seller (flujo 1).
 * =============================================================================
 *
 * Este era el ÚNICO webhook de Fintoc sin pruebas de ruta (payout y suscripción
 * sí las tenían), y es el del diferenciador del producto.
 *
 * DIFERENCIA DELIBERADA con `fintoc-payout/route.test.ts`: ese test MOCKEA la
 * validación de firma y la normalización. Aquí NO se mockean — se ejerce la
 * cadena real (HMAC real → `FintocAdapter` real → ruta real) con el payload de
 * la forma REAL de `transfer.inbound.succeeded`. Así la prueba cubre justo lo que
 * quedaba pendiente de validar del flujo 1: que un evento firmado como lo firma
 * Fintoc, con la forma que Fintoc manda, atraviesa la ruta y llega al job con el
 * RUT de la contraparte poblado.
 *
 * Solo se mockean las fronteras de infraestructura: rate limit, Supabase,
 * bitácora, Inngest y la resolución del secreto por-tenant (que descifra contra
 * BD). La matemática de la firma queda además anclada al vector oficial de Fintoc
 * en `src/modules/integraciones/pagos/vector-oficial-fintoc.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('@/lib/rate-limit', () => ({
  consumirRateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/inngest/cliente', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

// Mock PARCIAL: se sustituye solo la resolución del secreto (toca BD y cripto de
// secretos). `crearPuertoConciliacionPagos` y el adaptador quedan REALES.
vi.mock('@/modules/integraciones/pagos', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/integraciones/pagos')>();
  return { ...real, resolverSecretoWebhookTenant: vi.fn() };
});

import { consumirRateLimit } from '@/lib/rate-limit';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { inngest } from '@/lib/inngest/cliente';
import { resolverSecretoWebhookTenant } from '@/modules/integraciones/pagos';
import { POST } from './route';
import type { NextRequest } from 'next/server';

const TENANT_ID = '11111111-2222-3333-4444-555555555555';
const SECRETO_WEBHOOK = 'whsec_tenant_despachos_centro';
const LINK_TOKEN_REF = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/**
 * Firma como firma Fintoc: HMAC-SHA256 hex sobre `"<ts>.<raw_body>"`, header
 * `t=<ts>,v1=<hex>`. Esquema anclado al vector oficial del SDK en
 * `vector-oficial-fintoc.test.ts`.
 */
function firmarComoFintoc(cuerpoCrudo: string, secreto: string, tsSeg?: number): string {
  const ts = tsSeg ?? Math.floor(Date.now() / 1000);
  const firma = createHmac('sha256', secreto).update(`${ts}.${cuerpoCrudo}`, 'utf8').digest('hex');
  return `t=${ts},v1=${firma}`;
}

function crearRequest(cuerpo: string, headers: Record<string, string> = {}): NextRequest {
  const mapa = new Map(Object.entries(headers));
  return {
    text: () => Promise.resolve(cuerpo),
    headers: { get: (n: string) => mapa.get(n) ?? null },
  } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ tenantId: TENANT_ID }) };

/** Envelope + objeto `Transfer` con los nombres de campo REALES de Fintoc. */
function eventoTransferenciaEntrante(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'evt_2AaZeLCz0GjOW5zj',
    type: 'transfer.inbound.succeeded',
    mode: 'live',
    object: 'event',
    data: {
      id: 'tr_9xKpQn2SGXRhXTKr',
      object: 'transfer',
      direction: 'inbound',
      status: 'succeeded',
      amount: 238000,
      currency: 'CLP',
      post_date: '2026-09-20T14:03:05.000Z',
      comment: 'PAGO FACTURA 1042',
      counterparty: {
        holder_id: '74.593.127-8',
        holder_name: 'Falabella Tech SpA',
        account_number: '998877665544',
      },
      ...overrides,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // La ruta construye el puerto vía la fábrica, que exige la secret key de ORG
  // aunque validar una firma no la necesite. Sin ella la ruta lanzaría.
  process.env.FINTOC_SECRET_KEY = 'sk_test_para_pruebas';

  vi.mocked(consumirRateLimit).mockResolvedValue({
    permitido: true,
    reintentarEnSegundos: 0,
  } as Awaited<ReturnType<typeof consumirRateLimit>>);

  vi.mocked(resolverSecretoWebhookTenant).mockResolvedValue(SECRETO_WEBHOOK);

  vi.mocked(crearClienteServiceRole).mockReturnValue({
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { link_token_ref: LINK_TOKEN_REF } }),
          }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof crearClienteServiceRole>);
});

describe('POST /api/webhooks/fintoc/:tenantId — firma y forma reales', () => {
  it('ACEPTA un transfer.inbound.succeeded firmado y lo emite con el RUT poblado', async () => {
    const cuerpo = eventoTransferenciaEntrante();
    const respuesta = await POST(
      crearRequest(cuerpo, { 'Fintoc-Signature': firmarComoFintoc(cuerpo, SECRETO_WEBHOOK) }),
      params,
    );

    expect(respuesta.status).toBe(200);
    expect(inngest.send).toHaveBeenCalledTimes(1);

    const evento = vi.mocked(inngest.send).mock.calls[0][0] as {
      name: string;
      id: string;
      data: Record<string, unknown>;
    };
    expect(evento.name).toBe('dinero/pago.recibido');
    // Lo que de verdad importa: el RUT llega al job. Con el mapeo anterior
    // (que solo leía `sender_account`) esto era `null` y el pago caía a
    // `sin_atribuir` — la conciliación automática no habría funcionado nunca.
    expect(evento.data.contraparteRutNormalizado).toBe('745931278');
    expect(evento.data.contraparteNombre).toBe('Falabella Tech SpA');
    expect(evento.data.montoClp).toBe(238000);
    expect(evento.data.movimientoExternoId).toBe('tr_9xKpQn2SGXRhXTKr');
    expect(evento.data.tenantId).toBe(TENANT_ID);
    // Idempotencia de Inngest: reentrega del webhook no re-procesa.
    expect(evento.id).toBe(`pago-recibido-${TENANT_ID}-tr_9xKpQn2SGXRhXTKr`);
  });

  it('registra la BITÁCORA ANTES de emitir el evento', async () => {
    const cuerpo = eventoTransferenciaEntrante();
    await POST(
      crearRequest(cuerpo, { 'Fintoc-Signature': firmarComoFintoc(cuerpo, SECRETO_WEBHOOK) }),
      params,
    );

    expect(registrarEnBitacora).toHaveBeenCalledTimes(1);
    const ordenBitacora = vi.mocked(registrarEnBitacora).mock.invocationCallOrder[0];
    const ordenSend = vi.mocked(inngest.send).mock.invocationCallOrder[0];
    expect(ordenBitacora).toBeLessThan(ordenSend);

    // El detalle no lleva RUT ni nombre (dato personal) — solo el booleano.
    const detalle = vi.mocked(registrarEnBitacora).mock.calls[0][1].detalle as Record<
      string,
      unknown
    >;
    expect(detalle.tiene_rut_contraparte).toBe(true);
    expect(JSON.stringify(detalle)).not.toContain('745931278');
    expect(JSON.stringify(detalle)).not.toContain('Falabella');
  });

  it('rechaza con 401 una firma calculada con OTRO secreto, sin efectos', async () => {
    const cuerpo = eventoTransferenciaEntrante();
    const respuesta = await POST(
      crearRequest(cuerpo, { 'Fintoc-Signature': firmarComoFintoc(cuerpo, 'whsec_del_atacante') }),
      params,
    );

    expect(respuesta.status).toBe(401);
    expect(inngest.send).not.toHaveBeenCalled();
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it('rechaza con 401 un cuerpo alterado tras firmar (tampering del monto)', async () => {
    const cuerpo = eventoTransferenciaEntrante();
    const firma = firmarComoFintoc(cuerpo, SECRETO_WEBHOOK);
    const alterado = cuerpo.replace('238000', '999999');

    const respuesta = await POST(crearRequest(alterado, { 'Fintoc-Signature': firma }), params);

    expect(respuesta.status).toBe(401);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('rechaza con 401 un replay fuera de la ventana anti-replay', async () => {
    const cuerpo = eventoTransferenciaEntrante();
    const tsViejo = Math.floor(Date.now() / 1000) - 3600;
    const respuesta = await POST(
      crearRequest(cuerpo, { 'Fintoc-Signature': firmarComoFintoc(cuerpo, SECRETO_WEBHOOK, tsViejo) }),
      params,
    );

    expect(respuesta.status).toBe(401);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('rechaza con 401 si falta el header de firma, sin tocar el secreto', async () => {
    const respuesta = await POST(crearRequest(eventoTransferenciaEntrante()), params);

    expect(respuesta.status).toBe(401);
    expect(resolverSecretoWebhookTenant).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('ignora con 200 una transferencia SALIENTE firmada (no es un cobro)', async () => {
    // `direction: 'outbound'` con monto positivo: fiarse del signo la habría
    // tratado como un pago entrante del seller.
    const cuerpo = eventoTransferenciaEntrante({ direction: 'outbound' });
    const respuesta = await POST(
      crearRequest(cuerpo, { 'Fintoc-Signature': firmarComoFintoc(cuerpo, SECRETO_WEBHOOK) }),
      params,
    );

    expect(respuesta.status).toBe(200);
    await expect(respuesta.json()).resolves.toMatchObject({ no_entrante: true });
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('ignora con 200 otro tipo de evento firmado (no reintentar)', async () => {
    const cuerpo = JSON.stringify({
      id: 'evt_x',
      type: 'account.refresh_intent.succeeded',
      data: { id: 'ri_1' },
    });
    const respuesta = await POST(
      crearRequest(cuerpo, { 'Fintoc-Signature': firmarComoFintoc(cuerpo, SECRETO_WEBHOOK) }),
      params,
    );

    expect(respuesta.status).toBe(200);
    await expect(respuesta.json()).resolves.toMatchObject({
      ignorado: 'account.refresh_intent.succeeded',
    });
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('devuelve 404 para un tenantId que no es UUID, sin consumir rate limit', async () => {
    const respuesta = await POST(crearRequest('{}'), {
      params: Promise.resolve({ tenantId: 'no-es-uuid' }),
    });

    expect(respuesta.status).toBe(404);
    expect(consumirRateLimit).not.toHaveBeenCalled();
  });

  it('devuelve 429 con Retry-After cuando el rate limit se excede, antes de tocar el secreto', async () => {
    vi.mocked(consumirRateLimit).mockResolvedValue({
      permitido: false,
      reintentarEnSegundos: 42,
    } as Awaited<ReturnType<typeof consumirRateLimit>>);

    const respuesta = await POST(crearRequest(eventoTransferenciaEntrante()), params);

    expect(respuesta.status).toBe(429);
    expect(respuesta.headers.get('Retry-After')).toBe('42');
    // Un flood no paga cripto ni acceso a secretos.
    expect(resolverSecretoWebhookTenant).not.toHaveBeenCalled();
  });
});
