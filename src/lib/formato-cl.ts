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

// Sin año a propósito: se usa para encabezar el día en curso («jueves 21 de
// agosto»), donde el año es ruido — quien mira ya sabe en qué año está.
const FORMATEADOR_FECHA_LARGA = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  weekday: "long",
  day: "numeric",
  month: "long",
});

// Para referirse a un día cercano dentro de una frase («sin cerrar desde el
// 22-08»), donde el año no aporta y alarga la línea.
const FORMATEADOR_FECHA_CORTA = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  day: "2-digit",
  month: "2-digit",
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

/**
 * `jueves 21 de agosto` — el día escrito, sin año, en zona horaria de Santiago.
 *
 * Para encabezar la jornada en curso. `es-CL` devuelve el día de la semana en
 * minúscula, que es lo correcto en español; si va al principio de una frase,
 * quien lo use pone la mayúscula.
 *
 * ⚠️ **Se arma por partes y no con `.format()` a secas.** `es-CL` mete una coma
 * entre el día de la semana y el resto —«domingo, 23 de agosto»—, así que
 * cualquier frase que ya traiga la suya termina en «Hoy, domingo, 23 de
 * agosto». Se descartan los separadores literales que sean solo una coma y se
 * unen las partes con espacio.
 */
export function formatearFechaLarga(fecha: Date | string): string {
  const valor = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(valor.getTime())) return "—";
  return FORMATEADOR_FECHA_LARGA.formatToParts(valor)
    // La coma se cambia por espacio, no se borra: borrarla se lleva también el
    // espacio que venía pegado a ella y el resultado es «domingo23 de agosto».
    .map((p) => (p.type === "literal" ? p.value.replace(",", " ") : p.value))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `22-08` — día y mes, sin año, en zona horaria de Santiago.
 *
 * Se arma por partes en vez de dejar que `es-CL` decida: pidiéndole solo día y
 * mes devuelve «22/8», con barra y sin rellenar, que no es el formato del resto
 * del producto —`formatearFecha` da `22-08-2026`— y encima desalinea una columna
 * de fechas.
 */
export function formatearFechaCorta(fecha: Date | string): string {
  const valor = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(valor.getTime())) return "—";
  const partes = FORMATEADOR_FECHA_CORTA.formatToParts(valor);
  const dia = partes.find((p) => p.type === "day")?.value ?? "";
  const mes = partes.find((p) => p.type === "month")?.value ?? "";
  return `${dia.padStart(2, "0")}-${mes.padStart(2, "0")}`;
}

/**
 * `2026-08-24` → `24-08`. Para una fecha **civil**, no para un instante.
 *
 * -----------------------------------------------------------------------------
 * 🔴 POR QUÉ NO SIRVE `formatearFechaCorta` PARA ESTO
 * -----------------------------------------------------------------------------
 * `formatearFechaCorta("2026-08-24")` hace `new Date("2026-08-24")`, que la
 * norma manda interpretar como **medianoche UTC**. Formateada en Santiago —cuatro
 * horas atrás— eso son las 20:00 del **23**. O sea: la pantalla dice un día
 * menos, siempre.
 *
 * No es teórico. El chip del filtro de Pedidos mostraba `23-08` estando el
 * filtro puesto en el 24, y el vacío decía «Estás filtrando por … y 23-08».
 * Pasa desapercibido porque **el número se ve razonable**: es un día, del mes
 * correcto, cerca de hoy.
 *
 * La corrección no es elegir mejor la zona horaria: es **no convertir**. Un
 * `YYYY-MM-DD` que viene de la URL o de una columna `date` ya es una fecha civil
 * —no tiene hora ni huso—, así que se parte y se reordena. Sin `Date` de por
 * medio no hay nada que pueda correrse.
 */
export function formatearFechaCivilCorta(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  if (!m) return "—";
  return `${m[3]}-${m[2]}`;
}

/** Nombres de mes en minúscula, como los escribe el español. */
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

/**
 * `2026-08-05` → `5 de agosto de 2026`. Para una fecha **civil**.
 *
 * Hermana de `formatearFechaCivilCorta` y por el mismo motivo: `formatearFechaLarga`
 * hace `new Date("2026-08-05")`, que es medianoche UTC, y en Santiago eso es el
 * **día anterior**. En una fecha de vigencia de un documento legal, un día de
 * diferencia no es un detalle de presentación.
 *
 * Sin `Date` de por medio no hay nada que se pueda correr: se parte la cadena.
 */
export function formatearFechaCivilLarga(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  if (!m) return "—";
  const mes = MESES[Number(m[2]) - 1];
  if (!mes) return "—";
  return `${Number(m[3])} de ${mes} de ${m[1]}`;
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
