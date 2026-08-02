/**
 * Pruebas de las piezas compartidas de Open-Meteo.
 * =====================================================================
 *
 * Aquí vive el bug de zona horaria si algún día alguien lo reintroduce. Sin red:
 * todo son fixtures con la forma verificada de la API real.
 */

import { describe, it, expect } from 'vitest';
import { ErrorContextoRespuesta } from './errores';
import {
  comoArreglo,
  construirUrlOpenMeteo,
  emparejarPorIndice,
  extraerVariable,
  horaSantiagoAInstante,
  puntosDeConsulta,
  trocear,
  type BloqueHorario,
} from './open-meteo-comun';
import { CENTROIDES_RM } from '@/lib/geo/centroides-rm';
import type { ComunaRM } from '@/lib/ui/comunas-rm';

describe('puntosDeConsulta', () => {
  it('sin argumento devuelve las 52 comunas de la RM', () => {
    const p = puntosDeConsulta();
    expect(p).toHaveLength(52);
    expect(p).toHaveLength(Object.keys(CENTROIDES_RM).length);
  });

  it('respeta el subconjunto pedido y su orden', () => {
    const p = puntosDeConsulta(['Vitacura', 'Maipú'] as ComunaRM[]);
    expect(p.map((x) => x.comuna)).toEqual(['Vitacura', 'Maipú']);
    expect(p[0].lat).toBe(CENTROIDES_RM['Vitacura' as ComunaRM].lat);
  });

  it('una comuna fuera del catálogo falla ruidosamente', () => {
    expect(() => puntosDeConsulta(['Valparaíso' as ComunaRM])).toThrow(
      ErrorContextoRespuesta,
    );
  });
});

describe('construirUrlOpenMeteo', () => {
  const puntos = puntosDeConsulta(['Santiago', 'Las Condes'] as ComunaRM[]);

  it('manda las coordenadas como listas paralelas separadas por coma', () => {
    const url = construirUrlOpenMeteo({
      baseUrl: 'https://api.open-meteo.com/v1/forecast',
      puntos,
      variablesHorarias: ['precipitation', 'temperature_2m'],
      forecastDays: 3,
    });

    expect(url.searchParams.get('latitude')).toBe(
      `${puntos[0].lat},${puntos[1].lat}`,
    );
    expect(url.searchParams.get('longitude')).toBe(
      `${puntos[0].long},${puntos[1].long}`,
    );
    expect(url.searchParams.get('hourly')).toBe('precipitation,temperature_2m');
    expect(url.searchParams.get('forecast_days')).toBe('3');
  });

  it('siempre pide los datos en hora de Santiago', () => {
    const url = construirUrlOpenMeteo({
      baseUrl: 'https://api.open-meteo.com/v1/forecast',
      puntos,
      variablesHorarias: ['precipitation'],
      forecastDays: 1,
    });
    expect(url.searchParams.get('timezone')).toBe('America/Santiago');
  });

  it('omite past_days cuando no se pide, y lo incluye cuando sí', () => {
    const sin = construirUrlOpenMeteo({
      baseUrl: 'https://x.test/v1/f',
      puntos,
      variablesHorarias: ['pm2_5'],
      forecastDays: 3,
    });
    expect(sin.searchParams.has('past_days')).toBe(false);

    const con = construirUrlOpenMeteo({
      baseUrl: 'https://x.test/v1/f',
      puntos,
      variablesHorarias: ['pm2_5'],
      forecastDays: 3,
      pastDays: 1,
    });
    expect(con.searchParams.get('past_days')).toBe('1');
  });

  it('no agrega apikey si no hay (las fuentes libres no la usan)', () => {
    const url = construirUrlOpenMeteo({
      baseUrl: 'https://x.test/v1/f',
      puntos,
      variablesHorarias: ['pm2_5'],
      forecastDays: 1,
    });
    expect(url.searchParams.has('apikey')).toBe(false);
  });
});

describe('horaSantiagoAInstante — el bug que no se puede reintroducir', () => {
  it('interpreta la marca naive como hora LOCAL de Santiago, no como UTC', () => {
    // Julio en Chile = invierno = UTC-4. Las 00:00 de Santiago son las 04:00 UTC.
    const d = horaSantiagoAInstante('2026-07-26T00:00');
    expect(d.toISOString()).toBe('2026-07-26T04:00:00.000Z');
  });

  it('respeta el horario de verano chileno (UTC-3) sin hardcodear el offset', () => {
    // Enero = verano = UTC-3. Las 00:00 de Santiago son las 03:00 UTC.
    const d = horaSantiagoAInstante('2026-01-15T00:00');
    expect(d.toISOString()).toBe('2026-01-15T03:00:00.000Z');
  });

  it('NO coincide con new Date(marca) cuando el proceso corre en UTC', () => {
    // Esta es la comparación que documenta el riesgo: en Vercel (UTC) el parseo
    // ingenuo daría medianoche UTC, cuatro horas antes — el clima del día
    // equivocado a partir de las 20:00 de Santiago.
    const correcto = horaSantiagoAInstante('2026-07-26T00:00');
    const ingenuoUtc = new Date('2026-07-26T00:00:00Z');
    expect(correcto.getTime()).not.toBe(ingenuoUtc.getTime());
    expect(correcto.getTime() - ingenuoUtc.getTime()).toBe(4 * 3_600_000);
  });

  it('acepta segundos si Open-Meteo algún día los agrega', () => {
    const d = horaSantiagoAInstante('2026-07-26T13:00:00');
    expect(d.toISOString()).toBe('2026-07-26T17:00:00.000Z');
  });

  it('rechaza una marca sin separador T', () => {
    expect(() => horaSantiagoAInstante('2026-07-26 00:00')).toThrow(
      ErrorContextoRespuesta,
    );
  });

  it('rechaza una marca con fecha ilegible', () => {
    expect(() => horaSantiagoAInstante('26-07-2026T00:00')).toThrow(
      ErrorContextoRespuesta,
    );
  });
});

describe('comoArreglo — una coordenada da objeto, varias dan arreglo', () => {
  it('envuelve el objeto de una sola coordenada', () => {
    expect(comoArreglo({ latitude: -33.4 })).toEqual([{ latitude: -33.4 }]);
  });

  it('deja pasar el arreglo de varias coordenadas', () => {
    expect(comoArreglo([{ latitude: -33.4 }, { latitude: -33.5 }])).toHaveLength(2);
  });

  it('rechaza cualquier otra cosa', () => {
    expect(() => comoArreglo('texto')).toThrow(ErrorContextoRespuesta);
    expect(() => comoArreglo(null)).toThrow(ErrorContextoRespuesta);
  });
});

describe('emparejarPorIndice — el emparejamiento es POSICIONAL', () => {
  const puntos = puntosDeConsulta(['Santiago', 'Vitacura'] as ComunaRM[]);

  it('empareja por posición, no por coordenada devuelta', () => {
    // Medido en la API real: 52 comunas caen en solo 26 nodos de grilla, y la
    // coordenada devuelta puede estar a kilómetros de la pedida. Emparejar por
    // lat/long duplicaría comunas y perdería otras, en silencio.
    const resultados = [
      { latitude: -33.427067, longitude: -70.64276 },
      { latitude: -33.427067, longitude: -70.64276 }, // mismo nodo, otra comuna
    ];
    const pares = emparejarPorIndice(puntos, resultados);
    expect(pares.map((p) => p.punto.comuna)).toEqual(['Santiago', 'Vitacura']);
  });

  it('falla ruidosamente si llegan menos resultados que ubicaciones', () => {
    expect(() => emparejarPorIndice(puntos, [{ latitude: -33.4 }])).toThrow(
      ErrorContextoRespuesta,
    );
  });

  it('falla ruidosamente si llegan más resultados que ubicaciones', () => {
    expect(() =>
      emparejarPorIndice(puntos, [{}, {}, {}]),
    ).toThrow(ErrorContextoRespuesta);
  });
});

describe('extraerVariable', () => {
  const bloque = {
    time: ['2026-07-26T00:00', '2026-07-26T01:00'],
    precipitation: [0, 1.5],
  };

  it('extrae la variable pedida', () => {
    expect(extraerVariable(bloque, 'precipitation', 2)).toEqual([0, 1.5]);
  });

  it('una variable ausente da nulls, no un error (dato ausente ≠ fallo)', () => {
    expect(extraerVariable(bloque, 'wind_speed_10m', 2)).toEqual([null, null]);
  });

  it('normaliza valores no numéricos a null', () => {
    // Cast deliberado: se prueba justamente el caso en que el proveedor manda
    // algo que NO calza con el tipo declarado.
    const raro = { time: ['a', 'b'], pm2_5: [null, 'x'] } as unknown as BloqueHorario;
    expect(extraerVariable(raro, 'pm2_5', 2)).toEqual([null, null]);
  });

  it('un largo descuadrado es un error: significa que el contrato cambió', () => {
    expect(() => extraerVariable(bloque, 'precipitation', 3)).toThrow(
      ErrorContextoRespuesta,
    );
  });
});

describe('trocear', () => {
  it('las 52 comunas caben en un solo lote', () => {
    expect(trocear(puntosDeConsulta())).toHaveLength(1);
  });

  it('parte en lotes del tamaño pedido', () => {
    expect(trocear([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('rechaza tamaños inválidos', () => {
    expect(() => trocear([1], 0)).toThrow(RangeError);
  });
});
