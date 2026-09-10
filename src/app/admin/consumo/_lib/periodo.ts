/**
 * Selector de período para las pantallas de Consumo — calculado en el SERVER,
 * a partir del querystring `?periodo=`. Ventana siempre semiabierta
 * `[desde, hasta)`, en zona horaria de Santiago (CLAUDE.md: "zona horaria de
 * Santiago" — un corte de mes hecho con `Date` crudo se corre al huso del
 * runtime, que en Vercel es UTC).
 */

export type Periodo = "este-mes" | "mes-anterior" | "ultimos-30";

export const PERIODOS: Array<{ valor: Periodo; etiqueta: string }> = [
  { valor: "este-mes", etiqueta: "Este mes" },
  { valor: "mes-anterior", etiqueta: "Mes anterior" },
  { valor: "ultimos-30", etiqueta: "Últimos 30 días" },
];

function esPeriodoValido(valor: string | undefined): valor is Periodo {
  return valor === "este-mes" || valor === "mes-anterior" || valor === "ultimos-30";
}

/** Componentes de la fecha de HOY en Santiago, sin pasar por `Date` local. */
function hoyEnSantiago(): { anio: number; mes: number; dia: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const anio = Number(partes.find((p) => p.type === "year")?.value);
  const mes = Number(partes.find((p) => p.type === "month")?.value);
  const dia = Number(partes.find((p) => p.type === "day")?.value);
  return { anio, mes, dia };
}

/** `2026-09-01T00:00:00-04:00`-equivalente en UTC, para una fecha civil de Santiago (medianoche). */
function inicioDiaSantiagoUtc(anio: number, mes: number, dia: number): string {
  // Santiago es UTC-4 (o UTC-3 en horario de verano); en vez de calcular el
  // offset a mano, se construye la fecha en UTC del mismo día civil y se deja
  // que el consumidor trate `desde`/`hasta` como cortes de DÍA, no de instante
  // exacto — suficiente para agregación diaria/mensual de costos, que es lo
  // único que se necesita acá.
  return new Date(Date.UTC(anio, mes - 1, dia, 4, 0, 0)).toISOString();
}

export interface VentanaPeriodo {
  periodo: Periodo;
  desde: string;
  hasta: string;
  /** Para mostrar en pantalla: "01-09-2026 al 10-09-2026". */
  etiquetaRango: string;
}

/** Lee `?periodo=` del querystring (server) y calcula la ventana `[desde, hasta)`. */
export function resolverVentanaPeriodo(valorCrudo: string | undefined): VentanaPeriodo {
  const periodo: Periodo = esPeriodoValido(valorCrudo) ? valorCrudo : "este-mes";
  const { anio, mes, dia } = hoyEnSantiago();

  let desde: string;
  let hasta: string;

  if (periodo === "este-mes") {
    desde = inicioDiaSantiagoUtc(anio, mes, 1);
    hasta = inicioDiaSantiagoUtc(anio, mes, dia + 1);
  } else if (periodo === "mes-anterior") {
    const mesAnteriorIdx = mes - 1 === 0 ? 12 : mes - 1;
    const anioMesAnterior = mes - 1 === 0 ? anio - 1 : anio;
    desde = inicioDiaSantiagoUtc(anioMesAnterior, mesAnteriorIdx, 1);
    hasta = inicioDiaSantiagoUtc(anio, mes, 1);
  } else {
    const haceTreinta = new Date(Date.UTC(anio, mes - 1, dia, 4, 0, 0));
    haceTreinta.setUTCDate(haceTreinta.getUTCDate() - 30);
    desde = haceTreinta.toISOString();
    hasta = inicioDiaSantiagoUtc(anio, mes, dia + 1);
  }

  const formateador = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const etiquetaRango = `${formateador.format(new Date(desde))} al ${formateador.format(new Date(hasta))}`;

  return { periodo, desde, hasta, etiquetaRango };
}
