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

    const adaptador = new ResendEmailAdapter({ apiKey: 'sk_test_secreto', remitente: 'Rutax <no-responder@rutax.app>' });
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

    const adaptador = new ResendEmailAdapter({ apiKey: 'sk_test_secreto', remitente: 'Rutax <no-responder@rutax.app>' });
    const resultado = await adaptador.enviarEmail(ARGS_BASE);

    expect(resultado.enviado).toBe(false);
    expect(resultado.modo).toBe('real');
    expect(resultado.errorDescripcion).toBe('dirección de correo inválida');
    expect(resultado.errorDescripcion).not.toContain('sk_test_secreto');
  });

  it('fallo de red/timeout → enviado=false, NUNCA lanza', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', fetchMock);

    const adaptador = new ResendEmailAdapter({ apiKey: 'sk_test_secreto', remitente: 'Rutax <no-responder@rutax.app>' });
    const resultado = await adaptador.enviarEmail(ARGS_BASE);

    expect(resultado).toEqual({
      enviado: false,
      modo: 'real',
      errorDescripcion: 'error de red al contactar Resend',
    });
  });
});
