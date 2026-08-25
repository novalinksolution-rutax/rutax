import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  agruparPorDisponibilidad,
  avisoNoDisponible,
  etiquetaConductor,
  type OpcionConductor,
} from "./disponibilidad";

const C = (p: Partial<OpcionConductor> & { id: string }): OpcionConductor => ({
  nombre: "Conductor",
  disponible: true,
  cargaHoy: 0,
  ...p,
});

describe("agruparPorDisponibilidad", () => {
  it("separa en dos grupos", () => {
    const g = agruparPorDisponibilidad([
      C({ id: "a", nombre: "Ana", disponible: true }),
      C({ id: "b", nombre: "Beto", disponible: false }),
      C({ id: "c", nombre: "Cami", disponible: true }),
    ]);
    expect(g.disponibles.map((c) => c.id)).toEqual(["a", "c"]);
    expect(g.noDisponibles.map((c) => c.id)).toEqual(["b"]);
  });

  it("conserva el orden de entrada dentro de cada grupo", () => {
    // El llamador ya ordenó alfabéticamente. Reordenar acá haría que la lista
    // salte entre renders sin que nadie sepa por qué.
    const g = agruparPorDisponibilidad([
      C({ id: "z", nombre: "Zoe" }),
      C({ id: "a", nombre: "Ana" }),
    ]);
    expect(g.disponibles.map((c) => c.id)).toEqual(["z", "a"]);
  });

  it("con la lista vacía devuelve dos grupos vacíos, no undefined", () => {
    expect(agruparPorDisponibilidad([])).toEqual({ disponibles: [], noDisponibles: [] });
  });

  it("todos no disponibles: el grupo de disponibles queda vacío", () => {
    // Pasa de verdad antes de las 16:00, cuando nadie se ha marcado todavía. El
    // selector no puede reventar ni dibujar un rótulo sobre una lista vacía.
    const g = agruparPorDisponibilidad([C({ id: "a", disponible: false })]);
    expect(g.disponibles).toEqual([]);
    expect(g.noDisponibles).toHaveLength(1);
  });
});

describe("etiquetaConductor", () => {
  it("el disponible lleva su carga y nada más", () => {
    expect(etiquetaConductor(C({ id: "a", nombre: "R. Muñoz", cargaHoy: 12 }))).toBe(
      "R. Muñoz · 12 hoy",
    );
  });

  it("🔴 el NO disponible lo dice en el propio ítem, no solo en el rótulo del grupo", () => {
    // Con el desplegable cerrado el rótulo del grupo ya no está a la vista: si
    // la marca viviera solo ahí, el disparador diría «R. Muñoz · 12 hoy» y el
    // coordinador asignaría sin volver a verla.
    expect(
      etiquetaConductor(C({ id: "a", nombre: "R. Muñoz", cargaHoy: 12, disponible: false })),
    ).toBe("R. Muñoz · 12 hoy · no disponible");
  });

  it("la carga va también en el no disponible", () => {
    // «12 hoy» sobre alguien que no está es justamente el dato que dice cuánto
    // hay que mover si no aparece.
    expect(etiquetaConductor(C({ id: "a", nombre: "X", cargaHoy: 12, disponible: false }))).toContain(
      "12 hoy",
    );
  });
});

describe("avisoNoDisponible", () => {
  const lista = [
    C({ id: "a", nombre: "Ana", disponible: true }),
    C({ id: "b", nombre: "R. Muñoz", disponible: false }),
  ];

  it("sin nadie elegido, no dice nada", () => {
    expect(avisoNoDisponible(lista, null)).toBeNull();
  });

  it("con un disponible elegido, no dice nada", () => {
    expect(avisoNoDisponible(lista, "a")).toBeNull();
  });

  it("con un no disponible elegido, nombra y dice de quién es la marca", () => {
    const aviso = avisoNoDisponible(lista, "b")!;
    expect(aviso).toContain("R. Muñoz");
    // Sin esta parte el coordinador cree que es un estado que él puso mal.
    expect(aviso).toContain("la pone el conductor");
    // Y sin ésta, cree que tiene que arreglarlo antes de poder asignar.
    expect(aviso).toContain("asígnale igual");
  });

  it("con un id que ya no está en la lista, se calla", () => {
    // La lista se recarga; el elegido puede haber desaparecido. Un aviso sobre
    // alguien que no está sería peor que ninguno.
    expect(avisoNoDisponible(lista, "fantasma")).toBeNull();
  });

  it("🔴 no dice «hoy» en ninguna parte", () => {
    // `conductores.disponible` es `default true` y NO hay job que la baje a
    // medianoche: quien se marcó el lunes sigue marcado el martes, y un
    // conductor recién dado de alta nace disponible sin haber abierto la app.
    // Decir «hoy» sería afirmar algo que el dato no sostiene.
    expect(avisoNoDisponible(lista, "b")).not.toMatch(/hoy/i);
  });
});

describe("🔴 el candado del «hoy»", () => {
  it("sigue sin existir un reseteo diario de `disponible`", () => {
    // Si alguien agrega el job de asistencia diaria, esta prueba falla y obliga
    // a volver acá: con reseteo, el copy SÍ puede decir «hoy», y decirlo pasa a
    // ser lo correcto. Sin él, es una mentira.
    const migracion = readFileSync(
      "supabase/migrations/20260613000005_identidad_conductor_disponibilidad_zonas.sql",
      "utf8",
    );
    expect(migracion).toContain("disponible boolean not null default true");
  });
});
