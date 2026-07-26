/**
 * Pruebas del adaptador real de CLIMA (Open-Meteo).
 * =====================================================================
 *
 * Sin red: `fetchImpl` inyectado devuelve un fixture con la forma EXACTA que
 * respondió la API real el 2026-07-26 (arreglo de resultados, `time` naive
 * local, `hourly_units` con km/h y °C).
 *
 * Cubren las cuatro cosas que el paso exige probar de este adaptador:
 *   · parseo del fixture (incluida la conversión de hora),
 *   · reintentos con backoff ante fallos transitorios,
 *   · degradación a "no pude" SIN excepción cuando la fuente se cae,
 *   · idempotencia de lectura (dos llamadas → el mismo conjunto de filas).
 */

import { describe, it, expect, vi } from 'vitest';
import { OpenMeteoClimaAdapter } from './open-meteo';
import type { ComunaRM } from '@/lib/ui/comunas-rm';

const COMUNAS = ['Santiago', 'Las Condes'] as ComunaRM[];

/** Fixture con la forma real de la respuesta multicoordenada. */
function fixtureClima() {
  const unaUbicacion = (lat: number, long: number) => ({
    latitude: lat,
    longitude: long,
    generationtime_ms: 0.2,
    utc_offset_seconds: -14400,
    timezone: 'America/Santiago',
    timezone_abbreviation: 'GMT-4',
    elevation: 570,
    hourly_units: {
      time: 'iso8601',
      precipitation: 'mm',
      precipitation_probability: '%',
      wind_speed_10m: 'km/h',
      temperature_2m: '°C',
    },
    hourly: {
      // Marcas NAIVE en hora local de Santiago — tal cual las manda la API.
      time: ['2026-07-26T00:00', '2026-07-26T01:00', '2026-07-26T02:00'],
      precipitation: [0.0, 1.2, null],
      precipitation_probability: [0, 45, 80],
      wind_speed_10m: [6.4, 9.1, 12.0],
      temperature_2m: [8.2, 7.9, 7.4],
    },
  });

  // Ojo: las coordenadas devueltas son las del NODO DE GRILLA, no las pedidas,
  // y aquí son deliberadamente iguales entre sí para reproducir el caso real de
  // dos comunas que caen en el mismo nodo.
  return [unaUbicacion(-33.427067, -70.64276), unaUbicacion(-33.427067, -70.64276)];
}

function respuestaOk(cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Reintentos instantáneos: las pruebas no duermen de verdad. */
const REINTENTOS_RAPIDOS = { maxIntentos: 3, dormir: async () => {} };

describe('OpenMeteoClimaAdapter — parseo del fixture', () => {
  it('produce una fila por (comuna, hora) con los campos de contexto.clima_horario', async () => {
    const fetchImpl = vi.fn(async () => respuestaOk(fixtureClima()));
    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.datos.proveedor).toBe('open-meteo');
    expect(res.datos.comunasResueltas).toEqual(COMUNAS);
    expect(res.datos.horas).toHaveLength(6); // 2 comunas × 3 horas

    const primera = res.datos.horas[0];
    expect(primera.comuna).toBe('Santiago');
    expect(primera.precipitacionMm).toBe(0);
    expect(primera.probPrecipitacion).toBe(0);
    expect(primera.vientoKmh).toBe(6.4);
    expect(primera.tempC).toBe(8.2);
  });

  it('convierte la hora naive a instante de Santiago (UTC-4 en julio)', async () => {
    const fetchImpl = vi.fn(async () => respuestaOk(fixtureClima()));
    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    if (!res.ok) throw new Error('esperaba éxito');

    expect(res.datos.horas[0].hora.toISOString()).toBe('2026-07-26T04:00:00.000Z');
    expect(res.datos.horas[1].hora.toISOString()).toBe('2026-07-26T05:00:00.000Z');
  });

  it('asigna cada resultado a su comuna por POSICIÓN, aunque compartan nodo de grilla', async () => {
    const fetchImpl = vi.fn(async () => respuestaOk(fixtureClima()));
    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    if (!res.ok) throw new Error('esperaba éxito');

    const comunas = [...new Set(res.datos.horas.map((h) => h.comuna))];
    expect(comunas).toEqual(['Santiago', 'Las Condes']);
  });

  it('un valor null del modelo queda null, no cero', async () => {
    const fetchImpl = vi.fn(async () => respuestaOk(fixtureClima()));
    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    if (!res.ok) throw new Error('esperaba éxito');
    expect(res.datos.horas[2].precipitacionMm).toBeNull();
  });

  it('las 52 comunas se piden en UNA sola llamada HTTP', async () => {
    const fetchImpl = vi.fn(async (url: URL) => {
      const n = url.searchParams.get('latitude')!.split(',').length;
      return respuestaOk(
        Array.from({ length: n }, () => fixtureClima()[0]),
      );
    });
    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const res = await adapter.obtenerPronostico({ dias: 1 });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (res.ok) expect(res.datos.comunasResueltas).toHaveLength(52);
  });
});

describe('OpenMeteoClimaAdapter — resiliencia', () => {
  it('reintenta ante un 503 y termina bien si el proveedor se recupera', async () => {
    let llamadas = 0;
    const fetchImpl = vi.fn(async () => {
      llamadas += 1;
      if (llamadas < 3) return new Response('', { status: 503 });
      return respuestaOk(fixtureClima());
    });

    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: { maxIntentos: 4, dormir: async () => {} },
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    expect(res.ok).toBe(true);
    expect(llamadas).toBe(3);
  });

  it('respeta el Retry-After de un 429 en vez de inventar la espera', async () => {
    const esperas: number[] = [];
    let llamadas = 0;
    const fetchImpl = vi.fn(async () => {
      llamadas += 1;
      if (llamadas === 1) {
        return new Response('', { status: 429, headers: { 'retry-after': '7' } });
      }
      return respuestaOk(fixtureClima());
    });

    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: {
        maxIntentos: 3,
        dormir: async (ms) => {
          esperas.push(ms);
        },
      },
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    expect(res.ok).toBe(true);
    expect(esperas).toEqual([7000]);
  });

  it('NO reintenta un 400: reintentar una petición mal formada solo quema cuota', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: true, reason: 'parámetro inválido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: { maxIntentos: 4, dormir: async () => {} },
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    expect(res.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('OpenMeteoClimaAdapter — degradar, nunca reventar', () => {
  it('fuente caída (red) → resultado "no pude", no excepción', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: { maxIntentos: 2, dormir: async () => {} },
    });

    // Lo importante: la llamada RESUELVE, no rechaza.
    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reintentable).toBe(true);
    // `motivo` es copy para el coordinador: sin jerga, sin stack trace.
    expect(res.motivo).toMatch(/no respondió a tiempo/i);
    expect(res.motivo).not.toMatch(/fetch failed|TypeError|HTTP/);
    expect(res.detalleTecnico.length).toBeGreaterThan(0);
  });

  it('un 500 persistente degrada como reintentable', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));
    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: { maxIntentos: 2, dormir: async () => {} },
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reintentable).toBe(true);
    expect(res.motivo).toMatch(/respondió con error/i);
  });

  it('un 400 degrada como NO reintentable', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 400 }));
    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: { maxIntentos: 2, dormir: async () => {} },
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reintentable).toBe(false);
    expect(res.motivo).toMatch(/rechazada/i);
  });

  it('una respuesta con menos ubicaciones de las pedidas degrada en vez de emparejar mal', async () => {
    // Este es el fallo peligroso: si se emparejara igual, el clima de una comuna
    // quedaría asignado a otra y movería el riesgo de la zona equivocada.
    const fetchImpl = vi.fn(async () => respuestaOk([fixtureClima()[0]]));
    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reintentable).toBe(false);
    expect(res.motivo).toMatch(/no se pudieron interpretar/i);
  });

  it('un cuerpo que no es JSON degrada como no reintentable', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<html>502</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reintentable).toBe(false);
  });

  it('una comuna inexistente degrada sin lanzar', async () => {
    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: (async () => respuestaOk([])) as unknown as typeof fetch,
    });
    const res = await adapter.obtenerPronostico({
      comunas: ['Valparaíso' as ComunaRM],
    });
    expect(res.ok).toBe(false);
  });
});

describe('OpenMeteoClimaAdapter — idempotencia de lectura', () => {
  it('dos llamadas con los mismos parámetros producen el mismo conjunto de filas', async () => {
    const fetchImpl = vi.fn(async () => respuestaOk(fixtureClima()));
    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: REINTENTOS_RAPIDOS,
    });

    const a = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    const b = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    if (!a.ok || !b.ok) throw new Error('esperaba éxito');

    expect(a.datos.horas).toEqual(b.datos.horas);

    // La clave (comuna, hora) —el PK de contexto.clima_horario— no se repite:
    // el upsert del job no puede chocar consigo mismo dentro de un lote.
    const claves = a.datos.horas.map((h) => `${h.comuna}|${h.hora.toISOString()}`);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('un reintento tras un fallo transitorio no duplica filas', async () => {
    let llamadas = 0;
    const fetchImpl = vi.fn(async () => {
      llamadas += 1;
      if (llamadas === 1) return new Response('', { status: 503 });
      return respuestaOk(fixtureClima());
    });

    const adapter = new OpenMeteoClimaAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reintentos: { maxIntentos: 3, dormir: async () => {} },
    });

    const res = await adapter.obtenerPronostico({ comunas: COMUNAS, dias: 1 });
    if (!res.ok) throw new Error('esperaba éxito');
    expect(res.datos.horas).toHaveLength(6);
  });
});
