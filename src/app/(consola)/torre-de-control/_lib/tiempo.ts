/**
 * Tiempo — Torre de control. Horas 24 h, zona `America/Santiago` (README §3).
 *
 * Todo pasa por `Intl.DateTimeFormat` con `timeZone: "America/Santiago"`
 * explícito: no confiar en el huso horario del navegador ni del server.
 */

import type { Ventana } from "../_fixture/estado-torre";

const ZONA_SANTIAGO = "America/Santiago";

/** `2026-07-19` — fecha civil desnuda, sin hora ni offset. */
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

function partes(iso: string) {
  // Una fecha civil desnuda NO es un instante y no puede pasar por `new Date()`:
  // el runtime la parsea como MEDIANOCHE UTC, y al formatearla en Santiago
  // (−04:00 en invierno, −03:00 en verano) retrocede al día anterior. El
  // contrato tiene varios campos así —`HitoPreparacion.fechaLimite`,
  // `OlaEntrante.diaCritico`, `fechaLimiteCompraPorZona`, `PronosticoAire.fecha`,
  // `RestriccionVehicular.fecha`— y todos se corrían un día.
  //
  // Se detectó en pantalla: el chip de hito vencido mostraba "18 JUL" con la
  // fixture en `2026-07-19`.
  //
  // Una fecha civil ya ESTÁ en calendario de Santiago: se lee tal cual, sin
  // convertir nada.
  const civil = SOLO_FECHA.exec(iso);
  if (civil) {
    return {
      anio: Number(civil[1]),
      mes: Number(civil[2]),
      dia: Number(civil[3]),
      hora: 0,
      minuto: 0,
      segundo: 0,
    };
  }

  const fecha = new Date(iso);
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_SANTIAGO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(fecha);
  const obtener = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  let hora = obtener("hour");
  if (hora === 24) hora = 0; // en-US con hour12:false a veces reporta "24" a medianoche
  return {
    anio: obtener("year"),
    mes: obtener("month"),
    dia: obtener("day"),
    hora,
    minuto: obtener("minute"),
    segundo: obtener("second"),
  };
}

/** Minutos transcurridos desde `horaBase:00` del mismo día, en hora de Santiago. */
export function minutosDesdeSantiago(iso: string, horaBase = 8): number {
  const p = partes(iso);
  return (p.hora - horaBase) * 60 + p.minuto + p.segundo / 60;
}

/** `"2026-07-25T09:14:00-04:00"` → `"09:14"`. */
export function horaSantiago(iso: string): string {
  const p = partes(iso);
  return `${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
}

const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES_CORTOS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** `"2026-07-25T09:14:00-04:00"` → `"sáb 25 jul"` (sin coma, formato del handoff). */
export function fechaCortaSantiago(iso: string): string {
  const p = partes(iso);
  // El día de la semana se deriva de las partes CIVILES ya resueltas, no de
  // `new Date(iso)`: con una fecha desnuda ese instante es medianoche UTC y en
  // Santiago cae el día anterior, así que devolvía también el día de semana
  // equivocado. `Date.UTC` sobre componentes sin hora no tiene drift de zona.
  const indiceDia = new Date(Date.UTC(p.anio, p.mes - 1, p.dia)).getUTCDay();
  const diaTxt = DIAS_CORTOS[indiceDia] ?? "";
  const mesTxt = MESES_CORTOS[p.mes - 1] ?? "";
  return `${diaTxt} ${p.dia} ${mesTxt}`;
}

/** true si dos ISO caen en el mismo día calendario de Santiago. */
export function mismoDiaSantiago(isoA: string, isoB: string): boolean {
  const a = partes(isoA);
  const b = partes(isoB);
  return a.anio === b.anio && a.mes === b.mes && a.dia === b.dia;
}

/** "hoy" / "mañana" relativo a `referenciaIso`, o la fecha corta si es otro día. */
export function diaRelativoCorto(iso: string, referenciaIso: string): string {
  if (mismoDiaSantiago(iso, referenciaIso)) return "hoy";
  const referencia = new Date(referenciaIso);
  const manana = new Date(referencia.getTime() + 24 * 60 * 60 * 1000);
  if (mismoDiaSantiago(iso, manana.toISOString())) return "mañana";
  return fechaCortaSantiago(iso);
}

/** true si la ventana cubre el día completo (00:00 a ~23:59). */
export function esVentanaTodoElDia(ventana: Ventana): boolean {
  if (!ventana.fin) return false;
  const inicio = partes(ventana.inicio);
  const fin = partes(ventana.fin);
  return inicio.hora === 0 && inicio.minuto === 0 && fin.hora === 23 && fin.minuto >= 55;
}

/**
 * Formatea una ventana para la ficha de excepción: `"16:00–19:00 · hoy"` o,
 * si cubre el día completo, `"{fecha corta} · todo el día"`.
 */
export function formatoVentanaCorta(ventana: Ventana | null, referenciaIso: string): string {
  if (!ventana) return "sin ventana definida";
  if (esVentanaTodoElDia(ventana)) {
    return `${diaRelativoCorto(ventana.inicio, referenciaIso)} · todo el día`;
  }
  const inicio = horaSantiago(ventana.inicio);
  const fin = ventana.fin ? horaSantiago(ventana.fin) : null;
  const dia = diaRelativoCorto(ventana.inicio, referenciaIso);
  return fin ? `${inicio}–${fin} · ${dia}` : `desde las ${inicio} · ${dia}`;
}

/** `{dia: 25, mes: "jul"}` — piezas cortas para armar rangos de fecha. */
export function diaYMesCorto(iso: string): { dia: number; mes: string } {
  const p = partes(iso);
  return { dia: p.dia, mes: MESES_CORTOS[p.mes - 1] ?? "" };
}

/**
 * Rango corto de dos fechas: `"3–8 ago"` si caen en el mismo mes,
 * `"29 jul – 3 ago"` si cruzan de mes.
 */
export function rangoFechasCorto(inicioIso: string, finIso: string): string {
  const a = diaYMesCorto(inicioIso);
  const b = diaYMesCorto(finIso);
  if (a.mes === b.mes) return `${a.dia}–${b.dia} ${b.mes}`;
  return `${a.dia} ${a.mes} – ${b.dia} ${b.mes}`;
}
