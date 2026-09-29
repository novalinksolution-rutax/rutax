/** Horario de reparto (paso 3). Funciones puras, compartidas por cliente y servidor. */

/** "16:00", "16:00:00" o basura -> "HH:MM", o "" si no es una hora. */
export function normalizarHoraSantiago(valor: string): string {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(valor ?? "").trim());
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return "";
  return `${m[1]}:${m[2]}`;
}

export function minutosDelDia(hora: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hora);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export type ValidacionHorario =
  | { ok: true; minutos: number }
  | { ok: false; mensaje: string; campo: "hora_salida" | "hora_corte" };

export function validarHorario(salida: string, corte: string): ValidacionHorario {
  const s = minutosDelDia(salida);
  const c = minutosDelDia(corte);
  if (s === null) return { ok: false, mensaje: "Obligatorio.", campo: "hora_salida" };
  if (c === null) return { ok: false, mensaje: "Obligatorio.", campo: "hora_corte" };
  if (c <= s) {
    return { ok: false, mensaje: "El corte debe ser después de la salida.", campo: "hora_corte" };
  }
  return { ok: true, minutos: c - s };
}

/** "5 h", "5 h 30 min", "45 min". Dato, no explicación. */
export function formatearDuracion(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
