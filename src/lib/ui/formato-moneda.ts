/**
 * Formateo de montos CLP — criterio C-1.
 *
 * Esta es la ÚNICA fuente de verdad para mostrar montos en pesos chilenos.
 * Todas las pantallas de Fase C (y en general) importan `formatearCLP` desde aquí.
 * Sin lógica de formateo ad-hoc en componentes.
 *
 * Formato: $ 1.234.567 — sin decimales, punto como separador de miles.
 */

const FORMATEADOR_CLP = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formatea un monto en CLP al estándar chileno.
 *
 * Criterio C-1: `$ 1.234.567` — sin decimales, sin coma, sin sufijo "CLP".
 * Si el monto es null o undefined: devuelve "—".
 */
/**
 * ⚠️ EL NEGATIVO NO LO DEJA `Intl`.
 *
 * `Intl.NumberFormat("es-CL", {style:"currency"})` devuelve **`$-1.000`**: el
 * guion queda entre el símbolo y la cifra, donde no se lee como signo. Y es un
 * guion (U+002D), no un signo menos.
 *
 * La regla 20 del sistema pide **signo menos real (U+2212), delante**. Nunca un
 * paréntesis contable —que no lo lee quien no es contador— ni solo color, que
 * se pierde al imprimir.
 *
 * Los componentes que ya lo hacían bien —la tabla financiera, el bloque de
 * composición— pasan el valor absoluto y ponen el signo ellos, así que no se
 * duplica. Este arreglo es para todo lo demás, que era la mayoría: el total de
 * una liquidación con penalización mayor que la base salía `$-1.000` en el
 * encabezado, en cuerpo 30.
 */
export function formatearCLP(monto: number): string {
  // El `|| 0` normaliza el CERO NEGATIVO, que no es una curiosidad: `Math.round`
  // devuelve `-0` para todo lo que esté entre −0,5 y 0, `-0 < 0` es **false**, y
  // entonces caía al camino positivo y `Intl` escupía «$-0». Un ajuste de −$0,4
  // —o cualquier resta que dé casi cero— mostraba «menos cero» en pantalla.
  const redondeado = Math.round(monto) || 0;
  if (redondeado < 0) {
    return `−${FORMATEADOR_CLP.format(Math.abs(redondeado))}`;
  }
  return FORMATEADOR_CLP.format(redondeado);
}

/**
 * Formatea un monto nullable. Retorna "—" si es null.
 * Útil para períodos abiertos o liquidaciones en borrador sin monto calculado.
 */
/**
 * Solo los miles, **sin el símbolo**: `867.000`.
 *
 * Para el bloque de composición, donde repetir `$` en cada sumando compite con
 * lo que de verdad hay que leer, que es la resta. El tablero B2a lo escribe así:
 * «867.000 entregas + 3.600 recargos − 2.900 ajustes».
 */
const FORMATEADOR_MILES = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 0,
});

export function formatearMiles(monto: number): string {
  return FORMATEADOR_MILES.format(Math.round(monto));
}

export function formatearCLPOGuion(monto: number | null | undefined): string {
  if (monto === null || monto === undefined) return "—";
  return formatearCLP(monto);
}

/**
 * Formatea un ajuste con signo explícito (+/-).
 * Verde si positivo, rojo si negativo (para uso en tablas de líneas de cobro).
 * Retorna "—" si el ajuste es cero.
 */
export function formatearAjuste(ajuste: number): {
  texto: string;
  esPositivo: boolean;
  esNegativo: boolean;
} {
  if (ajuste === 0) {
    return { texto: "—", esPositivo: false, esNegativo: false };
  }
  const texto = ajuste > 0
    ? `+${formatearCLP(ajuste)}`
    : formatearCLP(ajuste); // CLP negativo ya incluye el signo "-"
  return {
    texto,
    esPositivo: ajuste > 0,
    esNegativo: ajuste < 0,
  };
}
