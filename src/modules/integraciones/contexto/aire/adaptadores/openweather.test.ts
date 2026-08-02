/**
 * Pruebas del adaptador de aire de OpenWeather.
 *
 * Lo que más importa aquí no es leer el JSON: es que la ventana de 24 h con la
 * que se clasifica el episodio esté SEMBRADA con el histórico. Sin siembra, las
 * primeras horas —las de hoy, las que el coordinador mira— se promedian contra
 * sí mismas y un episodio real sale subestimado.
 */

import { describe, expect, it, vi } from 'vitest';
import { OpenWeatherAireAdapter, clasificarConVentana, leerLecturas } from './openweather';

const HORA = 3_600_000;
const T0 = 1_785_000_000_000; // instante base en ms

function respuestaAire(desdeMs: number, valores: number[]) {
  return {
    coord: { lon: -70.66, lat: -33.44 },
    list: valores.map((pm25, i) => ({
      dt: Math.floor((desdeMs + i * HORA) / 1000),
      main: { aqi: 3 },
      components: { pm2_5: pm25, pm10: pm25 * 1.6 },
    })),
  };
}

describe('leerLecturas', () => {
  it('lee pm2_5 y pm10 y ordena por hora', () => {
    const lecturas = leerLecturas(respuestaAire(T0, [30, 40]), true);
    expect(lecturas).toHaveLength(2);
    expect(lecturas[0].pm25).toBe(30);
    expect(lecturas[0].pm10).toBe(48);
    expect(lecturas[0].hora.getTime()).toBeLessThan(lecturas[1].hora.getTime());
  });

  it('un componente ausente es null, no cero: un cero falso silencia un episodio', () => {
    const lecturas = leerLecturas({ list: [{ dt: T0 / 1000, components: {} }] }, true);
    expect(lecturas[0].pm25).toBeNull();
    expect(lecturas[0].pm10).toBeNull();
  });

  it('ante basura devuelve vacío', () => {
    expect(leerLecturas(null, true)).toEqual([]);
    expect(leerLecturas({ list: {} }, true)).toEqual([]);
  });
});

describe('clasificarConVentana', () => {
  it('la siembra entra al promedio y NO sale en el resultado', () => {
    const siembra = leerLecturas(respuestaAire(T0 - 24 * HORA, Array(24).fill(200)), false);
    const pronostico = leerLecturas(respuestaAire(T0, [10, 10]), true);

    const filas = clasificarConVentana(siembra, pronostico);

    expect(filas).toHaveLength(2); // solo el pronóstico
    // La media de la primera hora arrastra las 24 h de 200 µg/m³ que la
    // precedieron: (200×23 + 10) / 24 ≈ 192 → emergencia.
    expect(filas[0].media24hPm25).toBeGreaterThan(170);
    expect(filas[0].nivelEstimado).toBe('emergencia');
  });

  it('SIN siembra la primera hora se promedia contra sí misma y subestima', () => {
    // Es exactamente el defecto que la siembra existe para evitar, y queda
    // escrito para que nadie «simplifique» quitándola.
    const pronostico = leerLecturas(respuestaAire(T0, [10, 10]), true);
    const filas = clasificarConVentana([], pronostico);

    expect(filas[0].media24hPm25).toBe(10);
    expect(filas[0].nivelEstimado).toBe('bueno');
  });

  it('clasifica con los umbrales del Plan Operacional, no con el AQI de OpenWeather', () => {
    // 120 µg/m³ sostenidos son preemergencia (110–169), aunque el `main.aqi` del
    // proveedor diga otra cosa: la escala chilena es la que rige.
    const siembra = leerLecturas(respuestaAire(T0 - 24 * HORA, Array(24).fill(120)), false);
    const pronostico = leerLecturas(respuestaAire(T0, [120]), true);

    expect(clasificarConVentana(siembra, pronostico)[0].nivelEstimado).toBe('preemergencia');
  });

  it('conserva la marca de proyección de cada lectura', () => {
    const pronostico = leerLecturas(respuestaAire(T0, [10]), true);
    expect(clasificarConVentana([], pronostico)[0].esProyeccion).toBe(true);
  });
});

describe('OpenWeatherAireAdapter', () => {
  function fetchPorRuta(porRuta: Record<string, { cuerpo: unknown; estado?: number }>) {
    return vi.fn(async (entrada: RequestInfo | URL) => {
      const url = new URL(String(entrada));
      const clave = Object.keys(porRuta).find((k) => url.pathname.includes(k));
      const conf = clave ? porRuta[clave] : undefined;
      if (!conf) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(conf.cuerpo), {
        status: conf.estado ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  }

  it('pide histórico y pronóstico, y una sola vez por punto de grilla', async () => {
    const fetchImpl = fetchPorRuta({
      history: { cuerpo: respuestaAire(T0 - 24 * HORA, Array(24).fill(50)) },
      forecast: { cuerpo: respuestaAire(T0, [60, 70]) },
    });
    const adaptador = new OpenWeatherAireAdapter({
      apiKey: 'k',
      fetchImpl,
      ahora: () => new Date(T0),
    });

    const r = await adaptador.obtenerPronostico({ comunas: ['Santiago', 'Ñuñoa'], dias: 1 });

    // Dos llamadas: histórico + pronóstico. Un solo punto para las dos comunas.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    if (!r.ok) throw new Error('esperaba éxito');
    expect(r.datos.proveedor).toBe('openweather');
    expect(r.datos.comunasResueltas).toEqual(['Santiago', 'Ñuñoa']);
  });

  it('si el histórico falla, sigue con el pronóstico en vez de apagar la capa', async () => {
    const fetchImpl = fetchPorRuta({
      history: { cuerpo: { cod: 401 }, estado: 401 },
      forecast: { cuerpo: respuestaAire(T0, [60, 70]) },
    });
    const adaptador = new OpenWeatherAireAdapter({
      apiKey: 'k',
      fetchImpl,
      reintentos: { maxIntentos: 1 },
      ahora: () => new Date(T0),
    });

    const r = await adaptador.obtenerPronostico({ comunas: ['Santiago'], dias: 1 });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('esperaba éxito');
    expect(r.datos.horas.length).toBeGreaterThan(0);
  });

  it('si el pronóstico falla, degrada con motivo y sin filtrar la clave', async () => {
    const fetchImpl = fetchPorRuta({
      history: { cuerpo: respuestaAire(T0 - 24 * HORA, [50]) },
      forecast: { cuerpo: { cod: 500 }, estado: 500 },
    });
    const adaptador = new OpenWeatherAireAdapter({
      apiKey: 'CLAVE-SECRETA',
      fetchImpl,
      reintentos: { maxIntentos: 1 },
      ahora: () => new Date(T0),
    });

    const r = await adaptador.obtenerPronostico({ comunas: ['Santiago'] });

    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('CLAVE-SECRETA');
  });
});
