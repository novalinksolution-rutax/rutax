import { describe, it, expect } from "vitest";
import { CAPACIDADES } from "./capacidades";
import { FRASE_CAPACIDAD, compararRoles, describirRol } from "./capacidades-legibles";

describe("FRASE_CAPACIDAD", () => {
  it("cubre TODAS las capacidades del catálogo, sin faltar ninguna", () => {
    // Sin esto, agregar una capacidad al catálogo la haría aparecer en el
    // diálogo de cambio de rol como `gestionar_bodegas` a secas, en medio de
    // una lista escrita en castellano. El tipo `Record<Capacidad, string>` ya lo
    // impide al compilar; esto lo deja dicho por si el tipo se afloja.
    const sinFrase = CAPACIDADES.filter((c) => !FRASE_CAPACIDAD[c]);
    expect(sinFrase).toEqual([]);
    // El número no se clava: agregar una capacidad es normal; dejarla sin
    // frase, no. Lo que se comprueba es la cobertura.
    expect(CAPACIDADES.length).toBeGreaterThanOrEqual(33);
  });

  it("las frases son acciones, no rótulos de permiso", () => {
    // «Emitir facturas al SII», no «Permiso de emisión». Quien lee esto está
    // decidiendo qué va a hacer otra persona mañana.
    for (const c of CAPACIDADES) {
      expect(FRASE_CAPACIDAD[c].length, c).toBeGreaterThan(8);
      expect(FRASE_CAPACIDAD[c].toLowerCase(), c).not.toContain("permiso");
    }
  });
});

describe("compararRoles", () => {
  it("de coordinador a supervisor: gana, no pierde", () => {
    const r = compararRoles("coordinador", "supervisor");
    expect(r.gana.length).toBeGreaterThan(0);
    expect(r.pierde).toEqual([]);
  });

  it("de supervisor a coordinador: pierde lo que el otro no tiene", () => {
    const r = compararRoles("supervisor", "coordinador");
    expect(r.pierde.length).toBeGreaterThan(0);
    expect(r.pierde).toContain(FRASE_CAPACIDAD.gestionar_incidencias);
  });

  it("las tres listas son disjuntas y ninguna repite una frase", () => {
    // Si una capacidad apareciera en dos, el diálogo diría que se pierde y se
    // gana a la vez.
    const r = compararRoles("administracion", "supervisor");
    const todas = [...r.pierde, ...r.gana, ...r.sigueSinTener];
    expect(new Set(todas).size).toBe(todas.length);
  });

  it("lo que los DOS roles tienen no aparece en ninguna lista", () => {
    // `asignar_y_reasignar_pedidos` la tienen supervisor y coordinador: no se
    // pierde, no se gana, y decir que «sigue sin tenerla» sería falso.
    const r = compararRoles("supervisor", "coordinador");
    const todas = [...r.pierde, ...r.gana, ...r.sigueSinTener];
    expect(todas).not.toContain(FRASE_CAPACIDAD.asignar_y_reasignar_pedidos);
  });

  it("el mismo rol contra sí mismo no pierde ni gana nada", () => {
    const r = compararRoles("supervisor", "supervisor");
    expect(r.pierde).toEqual([]);
    expect(r.gana).toEqual([]);
  });

  it("`sigueSinTener` incluye lo que ninguno de los dos tiene", () => {
    // Es la lista que cierra la pregunta «¿y esto otro?». Un coordinador que
    // pasa a supervisor sigue sin poder emitir facturas, y hay que decirlo.
    const r = compararRoles("coordinador", "supervisor");
    expect(r.sigueSinTener).toContain(FRASE_CAPACIDAD.emitir_facturas);
  });
});

describe("describirRol", () => {
  it("describe cada rol interno sin quedar vacío", () => {
    for (const rol of ["dueno", "administracion", "supervisor", "coordinador"] as const) {
      expect(describirRol(rol).length, rol).toBeGreaterThan(15);
    }
  });

  it("no enumera las veintiuna del dueño: resume y dice cuántas quedan", () => {
    // Enumerarlas todas no describe nada. La frase corta más el resto contado
    // sí: dice de qué se trata el rol y que hay más.
    expect(describirRol("dueno")).toMatch(/y \d+ cosas más\.$/);
  });
});
