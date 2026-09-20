/**
 * Los motivos de corte viven en DOS listas, y esta prueba las ata.
 * =====================================================================
 * `integraciones.whatsapp_mensajes_entrantes.motivo_no_respondido` es `text` +
 * CHECK (`whatsapp_entrantes_motivo_valido`), no un enum — misma decisión que
 * el resto del repo. La consecuencia práctica es la de siempre: **cada
 * migración que agregue un motivo tiene que reponer la lista COMPLETA**, y ahí
 * está la trampa que ya mordió en `dinero.eventos_conciliacion.tipo_diferencia`
 * el 12-ago-2026 — se copió la lista de una versión vieja, un valor desapareció
 * y nada falló al migrar; falló en ejecución, con 23514 dentro de un
 * `step.run`.
 *
 * Acá el costo de esa pérdida sería el mismo de siempre pero al revés de lo
 * esperable: si `barrido_codigos` desapareciera del CHECK, el job que escribe
 * el motivo reventaría con 23514 **justo cuando está cortando un barrido de
 * códigos**. La protección se caería exactamente cuando tiene que actuar.
 *
 * Hermana de `src/modules/dinero/conciliacion-tipos-sql.test.ts`, que cubre lo
 * mismo del lado del dinero. Igual que ella: no necesita base de datos, lee el
 * SQL versionado, que es lo que se aplica en cualquier entorno.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MOTIVOS_NO_RESPONDIDO, MOTIVOS_DE_CORTE_DEL_CANAL } from "./motivo-no-respondido";

const DIRECTORIO_MIGRACIONES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../supabase/migrations",
);

/**
 * Cubre las dos formas con que el repo declara un constraint de lista: inline
 * en el `create table` y como `alter table … add constraint`. Hoy solo existe
 * la segunda, pero una migración futura podría recrear la tabla.
 */
const PATRON_CHECK_MOTIVOS =
  /(?:add\s+)?constraint\s+whatsapp_entrantes_motivo_valido\s+check\s*\(([\s\S]*?)\)\s*;/gi;

interface ListaDeMotivos {
  archivo: string;
  motivos: string[];
}

/**
 * Los literales del bloque, sin comentarios. Quitar los `--` primero no es
 * cosmético: los comentarios de estas migraciones están en español y explican
 * casos de negocio, así que contienen comillas simples que el extractor leería
 * como literales fantasma.
 */
function motivosDelBloque(cuerpo: string): string[] {
  const sinComentarios = cuerpo.replace(/--[^\n]*/g, "");
  return [...sinComentarios.matchAll(/'([a-z0-9_]+)'/gi)].map((m) => m[1]);
}

/**
 * Todas las declaraciones del CHECK, en orden de aplicación. El nombre de una
 * migración empieza por su timestamp, así que el orden lexicográfico es el
 * cronológico: la última del arreglo es la que queda vigente tras aplicar la
 * carpeta entera.
 */
function declaracionesDelCheck(): ListaDeMotivos[] {
  const declaraciones: ListaDeMotivos[] = [];

  for (const archivo of readdirSync(DIRECTORIO_MIGRACIONES).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(DIRECTORIO_MIGRACIONES, archivo), "utf8");
    for (const coincidencia of sql.matchAll(PATRON_CHECK_MOTIVOS)) {
      declaraciones.push({ archivo, motivos: motivosDelBloque(coincidencia[1]) });
    }
  }

  return declaraciones;
}

describe("motivos de no-respuesta de WhatsApp: SQL y TypeScript no pueden divergir", () => {
  /**
   * Guardia del patrón, y va primero por eso: si el estilo del SQL cambia (a
   * enum, a tabla de catálogo, a otro nombre de constraint), sin esta aserción
   * la comparación de abajo pasaría por vacuidad y creeríamos tener una red que
   * ya no existe. Es la lección del pgTAP que reponía el CHECK dentro del
   * propio test y tapaba el bug que debía detectar.
   */
  it("encuentra la declaración del CHECK en las migraciones", () => {
    const declaraciones = declaracionesDelCheck();

    expect(
      declaraciones.length,
      "No se encontró ninguna declaración de whatsapp_entrantes_motivo_valido con la forma " +
        "`check (… in (…))`. O el constraint se renombró, o la columna dejó de ser text + CHECK. " +
        "Actualiza PATRON_CHECK_MOTIVOS — no borres esta prueba: es lo único que ata la lista de " +
        "la base con la de TypeScript.",
    ).toBeGreaterThan(0);
  });

  it("el CHECK vigente admite exactamente los motivos que TypeScript declara", () => {
    const declaraciones = declaracionesDelCheck();
    const vigente = declaraciones.at(-1)!;

    // Conjunto exacto, NUNCA un conteo: el incidente del 12-ago dejó 16 valores
    // antes y 16 después, con distinta lista. Un conteo lo habría dado por bueno.
    const enSql: string[] = [...vigente.motivos].sort();
    const enTypeScript: string[] = [...MOTIVOS_NO_RESPONDIDO].sort();

    const faltanEnSql = enTypeScript.filter((m) => !enSql.includes(m));
    const sobranEnSql = enSql.filter((m) => !enTypeScript.includes(m));

    expect(
      { faltanEnSql, sobranEnSql },
      `La lista del CHECK (migración ${vigente.archivo}, ${enSql.length} motivos) no coincide con ` +
        `MotivoNoRespondido (${enTypeScript.length} motivos).\n` +
        `  Faltan en SQL: ${faltanEnSql.join(", ") || "—"}\n` +
        `  Sobran en SQL: ${sobranEnSql.join(", ") || "—"}\n` +
        "Un motivo que falta en SQL no es un detalle: el job que lo escribe falla con 23514 en " +
        "ejecución, dentro de un step.run. Si el que falta es `barrido_codigos`, la protección " +
        "revienta justo cuando está cortando un barrido. Cada migración que toca este CHECK " +
        "repone la lista ENTERA — copia la VIGENTE (de la base), no una anterior.",
    ).toEqual({ faltanEnSql: [], sobranEnSql: [] });
  });

  it("ninguna reposición NUEVA del CHECK pierde un motivo que ya admitía", () => {
    // La regresión del 12-ago no fue "el CHECK quedó incompleto": fue "una
    // reposición encogió la lista". Ese movimiento es siempre sospechoso —los
    // valores se agregan, no se retiran— así que se vigila la serie entera y no
    // solo el estado final: detecta el error en la migración culpable, no tres
    // pasos más tarde. Hoy la serie tiene un solo eslabón y este bucle no itera;
    // existe para el día que tenga dos, que es cuando ya sería tarde para
    // escribirla.
    const declaraciones = declaracionesDelCheck();
    const perdidos: string[] = [];

    for (let i = 1; i < declaraciones.length; i++) {
      const previa = declaraciones[i - 1];
      const actual = declaraciones[i];
      for (const motivo of previa.motivos) {
        if (!actual.motivos.includes(motivo)) {
          perdidos.push(`${motivo} — lo admitía ${previa.archivo} y lo dejó fuera ${actual.archivo}`);
        }
      }
    }

    expect(
      perdidos,
      "Una migración repuso el CHECK dejando fuera un motivo que la anterior sí admitía:\n  " +
        perdidos.join("\n  ") +
        "\nCada migración que toca este CHECK repone la lista ENTERA: copia la VIGENTE, no una " +
        "anterior, y agrega el motivo nuevo al final.",
    ).toEqual([]);
  });

  it("los tres motivos de corte del canal son un subconjunto de la lista", () => {
    // `MOTIVOS_DE_CORTE_DEL_CANAL` es la lista corta que el backstage usa para
    // el desglose del contador. El `satisfies` del archivo fuente ya impide que
    // contenga un valor inventado; esto cierra la otra mitad — que siga
    // existiendo en el CHECK después de una reposición.
    const vigente = declaracionesDelCheck().at(-1)!;
    const fuera = MOTIVOS_DE_CORTE_DEL_CANAL.filter((m) => !vigente.motivos.includes(m));

    expect(
      fuera,
      `Motivos de corte del canal que el CHECK vigente (${vigente.archivo}) ya no admite: ` +
        `${fuera.join(", ")}. El backstage los contaría y el job no los podría escribir.`,
    ).toEqual([]);
  });
});
