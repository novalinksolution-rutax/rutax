/**
 * Pruebas del adaptador real de CALIDAD DEL AIRE (Open-Meteo Air Quality).
 * =====================================================================
 *
 * Sin red. El fixture reproduce la forma verificada el 2026-07-26, incluidos los
 * valores reales de Santiago de esa madrugada (pm2_5 arrancando en 97,3).
 */

import { describe, it, expect, vi } from 'vitest';
import { OpenMeteoAireAdapter } from './open-meteo';
import type { ComunaRM } from '@/lib/ui/comunas-rm';

const COMUNAS = ['Santiago'] as ComunaRM[];
const REINTENTOS_RAPIDOS = { maxIntentos: 3, dormir: async () => {} };

/**
 * Serie de 30 horas: 24 h de historia (plana y baja) + 6 h de "pronóstico" con
 * un peak. Sirve para comprobar que el peak horario NO se clasifica solo.
 */
function fixtureAire(pm25: Array<number | null>) {
  const horas = pm25.map((_, i) => {
    const dia = 25 + Math.floor(i / 24);
    const h = i % 24;
    return `2026-07-${String(dia).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`;
  });
  return [
    {
      latitude: -33.427067,
      longitude: -70.64276,
      utc_offset_seconds: -14400,
      timezone: 'America/Santiago',
      hourly_units: { time: 'iso8601', pm2_5: 'μg/m³', pm10: 'μg/m³' },
      hourly: {
        time: horas,
        pm2_5: pm25,
        pm10: pm25.map((v) => (v === null ? null : Math.round(v * 1.6 * 10) / 10)),
      },
    },
  ];
}

function respuestaOk(cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function adaptadorCon(cuerpo: unknown) {
  const fetchImpl = vi.fn(async (_url: URL) => respuestaOk(cuerpo));
  return {
    fetchImpl,
    adapter: new OpenMeteoAireAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    }),
  };
}

describe('OpenMeteoAireAdapter — parseo y clasificación', () => {
  it('produce filas de contexto.aire_horario con pm25, pm10 y nivel', async () => {
    const serie = new Array<number>(30).fill(20);
    const { adapter } = adaptadorCon(fixtureAire(serie));

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.datos.proveedor).toBe('open-meteo');
    expect(res.datos.horas).toHaveLength(30);

    const f = res.datos.horas[0];
    expect(f.comuna).toBe('Santiago');
    expect(f.pm25).toBe(20);
    expect(f.pm10).toBe(32);
    expect(f.nivelEstimado).toBe('bueno');
  });

  it('convierte la hora naive a instante de Santiago', async () => {
    const { adapter } = adaptadorCon(fixtureAire([10, 10]));
    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    if (!res.ok) throw new Error('esperaba éxito');
    expect(res.datos.horas[0].hora.toISOString()).toBe('2026-07-25T04:00:00.000Z');
  });

  it('pide 24 h de historia (past_days=1) para que la ventana móvil esté completa', async () => {
    const { adapter, fetchImpl } = adaptadorCon(fixtureAire([10]));
    await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 3 });

    const url = fetchImpl.mock.calls[0][0];
    expect(url.searchParams.get('past_days')).toBe('1');
    expect(url.searchParams.get('forecast_days')).toBe('3');
    expect(url.searchParams.get('hourly')).toBe('pm2_5,pm10');
  });

  it('NO declara episodio por un peak horario aislado', async () => {
    // 24 h planas en 20 µg/m³ y luego una hora en 97,3 (el valor real medido en
    // Santiago). Clasificar la hora suelta daría "alerta"; la media móvil no.
    const serie = [...new Array<number>(24).fill(20), 97.3];
    const { adapter } = adaptadorCon(fixtureAire(serie));

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    if (!res.ok) throw new Error('esperaba éxito');

    const ultima = res.datos.horas[24];
    expect(ultima.pm25).toBe(97.3);
    expect(ultima.media24hPm25!).toBeLessThan(30);
    expect(ultima.nivelEstimado).toBe('bueno');
  });

  it('SÍ declara preemergencia con una serie sostenidamente alta', async () => {
    const serie = new Array<number>(30).fill(130);
    const { adapter } = adaptadorCon(fixtureAire(serie));

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    if (!res.ok) throw new Error('esperaba éxito');

    const ultima = res.datos.horas[res.datos.horas.length - 1];
    expect(ultima.media24hPm25).toBe(130);
    expect(ultima.nivelEstimado).toBe('preemergencia');
  });

  it('marca esProyeccion según la hora sea futura o pasada', async () => {
    const { adapter } = adaptadorCon(fixtureAire([10, 10]));
    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    if (!res.ok) throw new Error('esperaba éxito');
    // El fixture es de julio de 2026; respecto de "ahora" en la ejecución del
    // test, lo único que se afirma es que el campo existe y es booleano.
    for (const f of res.datos.horas) {
      expect(typeof f.esProyeccion).toBe('boolean');
    }
  });
});

describe('OpenMeteoAireAdapter — resiliencia y degradación', () => {
  it('reintenta un 502 y se recupera', async () => {
    let llamadas = 0;
    const fetchImpl = vi.fn(async () => {
      llamadas += 1;
      if (llamadas === 1) return new Response('', { status: 502 });
      return respuestaOk(fixtureAire([10, 10]));
    });
    const adapter = new OpenMeteoAireAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: { maxIntentos: 3, dormir: async () => {} },
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS });
    expect(res.ok).toBe(true);
    expect(llamadas).toBe(2);
  });

  it('fuente caída → "no pude" sin excepción', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const adapter = new OpenMeteoAireAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: { maxIntentos: 2, dormir: async () => {} },
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reintentable).toBe(true);
    expect(res.motivo).toContain('calidad del aire');
    expect(res.motivo).not.toContain('ENOTFOUND');
  });

  it('cuerpo de error de Open-Meteo con HTTP 200 degrada como no reintentable', async () => {
    const { adapter } = adaptadorCon([{ error: true, reason: 'Data corrupted' }]);
    const res = await adapter.obtenerPronostico({ comunas: COMUNAS });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reintentable).toBe(false);
    expect(res.motivo).toMatch(/no se pudieron interpretar/i);
  });

  it('falta el bloque hourly → degrada', async () => {
    const { adapter } = adaptadorCon([{ latitude: -33.4, longitude: -70.6 }]);
    const res = await adapter.obtenerPronostico({ comunas: COMUNAS });
    expect(res.ok).toBe(false);
  });
});

describe('OpenMeteoAireAdapter — idempotencia de lectura', () => {
  it('dos llamadas iguales dan el mismo conjunto, con claves (comuna, hora) únicas', async () => {
    const { adapter } = adaptadorCon(fixtureAire(new Array<number>(30).fill(40)));

    const a = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    const b = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    if (!a.ok || !b.ok) throw new Error('esperaba éxito');

    expect(a.datos.horas).toEqual(b.datos.horas);
    const claves = a.datos.horas.map((h) => `${h.comuna}|${h.hora.toISOString()}`);
    expect(new Set(claves).size).toBe(claves.length);
  });
});
