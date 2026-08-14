/**
 * Pruebas del orden de paradas.
 *
 * Dos mitades, y la segunda manda sobre la primera:
 * - `ordenarParadasPorComunaYDireccion` — el RESPALDO alfabético (D-04, RF-025).
 * - `ordenarParadasConSecuencia` — la secuencia PERSISTIDA (etapa 7,
 *   `asignaciones_pedido.orden_ruta`), con el alfabético debajo.
 */

import { describe, expect, it } from "vitest";
import {
  ordenarParadasConSecuencia,
  ordenarParadasPorComunaYDireccion,
} from "./orden-paradas";

interface ParadaDePrueba {
  id: string;
  destinatarioComuna: string;
  destinatarioDireccion: string;
}

describe("ordenarParadasPorComunaYDireccion", () => {
  it("ordena por comuna alfabéticamente", () => {
    const pedidos: ParadaDePrueba[] = [
      { id: "1", destinatarioComuna: "Providencia", destinatarioDireccion: "Calle A 100" },
      { id: "2", destinatarioComuna: "Maipú", destinatarioDireccion: "Calle B 200" },
      { id: "3", destinatarioComuna: "Las Condes", destinatarioDireccion: "Calle C 300" },
    ];

    const resultado = ordenarParadasPorComunaYDireccion(pedidos);

    expect(resultado.map((p) => p.id)).toEqual(["3", "2", "1"]);
  });

  it("dentro de la misma comuna ordena por dirección alfabéticamente", () => {
    const pedidos: ParadaDePrueba[] = [
      { id: "1", destinatarioComuna: "Ñuñoa", destinatarioDireccion: "Zenteno 50" },
      { id: "2", destinatarioComuna: "Ñuñoa", destinatarioDireccion: "Avenida Irarrázaval 100" },
      { id: "3", destinatarioComuna: "Ñuñoa", destinatarioDireccion: "Manuel Montt 20" },
    ];

    const resultado = ordenarParadasPorComunaYDireccion(pedidos);

    expect(resultado.map((p) => p.id)).toEqual(["2", "3", "1"]);
  });

  it("compara comunas sin distinguir mayúsculas ni tildes (es, base)", () => {
    const pedidos: ParadaDePrueba[] = [
      { id: "1", destinatarioComuna: "ñuñoa", destinatarioDireccion: "Calle B 2" },
      { id: "2", destinatarioComuna: "Maipu", destinatarioDireccion: "Calle A 1" },
      { id: "3", destinatarioComuna: "Maipú", destinatarioDireccion: "Calle B 2" },
    ];

    const resultado = ordenarParadasPorComunaYDireccion(pedidos);

    // "Maipu" y "Maipú" se tratan como iguales (sensitivity: base) y se
    // ordenan entre sí por dirección; "Ñuñoa" va después.
    expect(resultado.map((p) => p.id)).toEqual(["2", "3", "1"]);
  });

  it("retorna un arreglo vacío si recibe un arreglo vacío", () => {
    expect(ordenarParadasPorComunaYDireccion([])).toEqual([]);
  });

  it("no muta el arreglo original", () => {
    const pedidos: ParadaDePrueba[] = [
      { id: "1", destinatarioComuna: "Providencia", destinatarioDireccion: "Calle A 100" },
      { id: "2", destinatarioComuna: "Maipú", destinatarioDireccion: "Calle B 200" },
    ];
    const copia = [...pedidos];

    ordenarParadasPorComunaYDireccion(pedidos);

    expect(pedidos).toEqual(copia);
  });
});

describe("ordenarParadasConSecuencia", () => {
  // Alfabéticamente sería 2 (Cerrillos) · 3 (Maipú) · 1 (Vitacura). Toda prueba
  // de abajo elige secuencias que NO coinciden con ese orden, para que un
  // respaldo colándose donde manda la secuencia se vea.
  const paradas = [
    { id: "1", destinatarioComuna: "Vitacura", destinatarioDireccion: "Zapadores 1" },
    { id: "2", destinatarioComuna: "Cerrillos", destinatarioDireccion: "Vergara 5" },
    { id: "3", destinatarioComuna: "Maipú", destinatarioDireccion: "Xerox 3" },
  ];

  it("usa la secuencia persistida cuando existe, no el alfabético", () => {
    const orden = new Map([
      ["1", 1],
      ["2", 2],
      ["3", 3],
    ]);

    expect(ordenarParadasConSecuencia(paradas, orden).map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("respeta el orden persistido aunque los números no empiecen en 1 ni sean contiguos", () => {
    // La función SQL siempre escribe 1..N contiguo, pero el consumidor no debe
    // depender de eso: lo que ordena es el valor relativo.
    const orden = new Map([
      ["1", 30],
      ["2", 10],
      ["3", 20],
    ]);

    expect(ordenarParadasConSecuencia(paradas, orden).map((p) => p.id)).toEqual(["2", "3", "1"]);
  });

  it("cae al orden alfabético cuando NINGUNA parada tiene secuencia", () => {
    const orden = new Map<string, number | null>([
      ["1", null],
      ["2", null],
    ]);

    // Idéntico a lo que devuelve el respaldo: un manifiesto sin rutear se ve hoy
    // igual que antes de la etapa 7.
    expect(ordenarParadasConSecuencia(paradas, orden).map((p) => p.id)).toEqual(
      ordenarParadasPorComunaYDireccion(paradas).map((p) => p.id),
    );
  });

  it("cae al alfabético también si el mapa viene vacío", () => {
    expect(ordenarParadasConSecuencia(paradas, new Map()).map((p) => p.id)).toEqual(["2", "3", "1"]);
  });

  it("pone las paradas SIN secuencia al final, entre sí alfabéticamente", () => {
    // Solo la 1 está ruteada: va primera. Las otras dos van después, en orden
    // alfabético (Cerrillos antes que Maipú).
    const orden = new Map<string, number | null>([["1", 1]]);

    expect(ordenarParadasConSecuencia(paradas, orden).map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("nunca descarta una parada sin secuencia — un paquete sin coordenada sigue habiendo que entregarlo", () => {
    const orden = new Map<string, number | null>([["3", 1]]);
    const resultado = ordenarParadasConSecuencia(paradas, orden);

    expect(resultado).toHaveLength(paradas.length);
    expect(resultado.map((p) => p.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("ignora un orden no numérico y lo trata como sin secuencia", () => {
    // Un NaN colado por una serialización rara no debe arrastrar toda la ruta.
    const orden = new Map<string, number | null>([
      ["1", Number.NaN],
      ["2", 1],
    ]);

    expect(ordenarParadasConSecuencia(paradas, orden).map((p) => p.id)).toEqual(["2", "3", "1"]);
  });

  it("desempata un orden repetido por comuna y dirección (determinista pese al empate)", () => {
    // El índice único parcial lo hace imposible en la base, pero un orden no
    // determinista en la pantalla del conductor sería indiagnosticable.
    const orden = new Map([
      ["1", 1],
      ["3", 1],
    ]);

    expect(ordenarParadasConSecuencia(paradas, orden).map((p) => p.id)).toEqual(["3", "1", "2"]);
  });

  it("no muta el arreglo original", () => {
    const copia = [...paradas];
    ordenarParadasConSecuencia(paradas, new Map([["1", 1]]));
    expect(paradas).toEqual(copia);
  });

  it("retorna un arreglo vacío si recibe un arreglo vacío", () => {
    expect(ordenarParadasConSecuencia([], new Map())).toEqual([]);
  });
});
