/**
 * Ata el catálogo de TypeScript a los CHECK de la migración (mismo patrón que
 * `conciliacion-tipos-sql.test.ts`): una lista que cambia solo de un lado hace
 * fallar esta prueba. Compara conjuntos exactos, nunca conteos.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CONDUCTORES_OPCIONES,
  ENVIOS_DIA_OPCIONES,
  FUENTES_PEDIDOS_OPCIONES,
  FUENTE_OTRA_MAX,
  validarPerfilComercial,
} from "./perfil-comercial";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");

/** Concatena todas las migraciones que tocan la tabla; la ÚLTima definición manda. */
function sqlDeLaTabla(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(path.join(DIR, f), "utf8"))
    .filter((s) => s.includes("courier_perfil_comercial"));
}

function literales(bloque: string): string[] {
  return [...bloque.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Último `add constraint <nombre> check (...)` en orden de migración. */
function ultimoCheck(nombre: string): string {
  const patron = new RegExp(`add\\s+constraint\\s+${nombre}\\s+check\\s*\\(([\\s\\S]*?)\\)\\s*;`, "gi");
  let ultimo: string | null = null;
  for (const sql of sqlDeLaTabla()) {
    for (const m of sql.matchAll(patron)) ultimo = m[1];
  }
  if (!ultimo) throw new Error(`No se encontró el CHECK ${nombre} en las migraciones.`);
  return ultimo;
}

const ordenado = (xs: readonly string[]) => [...xs].sort();

describe("perfil comercial: catálogo vs CHECK de la base", () => {
  it("envios_dia_rango", () => {
    expect(ordenado(literales(ultimoCheck("courier_perfil_comercial_envios_dia_rango_valido")))).toEqual(
      ordenado(ENVIOS_DIA_OPCIONES.map((o) => o.valor)),
    );
  });

  it("conductores_rango", () => {
    expect(ordenado(literales(ultimoCheck("courier_perfil_comercial_conductores_rango_valido")))).toEqual(
      ordenado(CONDUCTORES_OPCIONES.map((o) => o.valor)),
    );
  });

  it("fuentes_pedidos", () => {
    expect(ordenado(literales(ultimoCheck("courier_perfil_comercial_fuentes_pedidos_validas")))).toEqual(
      ordenado(FUENTES_PEDIDOS_OPCIONES.map((o) => o.valor)),
    );
  });

  it("el largo máximo de «otra» coincide con el CHECK", () => {
    expect(ultimoCheck("courier_perfil_comercial_fuente_otra_coherente")).toContain(
      `char_length(fuente_otra) <= ${FUENTE_OTRA_MAX}`,
    );
  });
});

describe("validarPerfilComercial", () => {
  const base = { enviosDiaRango: "100_300", conductoresRango: "6_15", fuentesPedidos: ["shopify"], fuenteOtra: "x" };

  it("acepta y descarta el texto si no hay «otra»", () => {
    const r = validarPerfilComercial(base);
    expect(r.ok && r.perfil.fuenteOtra).toBeNull();
  });
  it("exige texto con «otra» y lo recorta", () => {
    expect(validarPerfilComercial({ ...base, fuentesPedidos: ["otra"], fuenteOtra: "  " }).ok).toBe(false);
    const r = validarPerfilComercial({ ...base, fuentesPedidos: ["otra"], fuenteOtra: " Bsale " });
    expect(r.ok && r.perfil.fuenteOtra).toBe("Bsale");
  });
  it("rechaza valores fuera de lista, vacío y más de 80", () => {
    expect(validarPerfilComercial({ ...base, enviosDiaRango: "x" }).ok).toBe(false);
    expect(validarPerfilComercial({ ...base, conductoresRango: "" }).ok).toBe(false);
    expect(validarPerfilComercial({ ...base, fuentesPedidos: [] }).ok).toBe(false);
    expect(validarPerfilComercial({ ...base, fuentesPedidos: ["nada"] }).ok).toBe(false);
    expect(validarPerfilComercial({ ...base, fuentesPedidos: ["otra"], fuenteOtra: "a".repeat(81) }).ok).toBe(false);
  });
});
