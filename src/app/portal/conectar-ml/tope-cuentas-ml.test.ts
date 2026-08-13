/**
 * El tope de cuentas ML vive en DOS mitades, y esta prueba las ata.
 * =====================================================================
 * El límite duro lo impone Postgres —
 * `identidad.conexiones_seller_ml_tope_por_seller()`, leída por el trigger
 * `trg_conexiones_seller_ml_imponer_tope` en cada INSERT— pero la interfaz del
 * portal decide con `MAX_CUENTAS_ML` (`./compartido`), que NO es copy: gobierna
 * si se renderiza el botón "Agregar otra cuenta" (`panel-conexion-ml.tsx:347`)
 * y el aviso de límite alcanzado (`:363`).
 *
 * Si las dos mitades se separan, nada explota — se degrada en silencio, y en la
 * dirección que toque:
 *   - TypeScript por debajo del SQL → el portal esconde el botón antes de
 *     tiempo y el seller no puede conectar cuentas que la base sí aceptaría.
 *     Es el modo que ya ocurrió: el tope real subió de 3 a 10 porque un courier
 *     trajo un seller con 4 cuentas vinculadas.
 *   - TypeScript por encima del SQL → el portal ofrece el botón, el seller
 *     recorre el OAuth entero en Mercado Libre y recién al volver se lleva el
 *     rechazo del trigger (23514 → `tope_alcanzado`).
 *
 * El comentario de `compartido.ts` ya declaraba que ambos valores deben
 * coincidir; hasta ahora eso descansaba en disciplina y no había prueba que lo
 * sostuviera. Cambiar el tope es cambiar los dos lugares, y esta prueba falla
 * si solo se cambia uno.
 *
 * No necesita base de datos: lee el SQL versionado, que es la fuente de verdad
 * de lo que se aplica en cualquier entorno.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MAX_CUENTAS_ML } from "./compartido";

const DIRECTORIO_MIGRACIONES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/migrations",
);

/**
 * La función es `language sql immutable` con cuerpo `$$ select N $$` — su forma
 * desde que se creó (`20260630000002`) y la que conserva el cambio a 10
 * (`20260812000003`). El `[\s\S]*?` es perezoso a propósito: toma el primer
 * cuerpo que sigue a la firma, no el de una función declarada más abajo.
 */
const PATRON_DEFINICION_TOPE =
  /create\s+or\s+replace\s+function\s+identidad\.conexiones_seller_ml_tope_por_seller\s*\(\s*\)[\s\S]*?\$\$\s*select\s+(\d+)\s*\$\$/gi;

interface DefinicionTope {
  archivo: string;
  valor: number;
}

/**
 * Todas las definiciones del tope, en orden de aplicación. El nombre de archivo
 * de una migración empieza por su timestamp, así que el orden lexicográfico ES
 * el orden cronológico: la última del arreglo es la que queda vigente tras
 * aplicar la carpeta completa, exactamente como haría Postgres con sucesivos
 * `create or replace`.
 */
function definicionesDelTope(): DefinicionTope[] {
  const definiciones: DefinicionTope[] = [];

  for (const archivo of readdirSync(DIRECTORIO_MIGRACIONES).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(DIRECTORIO_MIGRACIONES, archivo), "utf8");
    for (const coincidencia of sql.matchAll(PATRON_DEFINICION_TOPE)) {
      definiciones.push({ archivo, valor: Number(coincidencia[1]) });
    }
  }

  return definiciones;
}

describe("tope de cuentas ML: TypeScript y SQL no pueden divergir", () => {
  /**
   * Guardia del propio patrón, y va primero por eso: una prueba que busca con
   * expresión regular puede volverse no-op sin avisar si el estilo del SQL
   * cambia (a `language plpgsql`, a `return 10;`, a una tabla de configuración).
   * Sin esta aserción, la comparación de abajo pasaría por vacuidad y el
   * proyecto creería tener una red que ya no existe.
   */
  it("encuentra la definición del tope en las migraciones", () => {
    const definiciones = definicionesDelTope();

    expect(
      definiciones.length,
      "No se encontró ninguna definición de identidad.conexiones_seller_ml_tope_por_seller() " +
        "con la forma `$$ select N $$`. O la función se movió/renombró, o cambió de estilo. " +
        "Actualiza PATRON_DEFINICION_TOPE en esta prueba — no la borres: es lo único que ata " +
        "el tope de la interfaz con el que impone la base.",
    ).toBeGreaterThan(0);
  });

  it("el tope vigente en SQL coincide con MAX_CUENTAS_ML", () => {
    const definiciones = definicionesDelTope();
    const vigente = definiciones.at(-1);

    expect(vigente).toBeDefined();
    expect(
      vigente!.valor,
      `MAX_CUENTAS_ML vale ${MAX_CUENTAS_ML} en conectar-ml/compartido.ts, pero la migración ` +
        `${vigente!.archivo} deja el tope de la base en ${vigente!.valor}. Cambiar el tope exige ` +
        "tocar LAS DOS mitades: la función SQL y la constante de TypeScript, que decide si el " +
        "portal muestra el botón de agregar cuenta.",
    ).toBe(MAX_CUENTAS_ML);
  });
});
