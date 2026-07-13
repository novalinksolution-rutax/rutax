import { describe, it, expect, vi, afterEach } from 'vitest';
import { StubEmailAdapter } from './stub';

describe('StubEmailAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('nunca envía correo real: enviado=false, modo=stub', async () => {
    const adaptador = new StubEmailAdapter();
    const resultado = await adaptador.enviarEmail({
      para: 'dueno@courier.cl',
      asunto: 'Asunto de prueba',
      html: '<p>contenido</p>',
    });

    expect(resultado).toEqual({ enviado: false, modo: 'stub' });
  });

  it('loguea de forma estructurada SIN volcar el html/texto completos', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const adaptador = new StubEmailAdapter();

    await adaptador.enviarEmail({
      para: 'dueno@courier.cl',
      asunto: 'Tu prueba vence pronto',
      html: '<p>SECRETO_QUE_NO_DEBE_APARECER</p>',
      texto: 'SECRETO_QUE_NO_DEBE_APARECER',
    });

    expect(spy).toHaveBeenCalled();
    const logueado = spy.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(logueado).not.toContain('SECRETO_QUE_NO_DEBE_APARECER');
    expect(logueado).toContain('dueno@courier.cl');
    expect(logueado).toContain('Tu prueba vence pronto');
  });
});
