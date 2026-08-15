/**
 * Pruebas de `distancias-tramo.ts` — el módulo PURO que mide cada tramo de una
 * ruta para que el salto absurdo se VEA (etapa 7 de "retiro en bodega + ruteo").
 *
 * Foco:
 *   1. `puntoUsable`: qué par lat/long es una coordenada real de la esfera.
 *   2. `distanciasPorTramo`: el primer tramo sale del origen; una parada sin
 *      coordenada da tramo `null` y NO rompe la cadena — la siguiente se mide
 *      desde la última parada UBICADA, nunca desde `null` ni "saltando" al
 *      origen otra vez.
 *   3. `totalDistanciaM`: suma los tramos no nulos.
 *   4. La igualdad que sostiene la pantalla en vivo: `totalDistanciaM` sobre
 *      los tramos de este módulo coincide con `distanciaTotalM` del motor
 *      (`costoPublico`) para el MISMO orden — si un día divergen, el total que
 *      se ve mientras el coordinador arrastra paradas deja de coincidir con el
 *      que quedó persistido.
 */
import { describe, expect, it } from "vitest";

import {
  distanciasPorTramo,
  formatearDistancia,
  puntoUsable,
  totalDistanciaM,
  type ParadaConCoordenada,
} from "./distancias-tramo";
import { calcularRuta } from "./ruteo/motor";
import { distanciaEnMetros } from "@/lib/geo/distancia";

// =============================================================================
// puntoUsable
// =============================================================================

describe("puntoUsable", () => {
  it("acepta un par lat/long finito y dentro del rango físico", () => {
    expect(puntoUsable(-33.45, -70.66)).toEqual({ lat: -33.45, long: -70.66 });
  });

  it("acepta los bordes exactos del rango físico", () => {
    expect(puntoUsable(90, 180)).toEqual({ lat: 90, long: 180 });
    expect(puntoUsable(-90, -180)).toEqual({ lat: -90, long: -180 });
  });

  it("null o undefined en cualquiera de los dos → null", () => {
    expect(puntoUsable(null, -70.66)).toBeNull();
    expect(puntoUsable(-33.45, null)).toBeNull();
    expect(puntoUsable(undefined, -70.66)).toBeNull();
    expect(puntoUsable(-33.45, undefined)).toBeNull();
  });

  it("NaN o Infinity → null", () => {
    expect(puntoUsable(NaN, -70.66)).toBeNull();
    expect(puntoUsable(-33.45, Infinity)).toBeNull();
    expect(puntoUsable(-Infinity, -70.66)).toBeNull();
  });

  it("fuera del rango físico universal (no una regla de Chile) → null", () => {
    expect(puntoUsable(200, -70.66)).toBeNull();
    expect(puntoUsable(-33.45, -400)).toBeNull();
    expect(puntoUsable(90.0001, 0)).toBeNull();
  });
});

// =============================================================================
// distanciasPorTramo
// =============================================================================

describe("distanciasPorTramo", () => {
  const origen = { lat: -33.45, long: -70.66 };

  it("el primer tramo se mide desde el origen, no desde null", () => {
    const p1 = { lat: -33.4, long: -70.6 };
    const tramos = distanciasPorTramo(origen, [p1]);
    expect(tramos).toEqual([distanciaEnMetros(origen, p1)]);
  });

  it("devuelve un arreglo del MISMO largo que las paradas, alineado posición a posición", () => {
    const paradas: ParadaConCoordenada[] = [
      { lat: -33.4, long: -70.6 },
      { lat: null, long: null },
      { lat: -33.42, long: -70.62 },
    ];
    const tramos = distanciasPorTramo(origen, paradas);
    expect(tramos).toHaveLength(3);
  });

  it("una parada sin coordenada da tramo null y NO rompe la cadena: la siguiente se mide desde la ÚLTIMA parada UBICADA", () => {
    const p1 = { lat: -33.4, long: -70.6 };
    const p3 = { lat: -33.42, long: -70.62 };
    const paradas: ParadaConCoordenada[] = [p1, { lat: null, long: null }, p3];

    const tramos = distanciasPorTramo(origen, paradas);

    expect(tramos[0]).toBeCloseTo(distanciaEnMetros(origen, p1), 9);
    expect(tramos[1]).toBeNull();
    // La trampa: si el código midiera desde `null` daría NaN; si "saltara" al
    // origen otra vez, este número sería distanciaEnMetros(origen, p3), que es
    // DISTINTO de medir desde p1. Se verifica el número EXACTO esperado (desde
    // p1) y, por contraste, que NO es el número que daría medir desde el origen.
    const desdeUltimaUbicada = distanciaEnMetros(p1, p3);
    const desdeOrigenDeNuevo = distanciaEnMetros(origen, p3);
    expect(desdeUltimaUbicada).not.toBeCloseTo(desdeOrigenDeNuevo, 0);
    expect(tramos[2]).toBeCloseTo(desdeUltimaUbicada, 9);
  });

  it("si la PRIMERA parada no tiene coordenada, la siguiente ubicada se mide desde el origen (el ancla nunca avanzó)", () => {
    const p2 = { lat: -33.4, long: -70.6 };
    const paradas: ParadaConCoordenada[] = [{ lat: null, long: null }, p2];

    const tramos = distanciasPorTramo(origen, paradas);

    expect(tramos[0]).toBeNull();
    expect(tramos[1]).toBeCloseTo(distanciaEnMetros(origen, p2), 9);
  });

  it("varias paradas sin coordenada seguidas: la cadena espera a la próxima ubicada", () => {
    const p1 = { lat: -33.4, long: -70.6 };
    const p5 = { lat: -33.5, long: -70.5 };
    const paradas: ParadaConCoordenada[] = [
      p1,
      { lat: null, long: null },
      { lat: NaN, long: -70.6 },
      { lat: -33.4, long: Infinity },
      p5,
    ];

    const tramos = distanciasPorTramo(origen, paradas);

    expect(tramos[0]).toBeCloseTo(distanciaEnMetros(origen, p1), 9);
    expect(tramos[1]).toBeNull();
    expect(tramos[2]).toBeNull();
    expect(tramos[3]).toBeNull();
    expect(tramos[4]).toBeCloseTo(distanciaEnMetros(p1, p5), 9);
  });

  it("sin paradas: arreglo vacío", () => {
    expect(distanciasPorTramo(origen, [])).toEqual([]);
  });
});

// =============================================================================
// totalDistanciaM
// =============================================================================

describe("totalDistanciaM", () => {
  it("suma los tramos no nulos", () => {
    expect(totalDistanciaM([100, 200, 300])).toBe(600);
  });

  it("un tramo null no rompe la suma ni cuenta como distancia", () => {
    expect(totalDistanciaM([100, null, 300])).toBe(400);
  });

  it("todo null: total 0", () => {
    expect(totalDistanciaM([null, null])).toBe(0);
  });

  it("arreglo vacío: total 0", () => {
    expect(totalDistanciaM([])).toBe(0);
  });
});

// =============================================================================
// formatearDistancia
// =============================================================================

describe("formatearDistancia", () => {
  it("null o no finito → guion largo", () => {
    expect(formatearDistancia(null)).toBe("—");
    expect(formatearDistancia(NaN)).toBe("—");
    expect(formatearDistancia(Infinity)).toBe("—");
  });

  it("bajo el kilómetro: metros redondeados", () => {
    expect(formatearDistancia(432.6)).toBe("433 m");
    expect(formatearDistancia(0)).toBe("0 m");
  });

  it("sobre el kilómetro: km con un decimal y coma chilena", () => {
    expect(formatearDistancia(12_400)).toBe("12,4 km");
  });
});

// =============================================================================
// La igualdad con el motor — lo que permite el total en vivo sin recalcular
// =============================================================================

describe("distanciasPorTramo + totalDistanciaM ATADO a distanciaTotalM del motor", () => {
  it("para el MISMO orden, el total de los tramos coincide con distanciaTotalM (costoPublico)", async () => {
    const origen = { lat: -33.45, long: -70.66 };
    const paradasEntrada = [
      { pedidoId: "a1", lat: -33.4, long: -70.6 },
      { pedidoId: "a2", lat: -33.42, long: -70.62 },
      { pedidoId: "a3", lat: -33.44, long: -70.58 },
      { pedidoId: "a4", lat: -33.41, long: -70.65 },
      { pedidoId: "a5", lat: -33.47, long: -70.61 },
    ];

    const ruta = await calcularRuta({ origen, destino: null, paradas: paradasEntrada });

    // Reconstruye, EN EL ORDEN que devolvió el motor, la lista de coordenadas
    // que consumiría la pantalla — exactamente lo que haría el panel de ruta al
    // recalcular tramos en vivo mientras el coordinador arrastra.
    const porId = new Map(paradasEntrada.map((p) => [p.pedidoId, p]));
    const paradasEnOrden: ParadaConCoordenada[] = ruta.secuencia.map((s) => {
      const p = porId.get(s.pedidoId)!;
      return { lat: p.lat, long: p.long };
    });

    const tramos = distanciasPorTramo(origen, paradasEnOrden);
    const total = totalDistanciaM(tramos);

    expect(total).toBeCloseTo(ruta.distanciaTotalM, 6);
  });

  it("la igualdad se sostiene también cuando hay paradas sin coordenada (sinUbicar no entra a la reconstrucción)", async () => {
    const origen = { lat: -33.45, long: -70.66 };
    const paradasEntrada = [
      { pedidoId: "ok-1", lat: -33.4, long: -70.6 },
      { pedidoId: "sin-coord", lat: null, long: null },
      { pedidoId: "ok-2", lat: -33.42, long: -70.62 },
    ];

    const ruta = await calcularRuta({ origen, destino: null, paradas: paradasEntrada });
    expect(ruta.sinUbicar).toHaveLength(1); // confirma la premisa del caso

    const porId = new Map(paradasEntrada.map((p) => [p.pedidoId, p]));
    const paradasEnOrden: ParadaConCoordenada[] = ruta.secuencia.map((s) => {
      const p = porId.get(s.pedidoId)!;
      return { lat: p.lat, long: p.long };
    });

    const total = totalDistanciaM(distanciasPorTramo(origen, paradasEnOrden));
    expect(total).toBeCloseTo(ruta.distanciaTotalM, 6);
  });
});
