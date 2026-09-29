/**
 * La RLS de escritura de tarifas, zonas y comunas de zona debe seguir a la
 * matriz de TypeScript.
 *
 * La migración `20260929000001_identidad_tarifas_zonas_escritura_por_rol.sql`
 * escribe a mano la lista de roles que pueden escribir esas tablas, y esa lista
 * tiene que ser exactamente la de los roles con `gestionar_tarifas` en
 * `MATRIZ_ROL_CAPACIDADES`. Si alguien le da o le quita la capacidad a un rol en
 * TypeScript sin tocar la base, esta prueba falla: o la pantalla le muestra un
 * botón que la base va a rechazar, o la base deja escribir a quien la app ya no
 * deja.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capacidadesDeRol } from "./capacidades";
import { ROLES } from "./roles";

const MIGRACION = join(
  process.cwd(),
  "supabase/migrations/20260929000001_identidad_tarifas_zonas_escritura_por_rol.sql",
);

/** Cada `claim_rol() in (...)` de la migración, como conjunto de roles. */
function listasDeRolesEnLaMigracion(): string[][] {
  const sql = readFileSync(MIGRACION, "utf8")
    // Los comentarios no cuentan: solo las políticas.
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("--"))
    .join("\n");
  return [...sql.matchAll(/claim_rol\(\)\s+in\s+\(([^)]*)\)/g)].map((m) =>
    m[1]
      .split(",")
      .map((r) => r.trim().replace(/^'|'$/g, ""))
      .sort(),
  );
}

describe("RLS de tarifas y zonas ↔ matriz de capacidades", () => {
  const esperados = ROLES.filter((rol) => capacidadesDeRol(rol).includes("gestionar_tarifas"))
    .map(String)
    .sort();

  it("la matriz le da gestionar_tarifas al menos a un rol (si no, la prueba no probaría nada)", () => {
    expect(esperados.length).toBeGreaterThan(0);
  });

  it("todas las políticas de la migración nombran exactamente los roles con gestionar_tarifas", () => {
    const listas = listasDeRolesEnLaMigracion();
    // 2 en tarifas, 2 en zonas y 3 en zona_comunas, por cláusula USING/WITH CHECK.
    expect(listas.length).toBeGreaterThanOrEqual(7);
    for (const lista of listas) {
      expect(lista).toEqual(esperados);
    }
  });
});
