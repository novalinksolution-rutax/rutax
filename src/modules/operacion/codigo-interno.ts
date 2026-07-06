/**
 * Código interno operativo para pedidos same-day — formato `RX-XXXX-XXXX`.
 *
 * Distinto de `tracking_token` (público, opaco, usado en /tracking/[token]):
 * `codigo_interno` es un identificador corto, legible y escaneable (QR) que el
 * conductor/courier usa para identificar el bulto físicamente en la etiqueta
 * impresa. Se genera en el backend — nunca lo produce el cliente.
 *
 * Alfabeto: Base32 Crockford (sin I, L, O, U — evita confusión visual con
 * 1/0 y con V). Longitud: 8 caracteres útiles (2 grupos de 4) → ~40 bits de
 * entropía (32^8 = 2^40), suficiente para evitar colisiones dentro de un
 * tenant con reintento ante unique_violation.
 */

import { randomInt } from "crypto";

/** Alfabeto Base32 Crockford, sin I, L, O, U. 32 símbolos. */
export const ALFABETO_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Prefijo fijo de todo código interno Rutax. */
export const PREFIJO_CODIGO_INTERNO = "RX";

/** Expresión regular que valida el formato completo `RX-XXXX-XXXX`. */
export const PATRON_CODIGO_INTERNO = /^RX-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/**
 * Genera 8 símbolos aleatorios del alfabeto Crockford usando `crypto.randomInt`
 * (CSPRNG) — no `Math.random()`.
 */
function generarSimbolosAleatorios(cantidad: number): string {
  let salida = "";
  for (let i = 0; i < cantidad; i++) {
    salida += ALFABETO_CROCKFORD[randomInt(0, ALFABETO_CROCKFORD.length)];
  }
  return salida;
}

/**
 * Formatea 8 símbolos crudos en `RX-XXXX-XXXX`. Exportada por separado para
 * poder testear el formato sin depender de aleatoriedad real.
 */
export function formatearCodigoInterno(simbolos: string): string {
  if (simbolos.length !== 8) {
    throw new Error(`formatearCodigoInterno espera 8 símbolos, recibió ${simbolos.length}`);
  }
  return `${PREFIJO_CODIGO_INTERNO}-${simbolos.slice(0, 4)}-${simbolos.slice(4, 8)}`;
}

/** Genera un nuevo código interno aleatorio con formato `RX-XXXX-XXXX`. */
export function generarCodigoInterno(): string {
  return formatearCodigoInterno(generarSimbolosAleatorios(8));
}

/** Verdadero si el string cumple el formato `RX-XXXX-XXXX` en alfabeto Crockford. */
export function esCodigoInternoValido(valor: string): boolean {
  return PATRON_CODIGO_INTERNO.test(valor);
}
