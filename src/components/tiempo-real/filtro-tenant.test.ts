import { describe, expect, it } from "vitest";

import { filtroTenant, tenantIdEsUsable } from "./filtro-tenant";

const BUENO = "10000000-0000-0000-0000-000000000001";

describe("el filtro de tenant de Realtime", () => {
  it("acepta un uuid, en minúsculas o mayúsculas", () => {
    expect(tenantIdEsUsable(BUENO)).toBe(true);
    expect(tenantIdEsUsable(BUENO.toUpperCase())).toBe(true);
    expect(filtroTenant(BUENO)).toBe(`tenant_id=eq.${BUENO}`);
  });

  it("⚠️ rechaza la cadena «null», que es la que tumbó el tiempo real", () => {
    // El filtro viaja como texto: `tenant_id=eq.${tenantId}` con un nulo produce
    // literalmente «tenant_id=eq.null». Del otro lado, walrus lo castea a uuid,
    // revienta, y **se lleva el lote de cambios de TODOS los suscriptores**.
    expect(tenantIdEsUsable("null")).toBe(false);
    expect(filtroTenant("null")).toBeNull();
  });

  it("rechaza «undefined», que es el mismo accidente con otra palabra", () => {
    expect(filtroTenant("undefined")).toBeNull();
  });

  it("rechaza el nulo y el indefinido de verdad", () => {
    expect(filtroTenant(null)).toBeNull();
    expect(filtroTenant(undefined)).toBeNull();
    expect(filtroTenant("")).toBeNull();
    expect(filtroTenant("   ")).toBeNull();
  });

  it("⚠️ un `if (!tenantId)` NO habría bastado", () => {
    // Es el punto entero de validar la forma y no la ausencia: las tres cadenas
    // de abajo son verdaderas, así que un guardia de falsedad las deja pasar y
    // el error ocurre igual.
    for (const enganosa of ["null", "undefined", "NaN"]) {
      expect([enganosa, Boolean(enganosa)]).toEqual([enganosa, true]);
      expect([enganosa, filtroTenant(enganosa)]).toEqual([enganosa, null]);
    }
  });

  it("rechaza un uuid truncado o con basura alrededor", () => {
    expect(filtroTenant(BUENO.slice(0, 20))).toBeNull();
    expect(filtroTenant(`${BUENO}'; drop table pedidos; --`)).toBeNull();
  });

  it("tolera espacios alrededor, que es lo único que sí se puede salvar", () => {
    expect(filtroTenant(` ${BUENO} `)).toBe(`tenant_id=eq.${BUENO}`);
  });
});
