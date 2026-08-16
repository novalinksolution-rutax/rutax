/**
 * Helpers del filtro de fecha (día exacto · rango · atajos) — compartidos por
 * el control `<FiltroFecha>` y por las páginas de servidor que lo consumen.
 *
 * Todo opera sobre fechas CIVILES 'YYYY-MM-DD'. La aritmética de días pasa por
 * `sumarDiasCalendario` (src/lib/fecha-santiago.ts), único lugar autorizado a
 * usar el truco `Date.UTC` — así el guard de fechas no se dispara y no se cuela
 * un off-by-one de zona horaria. El formato de etiqueta se arma a mano desde las
 * partes del string: NO se pasa la fecha civil por `new Date()` ni por
 * `formatearFecha`, que la interpretarían como instante UTC y la correrían un
 * día (medianoche UTC de un 12 es el 11 por la tarde en Santiago).
 */

import { sumarDiasCalendario, diaSemanaCalendario } from "@/lib/fecha-santiago";

const MESES_LARGOS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const MESES_CORTOS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/** `"12 ago"` a partir de una fecha civil 'YYYY-MM-DD' (sin tocar `Date`). */
export function etiquetaFechaCivilCorta(fecha: string): string {
  const [, mes, dia] = fecha.split("-");
  const nombreMes = MESES_CORTOS[Number(mes) - 1] ?? mes;
  return `${Number(dia)} ${nombreMes}`;
}

export interface AtajoFecha {
  clave: string;
  etiqueta: string;
  /** Si `exacto` viene, es un día único; si no, es el rango `desde`–`hasta`. */
  exacto?: string;
  desde?: string;
  hasta?: string;
}

/** Primer día del mes de `fecha` → 'YYYY-MM-01' (slice sobre string plano). */
function primerDiaDelMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

/**
 * Atajos rápidos calculados desde el "hoy" civil de Santiago (lo pasa el
 * servidor, para que SSR y cliente coincidan). Hoy/Ayer son día único; el resto
 * son rangos.
 */
export function calcularAtajosFecha(hoy: string): AtajoFecha[] {
  const primeroMes = primerDiaDelMes(hoy);
  const finMesPasado = sumarDiasCalendario(primeroMes, -1);
  return [
    { clave: "hoy", etiqueta: "Hoy", exacto: hoy },
    { clave: "ayer", etiqueta: "Ayer", exacto: sumarDiasCalendario(hoy, -1) },
    { clave: "7d", etiqueta: "Últimos 7 días", desde: sumarDiasCalendario(hoy, -6), hasta: hoy },
    { clave: "30d", etiqueta: "Últimos 30 días", desde: sumarDiasCalendario(hoy, -29), hasta: hoy },
    { clave: "mes", etiqueta: "Este mes", desde: primeroMes, hasta: hoy },
    { clave: "mespasado", etiqueta: "Mes pasado", desde: primerDiaDelMes(finMesPasado), hasta: finMesPasado },
  ];
}

/**
 * Etiqueta compacta para el disparador del filtro: "Hoy", "Ayer", "12 ago" o
 * "1 ago – 15 ago". Vacío en todos los campos → "Todas las fechas".
 */
export function etiquetaSeleccionFecha({
  exacto,
  desde,
  hasta,
  hoy,
}: {
  exacto: string;
  desde: string;
  hasta: string;
  hoy: string;
}): string {
  if (exacto) {
    if (exacto === hoy) return "Hoy";
    if (exacto === sumarDiasCalendario(hoy, -1)) return "Ayer";
    return etiquetaFechaCivilCorta(exacto);
  }
  if (desde && hasta) {
    return desde === hasta
      ? etiquetaFechaCivilCorta(desde)
      : `${etiquetaFechaCivilCorta(desde)} – ${etiquetaFechaCivilCorta(hasta)}`;
  }
  if (desde) return `Desde ${etiquetaFechaCivilCorta(desde)}`;
  if (hasta) return `Hasta ${etiquetaFechaCivilCorta(hasta)}`;
  return "Todas las fechas";
}

// ---------------------------------------------------------------------------
// Utilidades del calendario de rango (mes 'YYYY-MM').
// Todo pasa por `sumarDiasCalendario`/`diaSemanaCalendario` (fecha civil), sin
// `new Date()` sobre strings — así el guard de fechas no se dispara y no hay
// off-by-one de zona horaria.
// ---------------------------------------------------------------------------

/** Mes 'YYYY-MM' al que pertenece una fecha 'YYYY-MM-DD'. */
export function mesDe(fecha: string): string {
  return fecha.slice(0, 7);
}

/** `"agosto 2026"` a partir de 'YYYY-MM'. */
export function etiquetaMes(mes: string): string {
  const [anio, m] = mes.split("-");
  return `${MESES_LARGOS[Number(m) - 1] ?? m} ${anio}`;
}

/** Mes siguiente: '2026-08' → '2026-09' (el 28 + 7 días siempre cae en el mes que viene). */
export function mesSiguiente(mes: string): string {
  return sumarDiasCalendario(`${mes}-28`, 7).slice(0, 7);
}

/** Mes anterior: '2026-08' → '2026-07' (el día 1 − 1 cae en el mes previo). */
export function mesAnterior(mes: string): string {
  return sumarDiasCalendario(`${mes}-01`, -1).slice(0, 7);
}

/**
 * Grilla de un mes: los días como 'YYYY-MM-DD' y cuántas celdas vacías van antes
 * del día 1 (semana con LUNES primero, como se usa en Chile).
 */
export function grillaMes(mes: string): { dias: string[]; desplazamiento: number } {
  const primero = `${mes}-01`;
  // diaSemanaCalendario: 0 = domingo … 6 = sábado → a lunes-primero.
  const desplazamiento = (diaSemanaCalendario(primero) + 6) % 7;
  const dias: string[] = [];
  for (let i = 0; i < 31; i++) {
    const d = sumarDiasCalendario(primero, i);
    if (d.slice(0, 7) !== mes) break;
    dias.push(d);
  }
  return { dias, desplazamiento };
}
