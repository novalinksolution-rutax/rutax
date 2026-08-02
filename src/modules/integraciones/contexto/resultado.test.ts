/**
 * Pruebas del contrato de degradación.
 * =====================================================================
 * Lo que se protege aquí: que `motivo` (lo que ve el coordinador) nunca lleve
 * jerga técnica ni credenciales, y que `detalleTecnico` nunca lleve un secreto.
 */

import { describe, it, expect } from 'vitest';
import {
  degradarDesdeError,
  exito,
  fallo,
  MOTIVOS_DEGRADACION,
  sanearParaMensaje,
} from './resultado';
import { ErrorContextoConfig, ErrorContextoProveedor } from './errores';

describe('exito / fallo', () => {
  it('exito lleva los datos y el instante', () => {
    const cuando = new Date('2026-07-26T12:00:00Z');
    const r = exito([1, 2, 3], cuando);
    expect(r.ok).toBe(true);
    expect(r.datos).toEqual([1, 2, 3]);
    expect(r.obtenidoEn).toBe(cuando);
  });

  it('fallo es un valor de retorno, no una excepción', () => {
    const r = fallo('motivo visible', 'detalle técnico', true);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('motivo visible');
    expect(r.detalleTecnico).toBe('detalle técnico');
    expect(r.reintentable).toBe(true);
  });
});

describe('MOTIVOS_DEGRADACION — copy para el coordinador', () => {
  it('nombra la fuente y no usa jerga HTTP', () => {
    for (const construir of Object.values(MOTIVOS_DEGRADACION)) {
      const texto = construir('clima');
      expect(texto).toContain('clima');
      expect(texto).not.toMatch(/HTTP|4\d\d|5\d\d|null|undefined|stack/i);
    }
  });
});

describe('sanearParaMensaje — secretos jamás en logs', () => {
  it('enmascara una apikey incrustada en una URL', () => {
    const texto =
      'fallo en https://customer-api.open-meteo.com/v1/forecast?latitude=-33&apikey=abc123XYZ';
    const saneado = sanearParaMensaje(texto);
    expect(saneado).not.toContain('abc123XYZ');
    expect(saneado).toContain('apikey=[REDACTADO]');
  });

  it('enmascara token, access_token, key y secret', () => {
    const saneado = sanearParaMensaje(
      'token=t1 access_token=t2 key=t3 secret=t4',
    );
    for (const valor of ['t1', 't2', 't3', 't4']) {
      expect(saneado).not.toContain(valor);
    }
  });

  it('trunca textos largos', () => {
    const largo = 'x'.repeat(5000);
    const saneado = sanearParaMensaje(largo, 100);
    expect(saneado.length).toBeLessThanOrEqual(101);
    expect(saneado.endsWith('…')).toBe(true);
  });

  it('deja intacto un texto normal', () => {
    expect(sanearParaMensaje('api.open-meteo.com/v1/forecast respondió 500')).toBe(
      'api.open-meteo.com/v1/forecast respondió 500',
    );
  });
});

describe('degradarDesdeError — red de seguridad del llamador', () => {
  it('un error de configuración degrada como NO reintentable', () => {
    const r = degradarDesdeError(
      new ErrorContextoConfig("CONTEXTO_CLIMA_PROVIDER='xx' no es reconocido"),
      'clima',
    );
    expect(r.ok).toBe(false);
    expect(r.reintentable).toBe(false);
    expect(r.motivo).toContain('no está configurada');
  });

  it('un error de proveedor transitorio degrada como reintentable', () => {
    const r = degradarDesdeError(
      new ErrorContextoProveedor('timeout', { reintentable: true }),
      'clima',
    );
    expect(r.reintentable).toBe(true);
    expect(r.motivo).toContain('respondió con error');
  });

  it('acepta cualquier cosa lanzada, no solo Error', () => {
    const r = degradarDesdeError('algo raro', 'feriados');
    expect(r.ok).toBe(false);
    expect(r.detalleTecnico).toBe('algo raro');
  });

  it('sanea el detalle técnico', () => {
    const r = degradarDesdeError(new Error('falló con apikey=SUPERSECRETO'), 'clima');
    expect(r.detalleTecnico).not.toContain('SUPERSECRETO');
  });
});
