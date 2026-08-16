/**
 * Red mecánica: **ninguna fecha se formatea sin fijar la zona horaria.**
 *
 * Por qué existe esta prueba y no basta con "acordarse". `es-CL` fija el
 * FORMATO, no el huso. `new Date(x).toLocaleString("es-CL")` sin `timeZone`
 * resuelve la hora contra el reloj del runtime: en el navegador es la del
 * dispositivo, y en el servidor —Vercel— es **UTC**, cuatro horas adelantada
 * respecto de Santiago en invierno y tres en verano.
 *
 * El fallo es especialmente traicionero porque en desarrollo NO se nota: la
 * máquina del desarrollador ya está en Santiago, así que todo se ve bien hasta
 * que la pantalla se renderiza en el servidor y el courier ve una entrega
 * cerrada "a las 21:47" que en realidad ocurrió a las 17:47. Lo reportó el
 * usuario el 2026-08-16 sobre el historial de estados de un pedido devuelto, y
 * al buscarlo aparecieron diez sitios con el mismo defecto.
 *
 * La regla: usar los helpers de `@/lib/formato-cl` (`formatearFecha`,
 * `formatearFechaHora`, `formatearHora`), que ya fijan `America/Santiago`. Si un
 * sitio necesita un formato distinto, puede construir su propio
 * `Intl.DateTimeFormat` — pero tiene que pasar `timeZone` explícito.
 *
 * Esta prueba lee el árbol de `src/` en vez de depender de una regla de ESLint
 * porque es el mismo patrón que ya usa el proyecto para atar dos mitades que
 * pueden divergir en silencio (ver `dinero/conciliacion-tipos-sql.test.ts`).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatearFecha, formatearFechaHora, formatearHora } from "./formato-cl";

const RAIZ = join(process.cwd(), "src");

/** Formateo de FECHAS. `toLocaleString` sobre un número no entra acá. */
const LLAMADA_FECHA = /\.toLocale(?:Date|Time)String\s*\(|new Intl\.DateTimeFormat\s*\(/g;

function archivosFuente(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      archivosFuente(ruta, acc);
    } else if (/\.(ts|tsx)$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) {
      acc.push(ruta);
    }
  }
  return acc;
}

/**
 * Recorta desde la llamada hasta cerrar su lista de argumentos, contando
 * paréntesis. Sin esto, mirar "las próximas N líneas" produce falsos negativos
 * cuando el `timeZone` de la llamada SIGUIENTE cae dentro de la ventana.
 */
function argumentosDeLlamada(texto: string, desde: number): string {
  const abre = texto.indexOf("(", desde);
  if (abre === -1) return "";
  let nivel = 0;
  for (let i = abre; i < texto.length; i += 1) {
    if (texto[i] === "(") nivel += 1;
    else if (texto[i] === ")") {
      nivel -= 1;
      if (nivel === 0) return texto.slice(abre, i + 1);
    }
  }
  return texto.slice(abre);
}

describe("ninguna fecha se formatea sin zona horaria explícita", () => {
  it("todo toLocaleDateString / toLocaleTimeString / Intl.DateTimeFormat fija timeZone", () => {
    const infractores: string[] = [];

    for (const ruta of archivosFuente(RAIZ)) {
      const texto = readFileSync(ruta, "utf8");
      // El propio módulo de formato es donde viven los formateadores con huso.
      if (ruta.endsWith(join("lib", "formato-cl.ts"))) continue;

      for (const m of texto.matchAll(LLAMADA_FECHA)) {
        const args = argumentosDeLlamada(texto, m.index ?? 0);
        if (args.includes("timeZone")) continue;
        const linea = texto.slice(0, m.index).split("\n").length;
        infractores.push(
          `${ruta.replace(process.cwd(), "").replace(/\\/g, "/")}:${linea} — ${m[0]}`,
        );
      }
    }

    expect(
      infractores,
      `Estas llamadas resuelven la hora contra el reloj del runtime (UTC en Vercel).\n` +
        `Usa formatearFecha / formatearFechaHora / formatearHora de @/lib/formato-cl,\n` +
        `o pasa timeZone: "America/Santiago" explícito:\n  ${infractores.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("los helpers formatean en horario de Santiago", () => {
  // 2026-08-16T21:47:00Z — en Chile (UTC-4 en agosto) son las 17:47 del día 16.
  // Si el helper cayera a UTC, diría 21:47; si cayera al día siguiente por un
  // desfase mal aplicado, diría 17.
  const INSTANTE = "2026-08-16T21:47:00Z";

  it("formatearFechaHora devuelve la hora chilena, no la UTC", () => {
    expect(formatearFechaHora(INSTANTE)).toBe("16-08-2026, 17:47");
  });

  it("formatearFecha no adelanta el día", () => {
    expect(formatearFecha(INSTANTE)).toBe("16-08-2026");
  });

  it("formatearHora usa 24 horas, no 'p. m.'", () => {
    const salida = formatearHora(INSTANTE);
    expect(salida).toBe("17:47");
    expect(salida).not.toMatch(/[ap]\.?\s?m\.?/i);
  });

  it("cruza bien la medianoche chilena", () => {
    // 03:30 UTC del 17 son las 23:30 del 16 en Santiago: el día NO debe avanzar.
    expect(formatearFechaHora("2026-08-17T03:30:00Z")).toBe("16-08-2026, 23:30");
  });

  it("una fecha inválida no revienta la pantalla", () => {
    expect(formatearFechaHora("no-es-fecha")).toBe("—");
    expect(formatearHora("no-es-fecha")).toBe("—");
  });
});
