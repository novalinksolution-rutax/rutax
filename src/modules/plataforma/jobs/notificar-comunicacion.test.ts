/**
 * Tests del job `plataforma/notificarComunicacion` (F3 · Gap 7).
 * =====================================================================
 * Mismo patrón que `integraciones/geocoding/jobs/geocodificar-pedido.test.ts`:
 * `createFunction(config, handler)` se mockea para capturar el handler real y
 * ejercitarlo con un `step.run` que ejecuta el callback directo (sin
 * durabilidad de Inngest).
 *
 * Los helpers de `@/modules/plataforma/notificaciones` (resolución de
 * destinatario, dedup, envío, contenido) se mockean directo — ya tienen sus
 * propias pruebas unitarias en `notificaciones.test.ts`; aquí solo se prueba
 * la orquestación del fan-out (dedup por tenant, conteos, no-bloqueo entre
 * tenants, idempotencia).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/inngest/cliente', () => ({
  inngest: {
    createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/modules/plataforma/notificaciones', () => ({
  resolverDestinatarioCourier: vi.fn(),
  yaSeNotifico: vi.fn(),
  registrarNotificacionEnviada: vi.fn().mockResolvedValue(undefined),
  enviarNotificacionEmail: vi.fn(),
  construirEmailComunicacion: vi.fn(() => ({ asunto: 'Asunto', html: '<p>x</p>', texto: 'x' })),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  resolverDestinatarioCourier,
  yaSeNotifico,
  registrarNotificacionEnviada,
  enviarNotificacionEmail,
  construirEmailComunicacion,
} from '@/modules/plataforma/notificaciones';
import { jobNotificarComunicacion } from './notificar-comunicacion';

const handler = (jobNotificarComunicacion as unknown as {
  handler: (ctx: {
    event: { data: Record<string, unknown> };
    step: { run: (label: string, fn: () => Promise<unknown>) => Promise<unknown> };
    logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  }) => Promise<Record<string, unknown>>;
}).handler;

const stepFalso = {
  run: <T>(_label: string, fn: () => Promise<T>): Promise<T> => fn(),
};
const loggerFalso = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function mockTenants(tenantIds: string[]) {
  const builder: Record<string, unknown> = {
    schema: vi.fn(() => builder),
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    neq: vi.fn(() => Promise.resolve({ data: tenantIds.map((id) => ({ id })), error: null })),
  };
  vi.mocked(crearClienteServiceRole).mockReturnValue(builder as unknown as ReturnType<typeof crearClienteServiceRole>);
  return builder;
}

const EVENTO_BASE = {
  comunicacionId: 'com-1',
  titulo: 'Mantención programada',
  cuerpo: 'El sábado habrá una ventana de mantención.',
  tipo: 'mantencion' as const,
  nivel: 'importante' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(construirEmailComunicacion).mockReturnValue({ asunto: 'Asunto', html: '<p>x</p>', texto: 'x' });
});

describe('jobNotificarComunicacion — fan-out a couriers', () => {
  it('sin tenants activos → no llama a ningún helper de notificación', async () => {
    mockTenants([]);

    const resultado = await handler({ event: { data: EVENTO_BASE }, step: stepFalso, logger: loggerFalso });

    expect(resultado).toMatchObject({ enviados: 0, deduplicados: 0, sinDestinatario: 0, errores: 0, totalTenants: 0 });
    expect(yaSeNotifico).not.toHaveBeenCalled();
  });

  it('envía a cada tenant activo no notificado antes, con dedup por (tenant, comunicación)', async () => {
    mockTenants(['tenant-a', 'tenant-b']);
    vi.mocked(yaSeNotifico).mockResolvedValue(false);
    vi.mocked(resolverDestinatarioCourier).mockImplementation(async (_c, tenantId) => ({
      email: `dueno@${tenantId}.cl`,
      nombreTenant: tenantId,
    }));
    vi.mocked(enviarNotificacionEmail).mockResolvedValue({ intentado: true, enviado: true, modo: 'stub' });

    const resultado = await handler({ event: { data: EVENTO_BASE }, step: stepFalso, logger: loggerFalso });

    expect(resultado).toMatchObject({ enviados: 2, deduplicados: 0, sinDestinatario: 0, errores: 0, totalTenants: 2 });
    expect(registrarNotificacionEnviada).toHaveBeenCalledTimes(2);
    expect(registrarNotificacionEnviada).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-a',
        accion: 'plataforma.notificacion_comunicacion',
        entidadTipo: 'comunicacion',
        entidadId: 'com-1',
      }),
    );
    expect(construirEmailComunicacion).toHaveBeenCalledWith(
      expect.objectContaining({ titulo: EVENTO_BASE.titulo, cuerpo: EVENTO_BASE.cuerpo }),
    );
  });

  it('tenant ya notificado antes (dedup) → NO reenvía ni vuelve a registrar bitácora', async () => {
    mockTenants(['tenant-a', 'tenant-b']);
    vi.mocked(yaSeNotifico).mockImplementation(async (_c, args) => args.tenantId === 'tenant-a');
    vi.mocked(resolverDestinatarioCourier).mockResolvedValue({ email: 'dueno@tenant-b.cl', nombreTenant: 'tenant-b' });
    vi.mocked(enviarNotificacionEmail).mockResolvedValue({ intentado: true, enviado: true, modo: 'stub' });

    const resultado = await handler({ event: { data: EVENTO_BASE }, step: stepFalso, logger: loggerFalso });

    expect(resultado).toMatchObject({ enviados: 1, deduplicados: 1, sinDestinatario: 0, errores: 0 });
    expect(registrarNotificacionEnviada).toHaveBeenCalledTimes(1);
    expect(resolverDestinatarioCourier).toHaveBeenCalledTimes(1);
  });

  it('courier sin usuario interno resoluble → cuenta como sin_destinatario, no lanza', async () => {
    mockTenants(['tenant-a']);
    vi.mocked(yaSeNotifico).mockResolvedValue(false);
    vi.mocked(resolverDestinatarioCourier).mockResolvedValue({ email: null, nombreTenant: 'tenant-a' });
    vi.mocked(enviarNotificacionEmail).mockResolvedValue({ intentado: false, enviado: false, modo: 'sin_destinatario' });

    const resultado = await handler({ event: { data: EVENTO_BASE }, step: stepFalso, logger: loggerFalso });

    expect(resultado).toMatchObject({ enviados: 0, deduplicados: 0, sinDestinatario: 1, errores: 0 });
    // El dedup se marca igual (evita reintentar por siempre a un courier sin destinatario).
    expect(registrarNotificacionEnviada).toHaveBeenCalledTimes(1);
  });

  it('un envío real fallido para un tenant NO bloquea a los demás; el job termina en error', async () => {
    mockTenants(['tenant-a', 'tenant-b']);
    vi.mocked(yaSeNotifico).mockResolvedValue(false);
    vi.mocked(resolverDestinatarioCourier).mockImplementation(async (_c, tenantId) => ({
      email: `dueno@${tenantId}.cl`,
      nombreTenant: tenantId,
    }));
    vi.mocked(enviarNotificacionEmail).mockImplementation(async ({ para }) =>
      para === 'dueno@tenant-a.cl'
        ? { intentado: true, enviado: false, modo: 'real', errorDescripcion: 'rechazado por el proveedor' }
        : { intentado: true, enviado: true, modo: 'real' },
    );

    await expect(handler({ event: { data: EVENTO_BASE }, step: stepFalso, logger: loggerFalso })).rejects.toThrow(
      /1 error/i,
    );

    // El tenant sano SÍ se procesó pese al error del otro (Promise.allSettled).
    expect(registrarNotificacionEnviada).toHaveBeenCalledTimes(2);
  });
});
