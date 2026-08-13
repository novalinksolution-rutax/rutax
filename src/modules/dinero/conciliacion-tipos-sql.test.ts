/**
 * Los tipos de diferencia viven en DOS listas, y esta prueba las ata.
 * =====================================================================
 * `dinero.eventos_conciliacion.tipo_diferencia` es `text` + CHECK
 * (`eventos_conciliacion_tipo_valido`), no un enum — decisión ya documentada en
 * las migraciones. La consecuencia práctica es que **cada migración que agrega
 * un tipo tiene que reponer la lista COMPLETA**, y ahí está la trampa: se copia
 * la lista anterior, se agrega el tipo nuevo al final, y si la copia venía de
 * una versión vieja, un tipo desaparece sin que nada avise.
 *
 * Pasó de verdad. `20260811000002` agregó `linea_liquidacion_sin_pedido_entregado`
 * (16 tipos); al día siguiente `20260812000001` repuso la lista para agregar el
 * suyo, copió la versión ANTERIOR al 11-ago, y el tipo del día antes se perdió.
 * Nada falló al migrar: el CHECK quedó bien formado, solo que sin ese valor.
 * Lo que se rompió fue en ejecución — `jobs/generar-lineas.ts` emite ese tipo
 * con `bloquea_pago = true` cuando a un conductor se le emitió o pagó la
 * liquidación de una entrega que después se canceló, el INSERT choca contra el
 * CHECK con 23514, y el writer lanza dentro de un `step.run`. O sea: el
 * mecanismo que impide pagar una entrega que no ocurrió se caía justo cuando
 * tenía que actuar.
 *
 * El repo ya había aprendido la mitad de esta lección. `TIPOS_DIFERENCIA_CONCILIACION`
 * se deriva de un `Record<TipoDiferenciaConciliacion, …>` justamente para que
 * una lista paralela no se desincronice "a mano" (el desplegable de la bandeja
 * se rompió así en agosto de 2026). Esto cierra la otra mitad: la que cruza de
 * TypeScript a SQL, donde el compilador ya no alcanza.
 *
 * No necesita base de datos: lee el SQL versionado, que es lo que se aplica en
 * cualquier entorno.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TIPOS_DIFERENCIA_CONCILIACION } from "./conciliacion-clasificacion";

const DIRECTORIO_MIGRACIONES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../supabase/migrations",
);

/**
 * Cubre las dos formas con que el repo declara el constraint: inline en el
 * `create table` de `20260601000006` (`constraint … check …`) y como
 * `alter table … add constraint` en todas las reposiciones posteriores.
 */
const PATRON_CHECK_TIPOS =
  /(?:add\s+)?constraint\s+eventos_conciliacion_tipo_valido\s+check\s*\(\s*tipo_diferencia\s+in\s*\(([\s\S]*?)\)\s*\)/gi;

interface ListaDeTipos {
  archivo: string;
  tipos: string[];
}

/**
 * Los literales del bloque, sin comentarios. Quitar los `--` primero no es
 * cosmético: los comentarios de estas migraciones están en español y explican
 * casos de negocio, así que contienen comillas simples que el extractor leería
 * como literales fantasma.
 */
function tiposDelBloque(cuerpo: string): string[] {
  const sinComentarios = cuerpo.replace(/--[^\n]*/g, "");
  return [...sinComentarios.matchAll(/'([a-z0-9_]+)'/gi)].map((m) => m[1]);
}

/**
 * Todas las declaraciones del CHECK, en orden de aplicación. El nombre de una
 * migración empieza por su timestamp, así que el orden lexicográfico es el
 * cronológico: la última del arreglo es la que queda vigente tras aplicar la
 * carpeta entera.
 */
function declaracionesDelCheck(): ListaDeTipos[] {
  const declaraciones: ListaDeTipos[] = [];

  for (const archivo of readdirSync(DIRECTORIO_MIGRACIONES).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(DIRECTORIO_MIGRACIONES, archivo), "utf8");
    for (const coincidencia of sql.matchAll(PATRON_CHECK_TIPOS)) {
      declaraciones.push({ archivo, tipos: tiposDelBloque(coincidencia[1]) });
    }
  }

  return declaraciones;
}

describe("tipos de diferencia de conciliación: SQL y TypeScript no pueden divergir", () => {
  /**
   * Guardia del patrón, y va primero por eso: si el estilo del SQL cambia (a
   * enum, a tabla de catálogo, a otro nombre de constraint), sin esta aserción
   * la comparación de abajo pasaría por vacuidad y creeríamos tener una red que
   * ya no existe.
   */
  it("encuentra la declaración del CHECK en las migraciones", () => {
    const declaraciones = declaracionesDelCheck();

    expect(
      declaraciones.length,
      "No se encontró ninguna declaración de eventos_conciliacion_tipo_valido con la forma " +
        "`check (tipo_diferencia in (…))`. O el constraint se renombró, o la columna dejó de ser " +
        "text + CHECK. Actualiza PATRON_CHECK_TIPOS — no borres esta prueba: es lo único que ata " +
        "la lista de la base con la de TypeScript.",
    ).toBeGreaterThan(0);
  });

  it("el CHECK vigente admite exactamente los tipos que TypeScript declara", () => {
    const declaraciones = declaracionesDelCheck();
    const vigente = declaraciones.at(-1)!;

    // Ambos como `string[]`: se comparan contra literales extraídos del SQL, que
    // no están tipados. Dejar el segundo como `TipoDiferenciaConciliacion[]`
    // haría que `includes` de un `string` no compile.
    const enSql: string[] = [...vigente.tipos].sort();
    const enTypeScript: string[] = [...TIPOS_DIFERENCIA_CONCILIACION].sort();

    const faltanEnSql = enTypeScript.filter((t) => !enSql.includes(t));
    const sobranEnSql = enSql.filter((t) => !enTypeScript.includes(t));

    expect(
      { faltanEnSql, sobranEnSql },
      `La lista del CHECK (migración ${vigente.archivo}, ${enSql.length} tipos) no coincide con ` +
        `TipoDiferenciaConciliacion (${enTypeScript.length} tipos).\n` +
        `  Faltan en SQL: ${faltanEnSql.join(", ") || "—"}\n` +
        `  Sobran en SQL: ${sobranEnSql.join(", ") || "—"}\n` +
        "Un tipo que falta en SQL no es un detalle: el detector que lo emite falla con 23514 en " +
        "ejecución, dentro de un step.run, y tumba el job de dinero. Recuerda que cada migración " +
        "que toca este CHECK repone la lista ENTERA — copia la vigente, no una anterior.",
    ).toEqual({ faltanEnSql: [], sobranEnSql: [] });
  });

  it("ninguna reposición NUEVA del CHECK pierde un tipo que ya admitía", () => {
    // La regresión no fue "el CHECK quedó incompleto": fue "una reposición
    // encogió la lista". Ese movimiento es siempre sospechoso —los tipos se
    // agregan, no se retiran— así que se vigila la serie entera y no solo el
    // estado final. Detecta el error en la migración culpable, no tres pasos
    // más tarde.
    //
    // Las migraciones aplicadas no se editan, así que la pérdida del 12-ago
    // queda en la serie para siempre aunque una migración posterior la repare.
    // Se declara aquí, y su presencia en esta lista es el registro del
    // incidente: cualquier OTRA pérdida rompe la prueba.
    // Se identifican por `tipo@migración-culpable`, no por la frase completa:
    // incrustar aquí el nombre largo de dos archivos haría que renombrar una
    // migración rompiera esta prueba con un mensaje que no señala la causa.
    const PERDIDAS_HISTORICAS_CONOCIDAS = [
      // Restituida por `20260813000003`. El tipo se emite con
      // `bloquea_pago = true` cuando a un conductor se le emitió o pagó la
      // liquidación de una entrega que después se canceló en ML; el detector
      // estuvo cayendo con 23514 desde el 12-ago hasta el 13-ago.
      "linea_liquidacion_sin_pedido_entregado@20260812000001",
    ];

    const declaraciones = declaracionesDelCheck();
    const perdidos: { clave: string; descripcion: string }[] = [];

    for (let i = 1; i < declaraciones.length; i++) {
      const previa = declaraciones[i - 1];
      const actual = declaraciones[i];
      for (const tipo of previa.tipos) {
        if (!actual.tipos.includes(tipo)) {
          perdidos.push({
            clave: `${tipo}@${actual.archivo.slice(0, 14)}`,
            descripcion: `${tipo} — lo admitía ${previa.archivo} y lo dejó fuera ${actual.archivo}`,
          });
        }
      }
    }

    const perdidosNuevos = perdidos
      .filter((p) => !PERDIDAS_HISTORICAS_CONOCIDAS.includes(p.clave))
      .map((p) => p.descripcion);

    expect(
      perdidosNuevos,
      "Una migración repuso el CHECK dejando fuera un tipo que la anterior sí admitía:\n  " +
        perdidosNuevos.join("\n  ") +
        "\nCada migración que toca este CHECK repone la lista ENTERA: copia la VIGENTE, no una " +
        "anterior, y agrega el tipo nuevo al final.",
    ).toEqual([]);
  });
});
