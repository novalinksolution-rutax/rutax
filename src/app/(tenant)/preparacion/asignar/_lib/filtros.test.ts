import { describe, expect, it } from "vitest";
import {
  hayFiltrosActivos,
  normalizarComunas,
  normalizarEstado,
  normalizarPagina,
  normalizarTexto,
} from "./filtros";

describe("normalizarComunas", () => {
  it("sin parámetro → arreglo vacío", () => {
    expect(normalizarComunas(undefined)).toEqual([]);
  });

  it("el enlace profundo por comuna (§2.2) llega como string suelto, no arreglo", () => {
    expect(normalizarComunas("Ñuñoa")).toEqual(["Ñuñoa"]);
  });

  it("la multi-selección real llega como arreglo (Next ya la entrega así)", () => {
    expect(normalizarComunas(["Ñuñoa", "Providencia"])).toEqual(["Ñuñoa", "Providencia"]);
  });

  it("quita vacíos y duplicados", () => {
    expect(normalizarComunas(["Ñuñoa", "", "Ñuñoa", "  "])).toEqual(["Ñuñoa"]);
  });
});

describe("normalizarEstado", () => {
  it("sin parámetro → null (Todos)", () => {
    expect(normalizarEstado(undefined)).toBeNull();
  });

  it("acepta los dos valores reales del enum", () => {
    expect(normalizarEstado("pendiente_asignacion")).toBe("pendiente_asignacion");
    expect(normalizarEstado("asignado")).toBe("asignado");
  });

  it("un valor que no es ninguno de los dos reales cae a null, nunca revienta el filtro", () => {
    expect(normalizarEstado("cancelado")).toBeNull();
    expect(normalizarEstado("cualquier-cosa")).toBeNull();
  });
});

describe("normalizarPagina", () => {
  it("sin parámetro → 1", () => {
    expect(normalizarPagina(undefined)).toBe(1);
  });

  it("un número válido se respeta", () => {
    expect(normalizarPagina("3")).toBe(3);
  });

  it("0, negativos o texto no numérico caen a 1, nunca revientan la paginación", () => {
    expect(normalizarPagina("0")).toBe(1);
    expect(normalizarPagina("-5")).toBe(1);
    expect(normalizarPagina("abc")).toBe(1);
  });
});

describe("normalizarTexto", () => {
  it("vacío o solo espacios se homologa a null", () => {
    expect(normalizarTexto(undefined)).toBeNull();
    expect(normalizarTexto("   ")).toBeNull();
  });

  it("recorta espacios sobrantes", () => {
    expect(normalizarTexto("  44760788901  ")).toBe("44760788901");
  });
});

describe("hayFiltrosActivos", () => {
  it("false cuando los cuatro están en su valor neutro", () => {
    expect(hayFiltrosActivos({ comunas: [], sellerId: null, texto: null, estado: null })).toBe(false);
  });

  it("true si cualquiera de los cuatro está activo", () => {
    expect(hayFiltrosActivos({ comunas: ["Ñuñoa"], sellerId: null, texto: null, estado: null })).toBe(true);
    expect(hayFiltrosActivos({ comunas: [], sellerId: "seller-1", texto: null, estado: null })).toBe(true);
    expect(hayFiltrosActivos({ comunas: [], sellerId: null, texto: "123", estado: null })).toBe(true);
    expect(hayFiltrosActivos({ comunas: [], sellerId: null, texto: null, estado: "asignado" })).toBe(true);
  });
});
