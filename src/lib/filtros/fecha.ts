/**
 * Parseo y aplicación SERVER-SIDE del filtro de fecha (día exacto · rango).
 *
 * Compañero del control cliente `<FiltroFecha>` (components/filtros/filtro-fecha).
 * El control escribe `fecha` (día exacto, excluyente) o `fecha_desde`/`fecha_hasta`
 * (rango) en la URL; aquí se sanea y se traduce a lo que cada consulta necesita:
 *
 *   - Columnas `date` (p. ej. `fecha_compromiso`, `fecha_operacion`): se comparan
 *     directo con el string civil — `eq` para el día, `gte`/`lte` para el rango.
 *   - Columnas `timestamptz` (p. ej. `abierta_en`, `creado_en`): se necesita la
 *     ventana de instantes UTC del día CIVIL de Santiago → `ventanaFechaSantiago`.
 *
 * Toda la aritmética de fecha es civil o pasa por los helpers de Santiago: nada
 * de derivar una fecha civil truncando un instante UTC (ver el guard de fechas).
 */

import { limitesDelDiaSantiago } from "@/lib/fecha-santiago";

const REGEX_FECHA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;
const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function esAnioBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/**
 * Valida un 'YYYY-MM-DD' (formato + día/mes en rango real, p. ej. rechaza
 * `2026-02-30`). Devuelve "" si es inválido — así un valor basura en la URL se
 * ignora en vez de tumbar la consulta contra una columna `date` de Postgres.
 * Aritmética pura, sin `Date`, igual que en `operaciones/sanear-filtros.ts`.
 */
export function sanearFechaCivil(valor: string | undefined | null): string {
  if (!valor || !REGEX_FECHA_CIVIL.test(valor)) return "";
  const [anio, mes, dia] = valor.split("-").map(Number);
  if (mes < 1 || mes > 12) return "";
  const diasEnMes = mes === 2 && esAnioBisiesto(anio) ? 29 : DIAS_POR_MES[mes - 1];
  if (dia < 1 || dia > diasEnMes) return "";
  return valor;
}

export interface RangoFecha {
  /** Día exacto ("" si hay rango o no hay fecha). Excluyente con desde/hasta. */
  exacto: string;
  desde: string;
  hasta: string;
  /** `true` si hay cualquier filtro de fecha puesto. */
  hayFecha: boolean;
}

/**
 * Parsea los valores crudos del filtro a un rango normalizado y saneado. El día
 * exacto (`exacto`) gana sobre el rango. El llamador extrae los valores de sus
 * searchParams —así el helper no depende de nombres de param concretos, y la
 * bitácora del admin puede seguir usando `desde`/`hasta`—.
 */
export function parsearRangoFecha(valores: {
  exacto?: string;
  desde?: string;
  hasta?: string;
}): RangoFecha {
  const exacto = sanearFechaCivil(valores.exacto);
  const desde = sanearFechaCivil(valores.desde);
  const hasta = sanearFechaCivil(valores.hasta);
  const hayRango = !exacto && !!(desde || hasta);
  return {
    exacto: hayRango ? "" : exacto,
    desde: hayRango ? desde : "",
    hasta: hayRango ? hasta : "",
    hayFecha: !!(exacto || hayRango),
  };
}

/**
 * Ventana `[gte, lt)` en instantes UTC para filtrar una columna `timestamptz`
 * por el rango de días CIVILES de Santiago. El día exacto abarca ese día
 * completo; `lt` es el inicio del día siguiente al `hasta` (semiabierto), así no
 * se pierde el último segundo del día.
 */
export function ventanaFechaSantiago(r: RangoFecha): { gte?: string; lt?: string } {
  if (r.exacto) {
    const limites = limitesDelDiaSantiago(r.exacto);
    return { gte: limites.desde.toISOString(), lt: limites.hasta.toISOString() };
  }
  const salida: { gte?: string; lt?: string } = {};
  if (r.desde) salida.gte = limitesDelDiaSantiago(r.desde).desde.toISOString();
  if (r.hasta) salida.lt = limitesDelDiaSantiago(r.hasta).hasta.toISOString();
  return salida;
}
