/**
 * Red mecánica: un cron con FRANJA HORARIA tiene que declarar su zona.
 * =============================================================================
 * Inngest interpreta los crons en **UTC** salvo que empiecen con `TZ=…`.
 *
 * Mordió el 7-sep-2026 (commit 8efca75), y quedó vivo recién el 20-sep, cuando
 * una sincronización manual de Inngest aplicó los horarios: tres crons se
 * «acotaron al horario operativo 6-22» sin `TZ=America/Santiago`, así que el
 * rango era UTC —03:00 a 19:45 en Santiago—. El seguimiento de estados de ML
 * **se apagaba en pleno reparto** (16:00-22:00) y la alerta de incidencias sin
 * gestionar se callaba justo cuando fallan las entregas. Lo destapó una falsa
 * alarma del vigía de salud, no un síntoma operativo.
 *
 * Qué exige esta prueba: todo cron cuyo campo de HORA sea un rango (`6-22`) o
 * una lista (`8,20`) lleva `TZ=`. Un cron horario (`15 * * * *`) o por
 * intervalo (`*\/15 * * * *`) no depende de la zona y no se exige.
 *
 * ⚠️ Lo que NO exige, a propósito: los crons de hora fija (`0 2 * * *`). Hay
 * varios sin zona —entre ellos cierre de períodos y liquidaciones— que corren
 * 3 h antes de lo que dicen sus comentarios. Cambiarlos mueve qué entregas caen
 * en qué período, y eso se decide con el motor de dinero, no con una regex.
 * Cuando se auditen, esta red se extiende a ellos.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..");
const PATRON_CRON = /cron:\s*(['"])([^'"]+)\1/g;

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === "node_modules") continue;
      salida.push(...archivosTs(ruta));
    } else if (nombre.endsWith(".ts") && !nombre.endsWith(".test.ts")) {
      salida.push(ruta);
    }
  }
  return salida;
}

/** El campo de hora es un rango o una lista: depende de la zona horaria. */
export function horaDependeDeLaZona(expresion: string): boolean {
  if (expresion.startsWith("TZ=")) return false;
  const campos = expresion.trim().split(/\s+/);
  const hora = campos[1] ?? "";
  return /[-,]/.test(hora);
}

describe("crons con franja horaria declaran su zona", () => {
  it("la regla distingue lo que importa (contraprueba de la red)", () => {
    expect(horaDependeDeLaZona("*/15 6-22 * * *")).toBe(true);
    expect(horaDependeDeLaZona("0 8,20 * * *")).toBe(true);
    expect(horaDependeDeLaZona("TZ=America/Santiago */15 6-22 * * *")).toBe(false);
    expect(horaDependeDeLaZona("15 * * * *")).toBe(false);
    expect(horaDependeDeLaZona("*/30 * * * *")).toBe(false);
  });

  it("ningún cron de src/ tiene franja horaria sin TZ=", () => {
    const culpables: string[] = [];
    for (const archivo of archivosTs(RAIZ)) {
      const contenido = readFileSync(archivo, "utf8");
      for (const m of contenido.matchAll(PATRON_CRON)) {
        if (horaDependeDeLaZona(m[2])) culpables.push(`${archivo.replace(RAIZ, "src")}: "${m[2]}"`);
      }
    }
    expect(culpables, `Crons con franja horaria en UTC:\n${culpables.join("\n")}`).toEqual([]);
  });
});
