import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { obtenerPuertoEmail, emailSandboxActivo } from './fabrica-email';
import { StubEmailAdapter } from './adaptadores/stub';
import { ResendEmailAdapter } from './adaptadores/resend';

const ENV_ORIGINAL = { ...process.env };

/** Abre el gate real y devuelve el body JSON del único envío que hace el puerto. */
async function capturarBodyDeUnEnvio(): Promise<Record<string, unknown>> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'resend_msg_123' }),
  });
  vi.stubGlobal('fetch', fetchMock);

  await obtenerPuertoEmail().enviarEmail({
    para: 'dueno@courier.cl',
    asunto: 'Prueba',
    html: '<p>Prueba</p>',
  });

  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('fabrica-email — gate sandbox/real', () => {
  beforeEach(() => {
    delete process.env.EMAIL_SANDBOX_MODE;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_REPLY_TO;
  });

  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sin EMAIL_SANDBOX_MODE (ausente) → sandbox activo, devuelve el stub', () => {
    expect(emailSandboxActivo()).toBe(true);
    expect(obtenerPuertoEmail()).toBeInstanceOf(StubEmailAdapter);
  });

  it('EMAIL_SANDBOX_MODE=false pero SIN RESEND_API_KEY → sigue en stub (gate incompleto)', () => {
    process.env.EMAIL_SANDBOX_MODE = 'false';
    expect(obtenerPuertoEmail()).toBeInstanceOf(StubEmailAdapter);
  });

  it('RESEND_API_KEY presente pero EMAIL_SANDBOX_MODE ausente/true → sigue en stub', () => {
    process.env.RESEND_API_KEY = 're_test_123';
    expect(obtenerPuertoEmail()).toBeInstanceOf(StubEmailAdapter);

    process.env.EMAIL_SANDBOX_MODE = 'true';
    expect(obtenerPuertoEmail()).toBeInstanceOf(StubEmailAdapter);
  });

  it('gate completo (EMAIL_SANDBOX_MODE=false + RESEND_API_KEY) → adaptador real', () => {
    process.env.EMAIL_SANDBOX_MODE = 'false';
    process.env.RESEND_API_KEY = 're_test_123';
    expect(emailSandboxActivo()).toBe(false);
    expect(obtenerPuertoEmail()).toBeInstanceOf(ResendEmailAdapter);
  });
});

describe('fabrica-email — remitente y Reply-To', () => {
  beforeEach(() => {
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_REPLY_TO;
    process.env.EMAIL_SANDBOX_MODE = 'false';
    process.env.RESEND_API_KEY = 're_test_123';
  });

  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // REGRESIÓN: el default apuntó a `rutax.app` — un dominio que NO es nuestro —
  // hasta el 2026-08-16. Resend rechaza todo envío desde un dominio no
  // verificado, así que el gate podía estar abierto y no salir un solo correo.
  it('sin EMAIL_FROM_ADDRESS, el remitente por defecto es del dominio de producción', async () => {
    const body = await capturarBodyDeUnEnvio();
    expect(body.from).toBe('Rutax <no-responder@rutax.io>');
  });

  it('EMAIL_FROM_ADDRESS manda sobre el default', async () => {
    process.env.EMAIL_FROM_ADDRESS = 'Rutax <avisos@rutax.io>';
    const body = await capturarBodyDeUnEnvio();
    expect(body.from).toBe('Rutax <avisos@rutax.io>');
  });

  it('EMAIL_REPLY_TO llega como reply_to al proveedor', async () => {
    process.env.EMAIL_REPLY_TO = 'Admin@rutax.io';
    const body = await capturarBodyDeUnEnvio();
    expect(body.reply_to).toBe('Admin@rutax.io');
  });

  it('EMAIL_REPLY_TO ausente o en blanco → no se manda reply_to', async () => {
    expect(await capturarBodyDeUnEnvio()).not.toHaveProperty('reply_to');

    vi.unstubAllGlobals();
    process.env.EMAIL_REPLY_TO = '   ';
    expect(await capturarBodyDeUnEnvio()).not.toHaveProperty('reply_to');
  });
});
