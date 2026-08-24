import { describe, expect, it } from "vitest";

import { filasAAlternar, iniciarBarrido } from "./barrido-seleccion";

const FILAS = ["a", "b", "c", "d", "e", "f"];

/** Simula la pantalla: un conjunto vivo y una API de *alternar*, como la real. */
function pantalla(inicial: string[] = []) {
  const marcadas = new Set(inicial);
  return {
    marcadas,
    estaMarcada: (id: string) => marcadas.has(id),
    alternar: (id: string) => {
      if (marcadas.has(id)) marcadas.delete(id);
      else marcadas.add(id);
    },
  };
}

describe("el sentido lo fija la primera fila", () => {
  it("empezar sobre una sin marcar hace que todo se marque", () => {
    expect(iniciarBarrido(false).objetivo).toBe(true);
  });

  it("empezar sobre una marcada hace que todo se desmarque", () => {
    expect(iniciarBarrido(true).objetivo).toBe(false);
  });

  it("marca lo que le falta y deja en paz lo que ya estaba", () => {
    const p = pantalla(["b"]);
    const b = iniciarBarrido(false);
    const alternar = filasAAlternar(b, FILAS, 0, 2, p.estaMarcada);
    // `b` ya estaba marcada: alternarla la apagaría.
    expect(alternar).toEqual(["a", "c"]);
  });

  it("un barrido que desmarca saca solo lo que toca", () => {
    const p = pantalla(["a", "b", "c", "d"]);
    const b = iniciarBarrido(true);
    expect(filasAAlternar(b, FILAS, 1, 2, p.estaMarcada)).toEqual(["b", "c"]);
  });
});

describe("⚠️ pasar dos veces por la misma fila no la deshace", () => {
  it("el segundo roce no devuelve nada que alternar", () => {
    // Es el caso real: el dedo tiembla o corrige el rumbo. Sin el registro de
    // tocadas, con una API de *alternar*, la fila volvería a su estado anterior
    // y el coordinador perdería pedidos sin darse cuenta.
    const p = pantalla();
    const b = iniciarBarrido(false);

    for (const id of filasAAlternar(b, FILAS, 0, 2, p.estaMarcada)) p.alternar(id);
    expect([...p.marcadas].sort()).toEqual(["a", "b", "c"]);

    const segundoRoce = filasAAlternar(b, FILAS, 2, 0, p.estaMarcada);
    expect(segundoRoce).toEqual([]);
    expect([...p.marcadas].sort()).toEqual(["a", "b", "c"]);
  });

  it("ir y volver por el mismo tramo deja la selección intacta", () => {
    const p = pantalla();
    const b = iniciarBarrido(false);
    for (const id of filasAAlternar(b, FILAS, 0, 5, p.estaMarcada)) p.alternar(id);
    for (const id of filasAAlternar(b, FILAS, 5, 0, p.estaMarcada)) p.alternar(id);
    expect(p.marcadas.size).toBe(6);
  });
});

describe("el tramo, que es lo que salva al barrido rápido", () => {
  it("⚠️ alcanza TODAS las filas del tramo, no solo los extremos", () => {
    // El navegador emite un `pointerenter` cada varios píxeles y se salta filas
    // enteras. Sin el tramo, un barrido rápido deja huecos y el coordinador
    // asigna 24 creyendo que asignó 30.
    const p = pantalla();
    const b = iniciarBarrido(false);
    // El dedo «saltó» de la fila 0 a la 4 sin avisar de las del medio.
    const alternar = filasAAlternar(b, FILAS, 0, 4, p.estaMarcada);
    expect(alternar).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("funciona hacia arriba igual que hacia abajo", () => {
    const p = pantalla();
    const b = iniciarBarrido(false);
    expect(filasAAlternar(b, FILAS, 4, 1, p.estaMarcada)).toEqual(["b", "c", "d", "e"]);
  });

  it("no se sale de la lista aunque los índices se pasen", () => {
    const p = pantalla();
    const b = iniciarBarrido(false);
    expect(filasAAlternar(b, FILAS, -3, 99, p.estaMarcada)).toEqual(FILAS);
  });

  it("un tramo de una sola fila devuelve esa fila", () => {
    const p = pantalla();
    const b = iniciarBarrido(false);
    expect(filasAAlternar(b, FILAS, 2, 2, p.estaMarcada)).toEqual(["c"]);
  });
});
