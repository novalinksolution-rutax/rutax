/**
 * Pruebas del adaptador de clima de OpenWeather.
 *
 * El fixture reproduce la forma REAL documentada del endpoint
 * `/data/2.5/forecast`, incluidas las dos cosas que se equivocan en silencio:
 * el viento viene en m/s aunque se pida `units=metric`, y `rain.3h` es un
 * acumulado de tres horas, no una intensidad horaria.
 */

import { describe, expect, it, vi } from 'vitest';
import { OpenWeatherClimaAdapter, normalizarPronostico } from './openweather';

/** Respuesta con la forma que documenta OpenWeather. */
const RESPUESTA = {
  cod: '200',
  cnt: 3,
  list: [
    {
      dt: 1_785_000_000,
      main: { temp: 12.4 },
      wind: { speed: 5, deg: 240 },
      rain: { '3h': 6 },
      pop: 0.86,
    },
    {
      // Sin bloque `rain`: la API dice que no llueve en ese paso.
      dt: 1_785_010_800,
      main: { temp: 10.1 },
      wind: { speed: 2.5 },
      pop: 0,
    },
    {
      // Sin `pop` ni `wind`: campos ausentes, no ceros.
      dt: 1_785_021_600,
      main: {},
      rain: { '3h': 0.9 },
    },
  ],
};

describe('normalizarPronostico', () => {
  it('convierte el viento de m/s a km/h', () => {
    // La trampa más cara: `units=metric` NO devuelve km/h. Escribir 5 en la
    // columna `viento_kmh` sería dividir el viento real por 3,6.
    const filas = normalizarPronostico(RESPUESTA);
    expect(filas[0].vientoKmh).toBe(18); // 5 m/s × 3,6
    expect(filas[1].vientoKmh).toBe(9); // 2,5 m/s × 3,6
  });

  it('reparte `rain.3h` entre las horas del paso en vez de escribirlo crudo', () => {
    // 6 mm en tres horas son 2 mm/h. Escribir 6 triplicaría la lluvia que ve el
    // motor de riesgo y volvería crítica cualquier tarde de invierno.
    const filas = normalizarPronostico(RESPUESTA);
    expect(filas[0].precipitacionMm).toBe(2);
    expect(filas[2].precipitacionMm).toBe(0.3);
  });

  it('distingue «no llueve» de «no sé»', () => {
    const filas = normalizarPronostico(RESPUESTA);
    // Sin bloque `rain` la API afirma que no cae nada: el 0 es el dato.
    expect(filas[1].precipitacionMm).toBe(0);
    // Sin `pop` no se inventa un 0 %: no saber no es saber que no.
    expect(filas[2].probPrecipitacion).toBeNull();
    expect(filas[2].vientoKmh).toBeNull();
    expect(filas[2].tempC).toBeNull();
  });

  it('lleva `pop` de 0–1 a los 0–100 que exige la columna', () => {
    expect(normalizarPronostico(RESPUESTA)[0].probPrecipitacion).toBe(86);
  });

  it('interpreta `dt` como Unix en segundos UTC', () => {
    const filas = normalizarPronostico(RESPUESTA);
    expect(filas[0].hora.getTime()).toBe(1_785_000_000 * 1000);
  });

  it('descarta elementos sin instante en vez de escribir una fila sin hora', () => {
    const filas = normalizarPronostico({ list: [{ main: { temp: 9 } }, { dt: 'ayer' }] });
    expect(filas).toEqual([]);
  });

  it('ante un cuerpo que no tiene `list` devuelve vacío, no revienta', () => {
    expect(normalizarPronostico(null)).toEqual([]);
    expect(normalizarPronostico({})).toEqual([]);
    expect(normalizarPronostico({ list: 'nope' })).toEqual([]);
  });
});

describe('OpenWeatherClimaAdapter', () => {
  function fetchFalso(respuesta: unknown, estado = 200) {
    return vi.fn(async () =>
      new Response(JSON.stringify(respuesta), {
        status: estado,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  it('hace UNA llamada por punto de grilla, no una por comuna', async () => {
    const fetchImpl = fetchFalso(RESPUESTA);
    const adaptador = new OpenWeatherClimaAdapter({ apiKey: 'k', fetchImpl });

    // Tres comunas del casco urbano comparten el punto «Santiago».
    const r = await adaptador.obtenerPronostico({
      comunas: ['Santiago', 'Providencia', 'Ñuñoa'],
      dias: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (!r.ok) throw new Error('esperaba éxito');
    // Pero se emiten filas para las tres: la tabla es por comuna.
    expect(r.datos.comunasResueltas).toEqual(['Santiago', 'Providencia', 'Ñuñoa']);
    expect(r.datos.horas).toHaveLength(9); // 3 comunas × 3 puntos del fixture
    expect(r.datos.proveedor).toBe('openweather');
  });

  it('no cita la URL con la clave cuando el proveedor rechaza la petición', async () => {
    const fetchImpl = fetchFalso({ cod: 401, message: 'Invalid API key' }, 401);
    const adaptador = new OpenWeatherClimaAdapter({
      apiKey: 'CLAVE-SUPER-SECRETA',
      fetchImpl,
      reintentos: { maxIntentos: 1 },
    });

    const r = await adaptador.obtenerPronostico({ comunas: ['Santiago'] });

    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('CLAVE-SUPER-SECRETA');
  });

  it('sin clave degrada con un motivo legible y NO reintenta', async () => {
    const fetchImpl = fetchFalso(RESPUESTA);
    const adaptador = new OpenWeatherClimaAdapter({ fetchImpl });

    const r = await adaptador.obtenerPronostico({ comunas: ['Santiago'] });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('esperaba fallo');
    expect(r.reintentable).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
