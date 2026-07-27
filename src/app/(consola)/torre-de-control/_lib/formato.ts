/**
 * Formato de cifras — Torre de control (README §3).
 *
 * Este módulo tiene su propio formateador de moneda a propósito: NO reusar
 * `formatearClp` de `src/lib/formato-cl.ts` — ese mete un espacio duro antes
 * del símbolo, y el handoff exige `$2.081.100` sin espacio. Torre de control
 * tiene lenguaje visual propio (ver CLAUDE.md); esto incluye su formato.
 */

/** `2081100` → `"$2.081.100"`. Sin espacio entre el signo y el número. */
export function clpTorre(valor: number): string {
  return `$${Math.round(valor).toLocaleString("es-CL")}`;
}

/**
 * Porcentaje con coma decimal y espacio antes del signo: `+38 %`, `−2,4 %`.
 * Negativos con minus U+2212 (no guión). `decimales` por defecto 1, porque
 * las variaciones de `MetricaResumen` del dataset siempre traen un decimal
 * (`21.0` se ve `21,0 %`, no `21 %`). Para porcentajes ya enteros por
 * naturaleza (p. ej. `OlaEntrante.variacionEsperadaPct`), pasa `decimales: 0`.
 */
export function porcentajeTorre(valor: number, decimales = 1): string {
  const signo = valor < 0 ? "−" : "+";
  const numero = Math.abs(valor).toLocaleString("es-CL", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
  return `${signo}${numero} %`;
}

/** Entero con signo explícito y minus U+2212, sin sufijo. Para holgura/brecha. */
export function numeroConSigno(valor: number): string {
  const signo = valor < 0 ? "−" : "+";
  return `${signo}${Math.abs(Math.round(valor)).toLocaleString("es-CL")}`;
}

/** Cifra entera tabular simple, sin signo. `1234` → `"1.234"`. */
export function numeroTorre(valor: number): string {
  return Math.round(valor).toLocaleString("es-CL");
}

/** Minutos de antigüedad con prime: `38` → `"38′"` (U+2032). */
export function minutosPrimeTorre(valor: number): string {
  return `${Math.round(valor)}′`;
}

/** Un decimal fijo, coma chilena: `25.2` → `"25,2"`. Para "aporta N puntos". */
export function unDecimalTorre(valor: number): string {
  return valor.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
