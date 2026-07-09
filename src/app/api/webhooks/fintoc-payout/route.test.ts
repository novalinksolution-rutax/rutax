/**
 * Pruebas de POST /api/webhooks/fintoc-payout (F19/Fase 3).
 *
 * Cubre:
 * 1. Rate limit excedido → 429.
 * 2. Header `Fintoc-Signature` ausente → 401.
 * 3. Secreto de organización no configurado → 401 (fail-closed).
 * 4. Firma inválida → 401 + alerta a observabilidad.
 * 5. Body malformado (tras firma válida) → 400.
 * 6. Evento no reconocible (`normalizarEventoWebhookPayoutFintoc` → null) → 200 ignorado.
 * 7. Transfer sin payout conocido → 200 + alerta ("transfer sin payout").
 * 8. IDEMPOTENCIA DEL INSERT DUPLICADO: conflicto 23505 en
 *    `eventos_payout_externos` → 200 "ya_procesado", SIN re-emitir el evento Inngest.
 * 9. Happy path: bitácora ANTES de emitir el evento, `id` determinístico
 *    `payout-webhook-<eventoExternoId>`, 200 final.
 *
 * Mocks: rate-limit, service-role, bitácora, observabilidad, el adaptador de
 * pagos (firma/normalización — ya probado exhaustivamente en la Fase 2) e
 * Inngest. Sin red real ni Supabase real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  consumirRateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/observabilidad', () => ({
  capturarMensaje: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/integraciones/pagos', () => ({
  validarFirmaWebhookPayout: vi.fn(),
  normalizarEventoWebhookPayoutFintoc: vi.fn(),
}));

vi.mock('@/lib/inngest/cliente', () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

import { consumirRateLimit } from '@/lib/rate-limit';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { capturarMensaje } from '@/lib/observabilidad';
import {
  validarFirmaWebhookPayout,
  normalizarEventoWebhookPayoutFintoc,
} from '@/modules/integraciones/pagos';
import { inngest } from '@/lib/inngest/cliente';
import { POST } from './route';
import type { NextRequest } from 'next/server';

const TENANT_ID = 'tenant-A';
const PAYOUT_ID = 'payout-001';
const LIQUIDACION_ID = 'liq-001';
const TRANSFER_ID = 'tr_abc123';
const EVENTO_ID = 'evt_abc123';

function crearRequest(cuerpo: string, headers: Record<string, string> = {}): NextRequest {
  const mapaHeaders = new Map(Object.entries(headers));
  return {
    text: () => Promise.resolve(cuerpo),
    headers: {
      get: (nombre: string) => mapaHeaders.get(nombre) ?? null,
    },
  } as unknown as NextRequest;
}

function eventoNormalizadoBase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    eventoExternoId: EVENTO_ID,
    transferExternoId: TRANSFER_ID,
    estadoExterno: 'confirmado' as const,
    motivo: null,
    comprobanteRef: null,
    payloadSanitizado: { eventoExternoId: EVENTO_ID, transferExternoId: TRANSFER_ID, status: 'succeeded' },
    ...overrides,
  };
}

/** Mock mínimo de Supabase: solo lo que usa la ruta (buscar payout + insertar evento). */
function crearMockSupabase(opts: {
  payoutEncontrado?: { id: string; tenant_id: string; liquidacion_id: string } | null;
  erroreBuscarPayout?: { message: string } | null;
  errorInsert?: { code?: string; message: string } | null;
}) {
  const insertMock = vi.fn().mockResolvedValue({ error: opts.errorInsert ?? null });
  const maybeSingleMock = vi.fn().mockResolvedValue({
    data: opts.payoutEncontrado ?? null,
    error: opts.erroreBuscarPayout ?? null,
  });

  const from = vi.fn((tabla: string) => {
    if (tabla === 'payouts_conductor') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock }),
        }),
      };
    }
    if (tabla === 'eventos_payout_externos') {
      return { insert: insertMock };
    }
    throw new Error(`tabla no mockeada: ${tabla}`);
  });

  return { schema: vi.fn().mockReturnValue({ from }), _insertMock: insertMock, _from: from };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(consumirRateLimit).mockResolvedValue({ permitido: true, restante: 59, reintentarEnSegundos: 0 });
  vi.mocked(validarFirmaWebhookPayout).mockReturnValue(true);
  process.env.FINTOC_PAYOUT_WEBHOOK_SECRET = 'org-secret-test';
});

afterEach(() => {
  delete process.env.FINTOC_PAYOUT_WEBHOOK_SECRET;
});

// =============================================================================
// 1. Rate limit
// =============================================================================

describe('POST /api/webhooks/fintoc-payout — rate limit', () => {
  it('429 si el rate limit está excedido, sin tocar Supabase', async () => {
    vi.mocked(consumirRateLimit).mockResolvedValue({ permitido: false, restante: 0, reintentarEnSegundos: 30 });

    const respuesta = await POST(crearRequest('{}', { 'Fintoc-Signature': 't=1,v1=abc' }));

    expect(respuesta.status).toBe(429);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 2. Firma ausente
// =============================================================================

describe('POST /api/webhooks/fintoc-payout — firma ausente', () => {
  it('401 si no viene el header Fintoc-Signature', async () => {
    const respuesta = await POST(crearRequest('{}'));

    expect(respuesta.status).toBe(401);
    const body = await respuesta.json();
    expect(body.error).toBe('firma_ausente');
    expect(validarFirmaWebhookPayout).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 3. Secreto no configurado — fail-closed
// =============================================================================

describe('POST /api/webhooks/fintoc-payout — secreto de organización ausente', () => {
  it('401 fail-closed si FINTOC_PAYOUT_WEBHOOK_SECRET no está configurado', async () => {
    delete process.env.FINTOC_PAYOUT_WEBHOOK_SECRET;

    const respuesta = await POST(crearRequest('{}', { 'Fintoc-Signature': 't=1,v1=abc' }));

    expect(respuesta.status).toBe(401);
    const body = await respuesta.json();
    expect(body.error).toBe('webhook_no_configurado');
    expect(capturarMensaje).toHaveBeenCalledWith(
      expect.stringContaining('FINTOC_PAYOUT_WEBHOOK_SECRET'),
      'error',
      expect.anything(),
    );
  });
});

// =============================================================================
// 4. Firma inválida
// =============================================================================

describe('POST /api/webhooks/fintoc-payout — firma inválida', () => {
  it('401 + alerta si la firma no calza (o está fuera de tolerancia anti-replay)', async () => {
    vi.mocked(validarFirmaWebhookPayout).mockReturnValue(false);

    const respuesta = await POST(crearRequest('{"type":"transfer.outbound.succeeded"}', {
      'Fintoc-Signature': 't=1,v1=firma-mala',
    }));

    expect(respuesta.status).toBe(401);
    const body = await respuesta.json();
    expect(body.error).toBe('firma_invalida');
    expect(capturarMensaje).toHaveBeenCalledWith(
      expect.stringContaining('firma inválida'),
      'warning',
      expect.anything(),
    );
    expect(normalizarEventoWebhookPayoutFintoc).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 5. Body malformado
// =============================================================================

describe('POST /api/webhooks/fintoc-payout — body malformado', () => {
  it('400 si el JSON no parsea (tras validar la firma)', async () => {
    const respuesta = await POST(crearRequest('{ esto no es json', { 'Fintoc-Signature': 't=1,v1=abc' }));

    expect(respuesta.status).toBe(400);
    const body = await respuesta.json();
    expect(body.error).toBe('body_malformado');
  });
});

// =============================================================================
// 6. Evento no reconocible → 200 ignorado
// =============================================================================

describe('POST /api/webhooks/fintoc-payout — evento no reconocible', () => {
  it('200 ignorado si normalizarEventoWebhookPayoutFintoc devuelve null', async () => {
    vi.mocked(normalizarEventoWebhookPayoutFintoc).mockReturnValue(null);

    const respuesta = await POST(crearRequest('{"type":"link.updated"}', { 'Fintoc-Signature': 't=1,v1=abc' }));

    expect(respuesta.status).toBe(200);
    const body = await respuesta.json();
    expect(body.ignorado).toBe(true);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 7. Transfer sin payout conocido
// =============================================================================

describe('POST /api/webhooks/fintoc-payout — transfer sin payout', () => {
  it('200 + alerta si el transfer no corresponde a ningún payout', async () => {
    vi.mocked(normalizarEventoWebhookPayoutFintoc).mockReturnValue(eventoNormalizadoBase());
    const mockSupabase = crearMockSupabase({ payoutEncontrado: null });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    const respuesta = await POST(crearRequest('{"type":"transfer.outbound.succeeded"}', {
      'Fintoc-Signature': 't=1,v1=abc',
    }));

    expect(respuesta.status).toBe(200);
    const body = await respuesta.json();
    expect(body.sin_payout).toBe(true);
    expect(capturarMensaje).toHaveBeenCalledWith(
      expect.stringContaining('no corresponde a ningún payout'),
      'warning',
      expect.anything(),
    );
    expect(inngest.send).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 8. IDEMPOTENCIA DEL INSERT DUPLICADO (23505)
// =============================================================================

describe('POST /api/webhooks/fintoc-payout — idempotencia del insert duplicado', () => {
  it('200 "ya_procesado" ante 23505, sin re-emitir el evento Inngest ni re-registrar bitácora', async () => {
    vi.mocked(normalizarEventoWebhookPayoutFintoc).mockReturnValue(eventoNormalizadoBase());
    const mockSupabase = crearMockSupabase({
      payoutEncontrado: { id: PAYOUT_ID, tenant_id: TENANT_ID, liquidacion_id: LIQUIDACION_ID },
      errorInsert: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    const respuesta = await POST(crearRequest('{"type":"transfer.outbound.succeeded"}', {
      'Fintoc-Signature': 't=1,v1=abc',
    }));

    expect(respuesta.status).toBe(200);
    const body = await respuesta.json();
    expect(body.ya_procesado).toBe(true);

    // NO se emitió el evento Inngest — el procesamiento ya había ocurrido.
    expect(inngest.send).not.toHaveBeenCalled();
    // NO se registró una bitácora nueva para un evento ya procesado.
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 9. Happy path
// =============================================================================

describe('POST /api/webhooks/fintoc-payout — happy path', () => {
  it('bitácora ANTES de emitir el evento, id determinístico, 200 final', async () => {
    vi.mocked(normalizarEventoWebhookPayoutFintoc).mockReturnValue(eventoNormalizadoBase());
    const mockSupabase = crearMockSupabase({
      payoutEncontrado: { id: PAYOUT_ID, tenant_id: TENANT_ID, liquidacion_id: LIQUIDACION_ID },
      errorInsert: null,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(mockSupabase as never);

    const ordenLlamadas: string[] = [];
    vi.mocked(registrarEnBitacora).mockImplementation(async () => {
      ordenLlamadas.push('bitacora');
    });
    vi.mocked(inngest.send).mockImplementation(async () => {
      ordenLlamadas.push('evento');
      return undefined as never;
    });

    const respuesta = await POST(crearRequest('{"type":"transfer.outbound.succeeded"}', {
      'Fintoc-Signature': 't=1,v1=abc',
    }));

    expect(respuesta.status).toBe(200);
    const body = await respuesta.json();
    expect(body.ok).toBe(true);

    // Bitácora ANTES del evento Inngest — invariante RNF-04.
    expect(ordenLlamadas).toEqual(['bitacora', 'evento']);

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUsuarioId: null,
        actorTipo: 'sistema',
        accion: 'dinero.payout_webhook_recibido',
        entidadId: LIQUIDACION_ID,
      }),
    );

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'dinero/payout.actualizacion-externa',
        id: `payout-webhook-${EVENTO_ID}`,
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          payoutId: PAYOUT_ID,
          liquidacionId: LIQUIDACION_ID,
          transferExternoId: TRANSFER_ID,
          eventoExternoId: EVENTO_ID,
          estadoExterno: 'confirmado',
        }),
      }),
    );
  });
});
