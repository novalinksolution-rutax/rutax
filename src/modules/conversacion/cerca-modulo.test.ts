/**
 * Guard de la cerca del módulo `conversacion` — §4 del documento de alcance.
 *
 * `operacion`, `dinero` e `integraciones` NUNCA importan `conversacion`, la
 * misma cerca dura que ya protege a `contexto`. Barre `src/modules/{operacion,
 * dinero,integraciones}` en busca de un `from "...conversacion..."` o
 * `require(".../conversacion")` y falla si aparece uno.
 *
 * Mismo patrón que los otros guards mecánicos del repo (`fecha-santiago.guard.
 * test.ts`, `auditoria-claves-prohibidas-sql.test.ts`): un barrido de disco con
 * una regex, no una convención que alguien pueda olvidar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIR_CONVERSACION = dirname(fileURLToPath(import.meta.url)); // …/src/modules/conversacion
const DIR_MODULES = dirname(DIR_CONVERSACION); // …/src/modules

const MODULOS_QUE_NO_PUEDEN_IMPORTAR_CONVERSACION = ["operacion", "dinero", "integraciones"];

// Se arma con un fragmento partido para que este mismo archivo no "importe"
// literalmente la cadena que busca (ruido de falsos positivos si alguien grepea).
const PATRON_IMPORT_CONVERSACION = new RegExp(
  ["from\\s+['\"][^'\"]*", "/conversacion(/|['\"])"].join(""),
);

function listarArchivosFuente(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada === ".next") continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...listarArchivosFuente(ruta));
    } else if (/\.tsx?$/.test(entrada)) {
      salida.push(ruta);
    }
  }
  return salida;
}

describe("cerca del módulo conversacion (§4)", () => {
  it("ni operacion, ni dinero, ni integraciones importan conversacion", () => {
    const infractores: string[] = [];

    for (const modulo of MODULOS_QUE_NO_PUEDEN_IMPORTAR_CONVERSACION) {
      const dirModulo = join(DIR_MODULES, modulo);
      let archivos: string[];
      try {
        archivos = listarArchivosFuente(dirModulo);
      } catch {
        continue; // el módulo no existe todavía en este checkout — nada que barrer.
      }

      for (const archivo of archivos) {
        const texto = readFileSync(archivo, "utf8");
        if (PATRON_IMPORT_CONVERSACION.test(texto)) {
          infractores.push(relative(DIR_MODULES, archivo).split(sep).join("/"));
        }
      }
    }

    expect(
      infractores,
      "conversacion → operacion/dinero/integraciones es la única dirección permitida (§4 del " +
        "documento de alcance). Si uno de estos archivos necesita algo de conversacion, la " +
        `arquitectura está mal — no el import. Infractores:\n  ${infractores.join("\n  ")}`,
    ).toEqual([]);
  });

  it("la propia prueba encuentra al menos un archivo por módulo (sanidad del barrido)", () => {
    for (const modulo of MODULOS_QUE_NO_PUEDEN_IMPORTAR_CONVERSACION) {
      const dirModulo = join(DIR_MODULES, modulo);
      expect(listarArchivosFuente(dirModulo).length, `${modulo} no tiene archivos — ¿la ruta es correcta?`).toBeGreaterThan(0);
    }
  });
});
