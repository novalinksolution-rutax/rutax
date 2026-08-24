import { describe, it, expect } from "vitest";
import { loQueVeElSeller } from "./vista-seller-periodo";
import type { EstadoPeriodo } from "./tipos";

const ESTADOS: EstadoPeriodo[] = ["abierto", "cerrado", "facturado", "anulado"];

describe("loQueVeElSeller", () => {
  it("responde para los cuatro estados, sin huecos", () => {
    // Sin esto, agregar un quinto estado devolvería `undefined` y la pantalla
    // reventaría al leer `.ve` — en el bloque que dice qué ve la contraparte.
    for (const estado of ESTADOS) {
      const r = loQueVeElSeller(estado);
      expect(r.ve.length, `falta la frase de ${estado}`).toBeGreaterThan(10);
    }
  });

  it("dice que el período ABIERTO ya es visible", () => {
    // Es lo que sorprende y por lo que existe el bloque: el seller ve el
    // período desde el primer día, no desde el cierre.
    const r = loQueVeElSeller("abierto");
    expect(r.ve).toContain("Ya lo ve");
    expect(r.noVe).toContain("excepciones");
  });

  it("nombra el folio cuando lo hay", () => {
    expect(loQueVeElSeller("facturado", { folio: 1042 }).ve).toContain("1042");
  });

  it("sin folio todavía, no lo inventa", () => {
    const r = loQueVeElSeller("facturado", { folio: null });
    expect(r.ve).not.toMatch(/folio \d/);
    expect(r.ve).toContain("Lo ve facturado");
  });

  it("declara que el PDF aún no está cuando no hay documento", () => {
    expect(loQueVeElSeller("facturado", { folio: 1042, tieneDocumento: false }).noVe).toContain(
      "PDF",
    );
    expect(loQueVeElSeller("facturado", { folio: 1042, tieneDocumento: true }).noVe).toBeNull();
  });

  it("en el anulado aclara que el motivo interno no se comparte", () => {
    // Regla del producto: el motivo que escribe el courier es de su bitácora.
    // Decirlo acá evita que alguien escriba el motivo pensando en el seller.
    expect(loQueVeElSeller("anulado").noVe).toContain("motivo");
  });
});
