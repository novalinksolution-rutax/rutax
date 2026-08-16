/**
 * Utilidades de formato — localización Chile (CLAUDE.md: "CLP, español, zona
 * horaria de Santiago, validación de RUT"). Compartidas por todas las
 * pantallas; evita que cada componente reinvente el formato de moneda/RUT/fecha
 * y termine divergiendo (criterio transversal #2 y #3 del documento de UX).
 */

const FORMATEADOR_CLP = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const FORMATEADOR_FECHA = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const FORMATEADOR_FECHA_HORA = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  // Sin esto, `es-CL` en Chrome devuelve "01:12 p. m.". En Chile la hora se lee
  // en 24h.
  hour12: false,
});

const FORMATEADOR_HORA = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `$ 2.500` — sin decimales, separador de miles chileno. Nunca `$2500.00`. */
export function formatearClp(monto: number): string {
  return FORMATEADOR_CLP.format(Math.round(monto)).replace(/ /g, " ");
}

/** `14-03-2027` — fecha corta en zona horaria de Santiago. */
export function formatearFecha(fecha: Date | string): string {
  const valor = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(valor.getTime())) return "—";
  return FORMATEADOR_FECHA.format(valor);
}

/** `14-03-2027 09:30` — fecha y hora en zona horaria de Santiago. */
export function formatearFechaHora(fecha: Date | string): string {
  const valor = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(valor.getTime())) return "—";
  return FORMATEADOR_FECHA_HORA.format(valor);
}

/**
 * `09:30` — solo la hora, en zona horaria de Santiago y en formato 24h.
 *
 * Existe para que nadie vuelva a escribir `toLocaleTimeString("es-CL", …)` a
 * mano: ese camino olvida `timeZone` (y entonces la hora sale en la zona del
 * servidor, que en Vercel es UTC) o olvida `hour12: false` (y entonces Chrome
 * devuelve "01:12 p. m." en vez de "13:12"). Las dos cosas ya pasaron en este
 * repo, en el mismo archivo y con dos líneas de diferencia.
 */
export function formatearHora(fecha: Date | string): string {
  const valor = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(valor.getTime())) return "—";
  return FORMATEADOR_HORA.format(valor);
}

/** "hace 5 minutos" / "hace 2 días" — relativo, en español de Chile, redondeado al tramo más legible. */
export function formatearTiempoRelativo(fecha: Date | string, ahora: Date = new Date()): string {
  const valor = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(valor.getTime())) return "—";

  const diffMs = ahora.getTime() - valor.getTime();
  const futuro = diffMs < 0;
  const diffAbs = Math.abs(diffMs);

  const minuto = 60_000;
  const hora = 60 * minuto;
  const dia = 24 * hora;

  let texto: string;
  if (diffAbs < minuto) {
    texto = "un instante";
  } else if (diffAbs < hora) {
    const minutos = Math.round(diffAbs / minuto);
    texto = minutos === 1 ? "1 minuto" : `${minutos} minutos`;
  } else if (diffAbs < dia) {
    const horas = Math.round(diffAbs / hora);
    texto = horas === 1 ? "1 hora" : `${horas} horas`;
  } else {
    const dias = Math.round(diffAbs / dia);
    texto = dias === 1 ? "1 día" : `${dias} días`;
  }

  return futuro ? `en ${texto}` : `hace ${texto}`;
}

/**
 * Aplica máscara visual de RUT mientras el usuario escribe: `NN.NNN.NNN-DV`.
 * Acepta entradas parciales — solo formatea lo que ya hay, sin bloquear el
 * tipeo. La validación real (dígito verificador) la hace `esRutValido`.
 */
export function enmascararRut(valorCrudo: string): string {
  const limpio = valorCrudo
    .replace(/[^0-9kK]/g, "")
    .toUpperCase()
    .slice(0, 9);

  if (limpio.length <= 1) return limpio;

  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);

  const cuerpoConPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cuerpoConPuntos}-${dv}`;
}

/** Quita máscara visual — deja `NNNNNNNN-DV`, listo para `normalizarYValidarRut`. */
export function limpiarMascaraRut(valorEnmascarado: string): string {
  return valorEnmascarado.replace(/\./g, "").trim();
}
