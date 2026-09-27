import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Radix lanza «A <Select.Item /> must have a value prop that is not an empty
 * string» al abrir un Select con un `SelectItem value=""`, y el error tumba la
 * pantalla entera. Pasó en la hora de corte del seller (2026-09-27): solo se
 * veía con zonas configuradas, así que ninguna demo lo mostró.
 *
 * La opción «ninguno/todos» va como centinela (p. ej. `"__todas__"`).
 */
function archivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosTsx(ruta);
    return ruta.endsWith(".tsx") ? [ruta] : [];
  });
}

describe("SelectItem sin valor vacío", () => {
  it("ningún SelectItem usa value=\"\"", () => {
    const culpables = archivosTsx(join(__dirname, "../..")).filter((f) =>
      /<SelectItem[^>]*\bvalue=(""|\{""\}|\{''\})/.test(readFileSync(f, "utf8")),
    );
    expect(culpables).toEqual([]);
  });
});
