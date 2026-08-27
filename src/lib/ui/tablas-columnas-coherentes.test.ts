/**
 * Barrido mecánico: una tabla no puede tener más celdas que encabezados.
 *
 * -----------------------------------------------------------------------------
 * EL DEFECTO QUE ESTO ATAJA (producción, 26-08-2026)
 * -----------------------------------------------------------------------------
 * `(tenant)/equipo` declaraba CUATRO `<TableHead>` y su fila de invitación
 * pintaba CINCO `<TableCell>`: la columna «Detalle» se retiró del encabezado y
 * se olvidó en la fila. Las filas de persona sí tenían cuatro.
 *
 * ⚠️ **Nada falla.** El navegador dibuja la columna huérfana sin quejarse, el
 * typecheck pasa —`<TableRow>` acepta los hijos que le pongas— y las pruebas de
 * la pantalla también. Lo que se ve es otra cosa: en producción la tabla medía
 * **2627 px dentro de un contenedor de 1598**, con el texto del estado impreso
 * encima de la descripción del rol. Parece un problema de CSS y no lo es.
 *
 * -----------------------------------------------------------------------------
 * CÓMO CUENTA, Y POR QUÉ ASÍ
 * -----------------------------------------------------------------------------
 * Cuenta por ARCHIVO, no por componente: una fila suele vivir en su propia
 * función y no hay forma barata de atarla a su tabla sin renderizar. La regla es
 * que el total de celdas sea **múltiplo** del total de encabezados — con N
 * columnas y M tipos de fila, salen N·M celdas. Es una heurística, y por eso
 * falla del lado seguro: cuenta de menos, nunca de más.
 *
 * Un archivo con `colSpan` puede romper la regla legítimamente (una fila que
 * ocupa el ancho completo para decir «no hay nada»). Hoy no hay ninguno: si
 * aparece, va a la lista de excepciones CON SU NOMBRE, nunca se relaja la regla.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = "src";

/**
 * Archivos que rompen la regla a propósito. Vacía hoy, y así debería quedarse:
 * cada entrada necesita explicar por qué su tabla no cuadra.
 */
const EXCEPCIONES: ReadonlyArray<{ archivo: string; porque: string }> = [];

function recorrer(dir: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) recorrer(ruta, salida);
    else if (ruta.endsWith(".tsx")) salida.push(ruta);
  }
  return salida;
}

/**
 * Cuenta aperturas de una etiqueta JSX.
 *
 * El `(?![A-Za-z])` es lo que impide que `<TableHeader>` cuente como
 * `<TableHead>` — un prefijo suelto convierte este barrido en ruido y lo vuelve
 * inútil. Sirve además para etiquetas partidas en varias líneas, que un grep
 * por línea se pierde.
 */
function contarEtiqueta(fuente: string, etiqueta: string): number {
  return (fuente.match(new RegExp("<" + etiqueta + "(?![A-Za-z])", "g")) ?? []).length;
}

describe("las tablas declaran tantas celdas como columnas", () => {
  it("ningún archivo pinta un número de celdas que no sea múltiplo de sus encabezados", () => {
    const exentos = new Set(EXCEPCIONES.map((e) => e.archivo.split("\\").join("/")));
    const descuadradas: string[] = [];

    for (const archivo of recorrer(RAIZ)) {
      if (exentos.has(archivo.split("\\").join("/"))) continue;
      const fuente = readFileSync(archivo, "utf8");
      const encabezados = contarEtiqueta(fuente, "TableHead");
      const celdas = contarEtiqueta(fuente, "TableCell");
      if (encabezados === 0 || celdas === 0) continue;
      if (celdas % encabezados !== 0) {
        descuadradas.push(
          `${archivo.split("\\").join("/")} — ${encabezados} encabezados y ${celdas} celdas`,
        );
      }
    }

    expect(
      descuadradas,
      "Una fila pinta más (o menos) celdas que columnas tiene su tabla. El navegador " +
        "no se queja: dibuja la columna de más, ensancha la tabla y superpone los textos. " +
        "Cuadra la fila con el encabezado, o agrega el archivo a EXCEPCIONES con su motivo.",
    ).toEqual([]);
  });

  it("`<TableHeader>` NO cuenta como `<TableHead>`", () => {
    // La contraprueba del contador. Sin el `(?![A-Za-z])`, TODO archivo con una
    // tabla suma un encabezado de más y el barrido deja de detectar nada.
    const fuente = "<TableHeader><TableRow><TableHead>A</TableHead></TableRow></TableHeader>";
    expect(contarEtiqueta(fuente, "TableHead")).toBe(1);
  });

  it("detecta el caso real que se escapó: 4 encabezados y 5 celdas", () => {
    // La forma exacta que tenía `panel-equipo.tsx` en producción, en pequeño.
    const fuente = `
      <TableHead>Persona</TableHead><TableHead>Rol</TableHead>
      <TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
      <TableCell>a</TableCell><TableCell>b</TableCell><TableCell>c</TableCell>
      <TableCell>d</TableCell><TableCell>e</TableCell>`;
    const h = contarEtiqueta(fuente, "TableHead");
    const c = contarEtiqueta(fuente, "TableCell");
    expect(h).toBe(4);
    expect(c).toBe(5);
    expect(c % h).not.toBe(0);
  });
});
