import { describe, it, expect, vi, afterEach } from 'vitest';
import { ResendEmailAdapter } from './resend';

const ARGS_BASE = {
  para: 'dueno@courier.cl',
  asunto: 'Pago recibido',
  html: '<p>Recibimos tu pago</p>',
  texto: 'Recibimos tu pago',
};

describe('ResendEmailAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('envía correctamente: enviado=true, modo=real, con el id del proveedor', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'resend_msg_123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adaptador = new ResendEmailAdapter({ apiKey: 'sk_test_secreto', remitente: 'Rutax <no-responder@rutax.io>' });
    const resultado = await adaptador.enviarEmail(ARGS_BASE);

    expect(resultado).toEqual({ enviado: true, modo: 'real', proveedorId: 'resend_msg_123' });

    // La API key va SOLO en el header Authorization — nunca en el body ni en la URL.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_secreto');
    expect(JSON.stringify(init.body)).not.toContain('sk_test_secreto');
  });

  it('4xx/5xx del proveedor → enviado=false, error SANEADO sin la api key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: 'dirección de correo inválida' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const adaptador = new ResendEmailAdapter({ apiKey: 'sk_test_secreto', remitente: 'Rutax <no-responder@rutax.io>' });
    const resultado = await adaptador.enviarEmail(ARGS_BASE);

    expect(resultado.enviado).toBe(false);
    expect(resultado.modo).toBe('real');
    expect(resultado.errorDescripcion).toBe('dirección de correo inválida');
    expect(resultado.errorDescripcion).not.toContain('sk_test_secreto');
  });

  it('con responderA → el body lleva reply_to; sin responderA → la clave NO aparece', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'resend_msg_123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const conReply = new ResendEmailAdapter({
      apiKey: 'sk_test_secreto',
      remitente: 'Rutax <no-responder@rutax.io>',
      responderA: 'Admin@rutax.io',
    });
    await conReply.enviarEmail(ARGS_BASE);

    const [, initConReply] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(initConReply.body as string)).toMatchObject({
      from: 'Rutax <no-responder@rutax.io>',
      reply_to: 'Admin@rutax.io',
    });

    const sinReply = new ResendEmailAdapter({
      apiKey: 'sk_test_secreto',
      remitente: 'Rutax <no-responder@rutax.io>',
    });
    await sinReply.enviarEmail(ARGS_BASE);

    // Ausente, no presente-y-vacío: Resend rechaza un reply_to vacío.
    const [, initSinReply] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(initSinReply.body as string)).not.toHaveProperty('reply_to');
  });

  it('fallo de red/timeout → enviado=false, NUNCA lanza', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', fetchMock);

    const adaptador = new ResendEmailAdapter({ apiKey: 'sk_test_secreto', remitente: 'Rutax <no-responder@rutax.io>' });
    const resultado = await adaptador.enviarEmail(ARGS_BASE);

    expect(resultado).toEqual({
      enviado: false,
      modo: 'real',
      errorDescripcion: 'error de red al contactar Resend',
    });
  });
});
