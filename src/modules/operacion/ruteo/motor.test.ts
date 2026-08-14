/**
 * Pruebas del motor de ruteo completo (`calcularRuta`).
 * =====================================================================
 * Cubre lo que las pruebas unitarias de cada pieza (`vecino-cercano.test.ts`,
 * `dos-opt.test.ts`, `or-opt.test.ts`, `costo.test.ts`) no pueden: el
 * comportamiento de la TUBERÍA completa — geometría con óptimo conocido,
 * validación de entrada, `sinUbicar`, determinismo de punta a punta,
 * rendimiento, y la prueba de privacidad del punto de término.
 */

import { describe, it, expect } from 'vitest';
import { calcularRuta, TOPE_RONDAS } from './motor';
import { HaversineMatrizAdapter } from '@/modules/integraciones/ruteo/adaptadores/haversine';
import type { PuertoMatriz } from '@/modules/integraciones/ruteo/puerto';
import type { MatrizDistancias, PuntoRuteo } from '@/modules/integraciones/ruteo/tipos';
import { distanciaEnMetros } from '@/lib/geo/distancia';
import type { EntradaRuteo, RutaCalculada } from './tipos';

// =============================================================================
// 1. Geometría conocida: un cuadrado con óptimo verificado por fuerza bruta
// =============================================================================

describe('calcularRuta — geometría conocida (cuadrado, óptimo por fuerza bruta)', () => {
  it('encuentra la ruta óptima real, no solo "una" ruta razonable', async () => {
    // Origen al suroeste del cuadrado. Las 4 esquinas están a la misma
    // distancia relativa entre sí (lado = 10): la única forma de recorrerlas
    // sin cruzar es entrar por la esquina más cercana (SW) y seguir el
    // perímetro (SW→SE→NE→NW o su espejo SW→NW→NE→SE). Verificado por
    // fuerza bruta sobre las 24 permutaciones de las 4 esquinas: el óptimo
    // real es SW→SE→NE→NW, y coincide EXACTO (mismo costo, no solo "cerca")
    // con lo que produce este motor.
    const origen = { lat: -10, long: -10 };
    const SW = { pedidoId: 'SW', lat: 0, long: 0 };
    const SE = { pedidoId: 'SE', lat: 0, long: 10 };
    const NE = { pedidoId: 'NE', lat: 10, long: 10 };
    const NW = { pedidoId: 'NW', lat: 10, long: 0 };

    const ruta = await calcularRuta({ origen, destino: null, paradas: [SW, SE, NE, NW] });

    expect(ruta.secuencia.map((p) => p.pedidoId)).toEqual(['SW', 'SE', 'NE', 'NW']);
    expect(ruta.secuencia.map((p) => p.orden)).toEqual([1, 2, 3, 4]);
    expect(ruta.sinUbicar).toEqual([]);

    // Óptimo de fuerza bruta (las 24 permutaciones), calculado una sola vez
    // y fijado como número exacto — cualquier cambio del motor que se aleje
    // de él (para peor O para mejor sin que se actualice el número) hace
    // fallar la prueba.
    expect(ruta.distanciaTotalM).toBeCloseTo(4887440.065090197, 3);
  });

  it('el orden importa: la ruta óptima real es mejor que recorrer las esquinas en el orden en que llegaron', async () => {
    const origen = { lat: -10, long: -10 };
    // A propósito en un orden "malo" de entrada (NE antes que las vecinas):
    // si el motor solo copiara el orden de entrada, el costo sería peor.
    const paradas = [
      { pedidoId: 'NE', lat: 10, long: 10 },
      { pedidoId: 'SW', lat: 0, long: 0 },
      { pedidoId: 'NW', lat: 10, long: 0 },
      { pedidoId: 'SE', lat: 0, long: 10 },
    ];
    const costoEnOrdenDeEntrada =
      distanciaEnMetros(origen, { lat: 10, long: 10 }) +
      distanciaEnMetros({ lat: 10, long: 10 }, { lat: 0, long: 0 }) +
      distanciaEnMetros({ lat: 0, long: 0 }, { lat: 10, long: 0 }) +
      distanciaEnMetros({ lat: 10, long: 0 }, { lat: 0, long: 10 });

    const ruta = await calcularRuta({ origen, destino: null, paradas });

    expect(ruta.distanciaTotalM).toBeLessThan(costoEnOrdenDeEntrada);
    // Este cuadrado es simétrico respecto de la diagonal por la que entra el
    // origen (offset -10 igual en lat y en long): recorrer el perímetro en
    // un sentido (SW→SE→NE→NW) o en el espejo (SW→NW→NE→SE) cuesta EXACTO
    // lo mismo — verificado por cálculo directo, no es una coincidencia de
    // esta prueba. Cuál de los dos elige el motor depende del orden de
    // entrada de `paradas` (así se resuelve el empate — ver
    // `vecino-cercano.ts`), así que la aserción correcta es sobre el COSTO
    // (el óptimo real, el mismo número que fuerza bruta), no sobre una
    // permutación específica.
    expect(ruta.distanciaTotalM).toBeCloseTo(4887440.065090197, 3);
    expect(new Set(ruta.secuencia.map((p) => p.pedidoId))).toEqual(new Set(['SW', 'SE', 'NE', 'NW']));
    expect(ruta.secuencia[0].pedidoId).toBe('SW'); // la esquina más cercana al origen, sin ambigüedad
  });
});

// =============================================================================
// 2. 2-opt mejora una ruta con un cruce evidente (a nivel de tubería completa)
// =============================================================================

describe('calcularRuta — mejora un cruce evidente del vecino cercano (tubería completa)', () => {
  it('la ruta final es estrictamente mejor que el vecino cercano solo, y sin cruce', async () => {
    const origen = { lat: 0, long: 0 };
    const paradas = [
      { pedidoId: 'P0', lat: -6, long: -6 },
      { pedidoId: 'P1', lat: -6, long: -3 },
      { pedidoId: 'P2', lat: -6, long: 0 },
      { pedidoId: 'P3', lat: -3, long: 6 },
    ];

    const ruta = await calcularRuta({ origen, destino: null, paradas });

    // El vecino cercano solo (sin optimizar) produce ['P2','P1','P0','P3'],
    // con costo verificado en `dos-opt.test.ts` — se reconstruye aquí, sin
    // importar ese archivo, para que esta prueba no dependa de otra.
    const costoVecinoCercanoSolo =
      distanciaEnMetros(origen, { lat: -6, long: 0 }) + // origen -> P2
      distanciaEnMetros({ lat: -6, long: 0 }, { lat: -6, long: -3 }) + // P2 -> P1
      distanciaEnMetros({ lat: -6, long: -3 }, { lat: -6, long: -6 }) + // P1 -> P0
      distanciaEnMetros({ lat: -6, long: -6 }, { lat: -3, long: 6 }); // P0 -> P3

    expect(ruta.distanciaTotalM).toBeLessThan(costoVecinoCercanoSolo);
    expect(ruta.secuencia.map((p) => p.pedidoId)).toEqual(['P3', 'P2', 'P1', 'P0']);
  });
});

// =============================================================================
// 3. Determinismo de punta a punta, incluidos empates exactos
// =============================================================================

describe('calcularRuta — determinismo', () => {
  it('la misma entrada produce siempre la misma salida', async () => {
    const entrada: EntradaRuteo = {
      origen: { lat: -33.45, long: -70.66 },
      destino: { lat: -33.5, long: -70.7 },
      paradas: [
        { pedidoId: 'a1', lat: -33.4, long: -70.6 },
        { pedidoId: 'a2', lat: -33.42, long: -70.62 },
        { pedidoId: 'a3', lat: -33.44, long: -70.58 },
        { pedidoId: 'a4', lat: -33.41, long: -70.65 },
        { pedidoId: 'a5', lat: -33.47, long: -70.61 },
      ],
    };

    const primera = await calcularRuta(entrada);
    for (let i = 0; i < 5; i++) {
      const otra = await calcularRuta(entrada);
      expect(otra).toEqual(primera);
    }
  });

  it('determinismo BAJO EMPATE EXACTO: dos paradas equidistantes del origen no cambian de orden entre corridas', async () => {
    // A y B son reflejo exacto uno del otro respecto a la longitud del
    // origen (misma latitud, longitud opuesta): la distancia haversine
    // resultante es EXACTAMENTE igual, bit a bit — no una aproximación.
    const origen = { lat: -33.45, long: -70.66 };
    const A = { pedidoId: 'A', lat: -33.4, long: -70.6 };
    const B = { pedidoId: 'B', lat: -33.4, long: -70.72 };

    // Confirma la premisa: el empate es real antes de afirmar nada del motor.
    const dA = distanciaEnMetros(origen, { lat: A.lat, long: A.long });
    const dB = distanciaEnMetros(origen, { lat: B.lat, long: B.long });
    expect(dA).toBe(dB);

    const resultados: RutaCalculada[] = [];
    for (let i = 0; i < 10; i++) {
      resultados.push(await calcularRuta({ origen, destino: null, paradas: [A, B] }));
    }
    for (const r of resultados) expect(r).toEqual(resultados[0]);

    // Y, siendo un empate exacto, gana la parada declarada primero en la
    // entrada (A) — coherente con `construirVecinoCercano`.
    expect(resultados[0].secuencia.map((p) => p.pedidoId)).toEqual(['A', 'B']);
  });
});

// =============================================================================
// 4. Pedidos sin coordenada: nunca desaparecen
// =============================================================================

describe('calcularRuta — paradas sin coordenada usable', () => {
  it('lat/long nulos van a sinUbicar, no rompen el cálculo y no aparecen en la secuencia', async () => {
    const origen = { lat: -33.45, long: -70.66 };
    const ruta = await calcularRuta({
      origen,
      destino: null,
      paradas: [
        { pedidoId: 'ok-1', lat: -33.4, long: -70.6 },
        { pedidoId: 'sin-lat', lat: null, long: -70.6 },
        { pedidoId: 'sin-long', lat: -33.4, long: null },
        { pedidoId: 'sin-ambas', lat: null, long: null },
        { pedidoId: 'ok-2', lat: -33.42, long: -70.62 },
      ],
    });

    expect(ruta.secuencia.map((p) => p.pedidoId).sort()).toEqual(['ok-1', 'ok-2']);
    expect(ruta.sinUbicar).toHaveLength(3);
    expect(new Set(ruta.sinUbicar.map((s) => s.pedidoId))).toEqual(
      new Set(['sin-lat', 'sin-long', 'sin-ambas']),
    );
    for (const s of ruta.sinUbicar) expect(s.motivo).toBe('sin_coordenada');
  });

  it('coordenadas "malas" (NaN, infinitas, fuera de rango físico) también van a sinUbicar', async () => {
    const origen = { lat: -33.45, long: -70.66 };
    const ruta = await calcularRuta({
      origen,
      destino: null,
      paradas: [
        { pedidoId: 'ok', lat: -33.4, long: -70.6 },
        { pedidoId: 'nan', lat: NaN, long: -70.6 },
        { pedidoId: 'infinita', lat: -33.4, long: Infinity },
        { pedidoId: 'lat-fuera-de-rango', lat: 200, long: -70.6 },
        { pedidoId: 'long-fuera-de-rango', lat: -33.4, long: -400 },
      ],
    });

    expect(ruta.secuencia.map((p) => p.pedidoId)).toEqual(['ok']);
    expect(ruta.sinUbicar.map((s) => s.pedidoId).sort()).toEqual(
      ['infinita', 'lat-fuera-de-rango', 'long-fuera-de-rango', 'nan'].sort(),
    );
  });

  it('todas las paradas sin coordenada: secuencia vacía, distancia 0, sin explotar', async () => {
    const ruta = await calcularRuta({
      origen: { lat: -33.45, long: -70.66 },
      destino: null,
      paradas: [
        { pedidoId: 'x', lat: null, long: null },
        { pedidoId: 'y', lat: null, long: null },
      ],
    });
    expect(ruta.secuencia).toEqual([]);
    expect(ruta.distanciaTotalM).toBe(0);
    expect(ruta.sinUbicar).toHaveLength(2);
  });

  it('sin paradas en absoluto: secuencia vacía, sin llamar al puerto', async () => {
    let sellamó = false;
    const puertoQueNuncaDebeLlamarse: PuertoMatriz = {
      calcularMatriz: async () => {
        sellamó = true;
        return { distanciaM: () => 0 } as MatrizDistancias;
      },
    };
    const ruta = await calcularRuta(
      { origen: { lat: 0, long: 0 }, destino: null, paradas: [] },
      puertoQueNuncaDebeLlamarse,
    );
    expect(ruta).toEqual({ secuencia: [], sinUbicar: [], distanciaTotalM: 0 });
    expect(sellamó).toBe(false);
  });
});

// =============================================================================
// 5. Validación de entrada: falla fuerte, nunca en silencio
// =============================================================================

describe('calcularRuta — validación de entrada', () => {
  it('rechaza un origen sin coordenada finita, sin filtrar el valor en el mensaje', async () => {
    await expect(
      calcularRuta({ origen: { lat: NaN, long: -70.6 }, destino: null, paradas: [] }),
    ).rejects.toThrow(/el origen no tiene una coordenada válida/);
  });

  it('rechaza un destino sin coordenada finita', async () => {
    await expect(
      calcularRuta({
        origen: { lat: -33.45, long: -70.66 },
        destino: { lat: 999, long: -70.6 },
        paradas: [],
      }),
    ).rejects.toThrow(/el destino no tiene una coordenada válida/);
  });

  it('el mensaje de error de un destino inválido NUNCA incluye lat/long (podría ser el domicilio del conductor)', async () => {
    // Coordenada REALMENTE inválida (fuera del rango físico: lat > 90) — a
    // propósito, no basta con "un número random": si por error se usara una
    // coordenada válida, `calcularRuta` no lanzaría nada y la prueba
    // "pasaría" sin haber verificado nada. Se captura el error explícitamente
    // (no `.rejects.toThrow()`) para poder inspeccionar el mensaje.
    let error: Error | null = null;
    try {
      await calcularRuta({
        origen: { lat: -33.45, long: -70.66 },
        destino: { lat: 999.1234, long: -888.5678 },
        paradas: [],
      });
    } catch (e) {
      error = e as Error;
    }

    // Primero, que de verdad lanzó — y por la razón esperada. Sin esta
    // aserción, un `calcularRuta` que dejara de validar haría que `error`
    // quedara `null` y las dos de abajo pasaran igual, sin haber probado nada.
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/el destino no tiene una coordenada válida/);
    expect(error!.message).not.toContain('999.1234');
    expect(error!.message).not.toContain('-888.5678');
  });

  it('rechaza pedidoId duplicado entre paradas', async () => {
    await expect(
      calcularRuta({
        origen: { lat: -33.45, long: -70.66 },
        destino: null,
        paradas: [
          { pedidoId: 'dup', lat: -33.4, long: -70.6 },
          { pedidoId: 'dup', lat: -33.42, long: -70.62 },
        ],
      }),
    ).rejects.toThrow(/pedidoId duplicado/);
  });
});

// =============================================================================
// 6. La prueba de privacidad — punto de término
// =============================================================================

describe('calcularRuta — privacidad del punto de término', () => {
  it('la FORMA del resultado es idéntica exista o no destino (mismas claves, mismo tipo)', async () => {
    const origen = { lat: 0, long: 0 };
    const paradas = [
      { pedidoId: 'A', lat: 1, long: 1 },
      { pedidoId: 'B', lat: -1, long: 1 },
    ];

    const sinDestino = await calcularRuta({ origen, destino: null, paradas });
    const conDestino = await calcularRuta({ origen, destino: { lat: 1, long: 2 }, paradas });

    expect(Object.keys(sinDestino).sort()).toEqual(Object.keys(conDestino).sort());
    expect(Object.keys(sinDestino).sort()).toEqual(['distanciaTotalM', 'secuencia', 'sinUbicar']);
    for (const item of [...sinDestino.secuencia, ...conDestino.secuencia]) {
      expect(Object.keys(item).sort()).toEqual(['orden', 'pedidoId']);
    }
    // La serialización a JSON tampoco puede colar un campo extra (por si
    // algún día alguien agrega una propiedad no tipada al objeto en runtime).
    expect(Object.keys(JSON.parse(JSON.stringify(conDestino)))).toEqual(
      Object.keys(JSON.parse(JSON.stringify(sinDestino))),
    );
  });

  it('el destino SÍ puede cambiar el orden elegido — es la función completa del parámetro', async () => {
    // A y B equidistantes del origen (empate público exacto: cualquier orden
    // cuesta lo mismo sin destino). Con destino cerca de A, conviene
    // terminar en A: el motor voltea el orden.
    const origen = { lat: 0, long: 0 };
    const A = { pedidoId: 'A', lat: 1, long: 1 };
    const B = { pedidoId: 'B', lat: -1, long: 1 };
    const destinoCercaDeA = { lat: 1, long: 2 };

    const sinDestino = await calcularRuta({ origen, destino: null, paradas: [A, B] });
    const conDestino = await calcularRuta({ origen, destino: destinoCercaDeA, paradas: [A, B] });

    expect(sinDestino.secuencia.map((p) => p.pedidoId)).toEqual(['A', 'B']);
    expect(conDestino.secuencia.map((p) => p.pedidoId)).toEqual(['B', 'A']); // ¡volteó!

    // Y en ESTE caso simétrico particular, `distanciaTotalM` da EXACTAMENTE
    // el mismo número en los dos escenarios — no por casualidad: origen→A→B
    // y origen→B→A cuestan lo mismo cuando A y B son equidistantes del
    // origen. La prueba siguiente cubre el caso general, donde SÍ difieren.
    expect(conDestino.distanciaTotalM).toBe(sinDestino.distanciaTotalM);
  });

  it('cuando distanciaTotalM SÍ difiere entre escenarios, se reconstruye igual en los dos: nunca incluye el tramo al destino', async () => {
    // Caso asimétrico (4 paradas, la geometría de cruce ya usada arriba):
    // un destino cerca de la parada que el motor SIN destino deja primera
    // hace que, CON destino, convenga dejarla última — la secuencia entera
    // se invierte y el total público cambia de verdad.
    const origen = { lat: 0, long: 0 };
    const coords: Record<string, { lat: number; long: number }> = {
      P0: { lat: -6, long: -6 },
      P1: { lat: -6, long: -3 },
      P2: { lat: -6, long: 0 },
      P3: { lat: -3, long: 6 },
    };
    const paradas = Object.entries(coords).map(([pedidoId, c]) => ({ pedidoId, ...c }));
    const destinoCercaDeP3 = { lat: -3, long: 7 };

    const sinDestino = await calcularRuta({ origen, destino: null, paradas });
    const conDestino = await calcularRuta({ origen, destino: destinoCercaDeP3, paradas });

    // Confirma que este caso realmente ejercita la propiedad que se quiere
    // probar (si algún día dejan de diferir, esta aserción avisa primero).
    expect(conDestino.distanciaTotalM).not.toBe(sinDestino.distanciaTotalM);
    expect(conDestino.secuencia.map((p) => p.pedidoId)).not.toEqual(
      sinDestino.secuencia.map((p) => p.pedidoId),
    );

    // La prueba real: reconstruir el costo público de forma INDEPENDIENTE
    // (origen -> primera -> ... -> última, sin tocar `destino` para nada) a
    // partir de la secuencia devuelta, y comprobar que coincide EXACTO con
    // `distanciaTotalM` — en los DOS escenarios. Si el tramo hacia el
    // destino se hubiera colado en el número, esta reconstrucción (que nunca
    // lo suma) fallaría en el caso "conDestino".
    function reconstruirCostoPublico(secuencia: readonly { pedidoId: string }[]): number {
      let total = distanciaEnMetros(origen, coords[secuencia[0].pedidoId]);
      for (let i = 1; i < secuencia.length; i++) {
        total += distanciaEnMetros(
          coords[secuencia[i - 1].pedidoId],
          coords[secuencia[i].pedidoId],
        );
      }
      return total;
    }

    expect(sinDestino.distanciaTotalM).toBeCloseTo(reconstruirCostoPublico(sinDestino.secuencia), 6);
    expect(conDestino.distanciaTotalM).toBeCloseTo(reconstruirCostoPublico(conDestino.secuencia), 6);
  });

  it('el destino nunca aparece, como valor, en ninguna cifra de la salida', async () => {
    // El destino está deliberadamente MUY lejos (una distancia inconfundible,
    // ~1.000 km) para que si se colara en cualquier suma, el número saltaría
    // a un orden de magnitud completamente distinto y evidente.
    const origen = { lat: -33.45, long: -70.66 };
    const paradas = [
      { pedidoId: 'A', lat: -33.4, long: -70.6 },
      { pedidoId: 'B', lat: -33.42, long: -70.62 },
    ];
    const destinoLejísimos = { lat: -10, long: -70.66 }; // ~2.600 km al norte

    const conDestino = await calcularRuta({ origen, destino: destinoLejísimos, paradas });
    const sinDestino = await calcularRuta({ origen, destino: null, paradas });

    // El total con destino no puede ser descabelladamente mayor: si el
    // tramo final (cientos de km) se hubiera sumado, la diferencia sería de
    // ese orden. La diferencia real, si la hay, es solo por reordenamiento
    // entre 2 paradas cercanas — unos pocos km como mucho.
    expect(Math.abs(conDestino.distanciaTotalM - sinDestino.distanciaTotalM)).toBeLessThan(10_000);
  });
});

// =============================================================================
// 7. Puerto inyectable
// =============================================================================

describe('calcularRuta — el puerto es inyectable', () => {
  it('usa el puerto recibido en vez de construir uno por su cuenta', async () => {
    let llamadoCon: readonly PuntoRuteo[] | null = null;
    const puertoFalso: PuertoMatriz = {
      calcularMatriz: async (puntos) => {
        llamadoCon = puntos;
        // Matriz falsa: todo cuesta 1, salvo la diagonal.
        return {
          distanciaM: (a, b) => (a === b ? 0 : 1),
        };
      },
    };

    const ruta = await calcularRuta(
      {
        origen: { lat: 0, long: 0 },
        destino: null,
        paradas: [
          { pedidoId: 'A', lat: 1, long: 1 },
          { pedidoId: 'B', lat: 2, long: 2 },
        ],
      },
      puertoFalso,
    );

    expect(llamadoCon).not.toBeNull();
    expect(llamadoCon!.map((p) => p.id).sort()).toEqual(['A', 'B', '__ruteo_origen__'].sort());
    // Con todo a distancia 1, el total público de 2 paradas es 1+1=2.
    expect(ruta.distanciaTotalM).toBe(2);
  });

  it('sin puerto explícito, usa el adaptador haversine real por defecto', async () => {
    const origen = { lat: -33.45, long: -70.66 };
    const paradas = [{ pedidoId: 'A', lat: -33.4, long: -70.6 }];
    const ruta = await calcularRuta({ origen, destino: null, paradas });
    expect(ruta.distanciaTotalM).toBeCloseTo(distanciaEnMetros(origen, { lat: -33.4, long: -70.6 }), 6);
  });
});

// =============================================================================
// 8. Rendimiento
// =============================================================================

describe('calcularRuta — rendimiento', () => {
  function generarEntrada(n: number, seedBase: number): EntradaRuteo {
    // PRNG determinista (mulberry32): el propio generador de datos de
    // prueba tiene que ser reproducible, o esta prueba deja de ser
    // determinista sin que nadie lo pida.
    let seed = seedBase;
    const rand = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const paradas = Array.from({ length: n }, (_, i) => ({
      pedidoId: `p${i}`,
      lat: -33.4 + (rand() - 0.5) * 0.3,
      long: -70.6 + (rand() - 0.5) * 0.3,
    }));
    return {
      origen: { lat: -33.45, long: -70.66 },
      destino: { lat: -33.5, long: -70.7 },
      paradas,
    };
  }

  it('30 paradas resuelve en milisegundos, no en segundos', async () => {
    const entrada = generarEntrada(30, 12345);
    const inicio = performance.now();
    const ruta = await calcularRuta(entrada);
    const transcurridoMs = performance.now() - inicio;

    expect(ruta.sinUbicar).toEqual([]);
    // Medido en desarrollo: ~6 ms. El umbral (300 ms) deja margen amplio
    // para una máquina de CI más lenta sin dejar de detectar una regresión
    // real (por ejemplo, si alguien quita la evaluación por delta).
    expect(transcurridoMs).toBeLessThan(300);
  });

  it('200 paradas no se cuelga (techo de volumen medido en el plan de la etapa 7)', async () => {
    const entrada = generarEntrada(200, 54321);
    const inicio = performance.now();
    const ruta = await calcularRuta(entrada);
    const transcurridoMs = performance.now() - inicio;

    expect(ruta.sinUbicar).toEqual([]);
    expect(ruta.secuencia).toHaveLength(200);
    // Medido en desarrollo: ~500 ms. 5 s de techo es generoso y, sobre todo,
    // finito — la prueba real es que esto TERMINA, no que sea instantáneo.
    expect(transcurridoMs).toBeLessThan(5_000);
  });

  it('el tope de rondas es finito y razonado (no "hasta que converja" sin límite)', () => {
    expect(TOPE_RONDAS).toBeGreaterThan(0);
    expect(Number.isFinite(TOPE_RONDAS)).toBe(true);
  });
});

// =============================================================================
// 9. Reusa el adaptador real explícitamente (sin pasar por la fábrica/env)
// =============================================================================

describe('calcularRuta — con HaversineMatrizAdapter explícito', () => {
  it('produce el mismo resultado que sin pasar puerto (el default también es haversine)', async () => {
    const entrada: EntradaRuteo = {
      origen: { lat: -33.45, long: -70.66 },
      destino: null,
      paradas: [
        { pedidoId: 'A', lat: -33.4, long: -70.6 },
        { pedidoId: 'B', lat: -33.42, long: -70.62 },
      ],
    };
    const conDefault = await calcularRuta(entrada);
    const conExplicito = await calcularRuta(entrada, new HaversineMatrizAdapter());
    expect(conExplicito).toEqual(conDefault);
  });
});
