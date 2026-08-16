/**
 * Firmador de solicitudes de Falabella Seller Center.
 *
 * **Función pura**: no toca la red, no lee el reloj, no lee `process.env`. Todo
 * lo variable (el `Timestamp`, la API Key) entra por parámetro. Es el corazón
 * del adaptador: si la cadena que firmamos difiere en UN carácter de la que
 * Falabella reconstruye para verificar, la API responde `E007: Login failed.
 * Signature mismatching` — un error que NO dice qué parámetro se codificó mal.
 * Por eso el vector oficial de la documentación es la prueba principal
 * (`firma.test.ts`), y por eso este archivo no depende de nada del proyecto.
 *
 * ── VERIFICADO CONTRA LA DOCUMENTACIÓN OFICIAL (2026-08-16) ──────────────────
 * Fuente: https://developers.falabella.com/docs/signing-requests
 * («Certificando las Solicitudes») y
 * https://developers.falabella.com/docs/operate-with-apis
 * («Opera con Nuestras APIs»).
 *
 * 1. **Algoritmo**: «el parámetro de firma que requerimos en todas las llamadas
 *    es el HMAC de la cadena de solicitud y su clave API con el algoritmo de
 *    resumen SHA256». La clave del HMAC es la API Key del usuario; el mensaje es
 *    la cadena de solicitud. Resultado en hexadecimal minúscula.
 *
 * 2. **Qué se firma**: «el resultado concatenado de todos los parámetros de la
 *    solicitud, ordenados por nombre, incluyendo parámetros opcionales, y
 *    excluyendo el parámetro Signature».
 *
 * 3. **Codificación**: «Los nombres y valores deben estar codificados en la URL
 *    de acuerdo con el estándar RFC 3986, concatenados con el carácter '='. Cada
 *    conjunto de parámetros (nombre = valor) debe separarse con el carácter
 *    '&'». La implementación de referencia (PHP) usa `rawurlencode`, que es
 *    RFC 3986 estricto. Ver `codificarRfc3986` abajo: `encodeURIComponent` de
 *    JavaScript NO sirve tal cual.
 *
 * 4. **Criterio de orden — resuelto, no supuesto**: la doc solo dice «ordenados
 *    por nombre». Las TRES implementaciones de referencia que publica coinciden
 *    en el mismo criterio, y ninguna usa un orden sensible al idioma:
 *      · PHP    → `ksort($parameters)`                (comparación de bytes)
 *      · Java   → `new TreeMap<String,String>(params)` (orden natural de String)
 *      · Node   → `Object.keys(parameters).sort()`     (orden de code units)
 *    O sea: **orden de bytes, CON distinción de mayúsculas y minúsculas** —
 *    las mayúsculas (`A`=0x41) van antes que las minúsculas (`a`=0x61). Con
 *    este criterio `Action` < `UserID` < `action`; con un orden alfabético
 *    insensible a mayúsculas sería `Action` < `action` < `UserID`, y la firma
 *    saldría distinta. Aquí se compara por bytes UTF-8 (`Buffer.compare`),
 *    que es exactamente lo que hace el `ksort` de la implementación de
 *    referencia, y coincide con las otras dos para todo nombre ASCII (que es
 *    lo único que la API usa). **No usar `localeCompare`**: en español ordena
 *    ignorando mayúsculas y rompería la firma.
 *
 * 5. **Parámetros comunes obligatorios** («Datos adicionales en POST»): «Todas
 *    las llamadas siempre deben incluir los siguientes parámetros: Action,
 *    Timestamp, UserID, Version, y Signature». `Version` «debe ser actualmente
 *    1.0, aunque la versión real de la API sea 2.6.20». `Format` es opcional y
 *    por defecto XML; nosotros pedimos JSON siempre y explícito.
 *
 * 6. **`UserID` NO es secreto**: es el correo del usuario de Seller Center y
 *    viaja en claro en cada query string. El secreto es la **API Key**, que
 *    nunca sale de aquí: se usa como clave del HMAC y jamás se copia a un
 *    mensaje de error, a un log ni a la URL.
 */

import { createHmac } from "node:crypto";

/**
 * Versión de la API que exige la documentación. Es literal: no es la versión
 * real del backend (hoy 2.6.x), es un valor de protocolo fijo en "1.0".
 */
export const VERSION_API_FALABELLA = "1.0";

/** Nombre del parámetro que se excluye de la cadena a firmar. */
export const PARAMETRO_FIRMA = "Signature";

export type ValorParametro = string | number;

/**
 * Parámetros de una solicitud. Un valor `undefined` se OMITE de la firma y, por
 * construcción, también de la URL — porque la misma función produce las dos
 * cosas (ver `construirQueryFirmada`). Es la única forma de garantizar que lo
 * firmado y lo enviado no puedan divergir.
 */
export type ParametrosFalabella = Record<string, ValorParametro | undefined>;

export class ErrorFirmaFalabella extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorFirmaFalabella";
  }
}

/**
 * Codificación porcentual RFC 3986 estricta.
 *
 * `encodeURIComponent` **no** cumple RFC 3986: deja sin escapar `!`, `'`, `(`,
 * `)` y `*`, que son *sub-delims* reservados y sí deben ir escapados. El propio
 * ejemplo en Node.js de la documentación de Falabella usa `encodeURIComponent`
 * a secas — está mal, y falla exactamente el día que un valor traiga un
 * paréntesis (un nombre de destinatario, una razón social, un texto libre).
 * La implementación de referencia es la de PHP (`rawurlencode`), y esta función
 * la reproduce.
 *
 * Conjunto de caracteres NO reservados (RFC 3986 §2.3), los únicos que quedan
 * literales: `A-Z a-z 0-9 - . _ ~`. Todo lo demás va como `%XX` en hexadecimal
 * MAYÚSCULA sobre los bytes UTF-8 del carácter (`encodeURIComponent` ya emite
 * mayúsculas y ya usa UTF-8; solo hay que taparle los cinco huecos).
 *
 * Nota sobre `~`: `encodeURIComponent` lo deja literal y eso es correcto — es
 * no reservado en RFC 3986. (El `urlencode` de PHP, en cambio, lo escaparía;
 * por eso la referencia usa `rawurlencode` y no `urlencode`.)
 */
export function codificarRfc3986(valor: string): string {
  return encodeURIComponent(valor).replace(
    /[!'()*]/g,
    (caracter) => `%${caracter.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Comparador de nombres de parámetro: orden de bytes UTF-8, sensible a
 * mayúsculas. Ver el punto 4 de la cabecera para por qué este criterio y no
 * otro.
 */
export function compararNombresParametro(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function normalizarValor(nombre: string, valor: ValorParametro): string {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) {
      throw new ErrorFirmaFalabella(
        `El parámetro "${nombre}" tiene un valor numérico no finito; no se puede firmar.`,
      );
    }
    return String(valor);
  }
  return valor;
}

/**
 * Construye la cadena canónica que se firma: pares `nombre=valor` codificados
 * RFC 3986, ordenados por nombre y unidos con `&`, sin el parámetro
 * `Signature`.
 *
 * Se exporta porque es lo que hay que poder inspeccionar cuando la API contesta
 * `E007: Signature mismatching`: la cadena no contiene la API Key, así que es
 * seguro compararla a mano. **No contiene secretos.**
 */
export function construirCadenaAFirmar(parametros: ParametrosFalabella): string {
  if (PARAMETRO_FIRMA in parametros) {
    // No es un descuido tolerable: firmar la firma da una cadena distinta a la
    // que el servidor reconstruye, y el síntoma sería un E007 inexplicable.
    throw new ErrorFirmaFalabella(
      `El parámetro "${PARAMETRO_FIRMA}" no puede venir en los parámetros: se excluye de la cadena a firmar y lo agrega el firmador.`,
    );
  }

  const nombres = Object.keys(parametros)
    .filter((nombre) => parametros[nombre] !== undefined)
    .sort(compararNombresParametro);

  if (nombres.length === 0) {
    throw new ErrorFirmaFalabella("No hay parámetros que firmar.");
  }

  return nombres
    .map((nombre) => {
      const valor = normalizarValor(nombre, parametros[nombre] as ValorParametro);
      return `${codificarRfc3986(nombre)}=${codificarRfc3986(valor)}`;
    })
    .join("&");
}

/**
 * HMAC-SHA256 hexadecimal de la cadena canónica, con la API Key como clave.
 *
 * `apiKey` es un secreto: entra, se usa y no se guarda en ningún lado. Si
 * alguna vez esta función lanzara un error, el mensaje NO debe incluirla.
 */
export function firmarParametros(parametros: ParametrosFalabella, apiKey: string): string {
  if (!apiKey) {
    throw new ErrorFirmaFalabella("Falta la API Key de Falabella para firmar la solicitud.");
  }

  const cadena = construirCadenaAFirmar(parametros);
  return createHmac("sha256", apiKey).update(cadena, "utf8").digest("hex");
}

/**
 * Query string completa y lista para usar: la cadena canónica más
 * `&Signature=<hmac>`.
 *
 * **Esta es la superficie que debe usar el cliente HTTP**, y no
 * `firmarParametros` por un lado y una URL armada por otro: lo firmado y lo
 * enviado salen del mismo string, así que no pueden divergir. La firma es
 * hexadecimal (`[0-9a-f]`), así que no necesita codificación adicional.
 */
export function construirQueryFirmada(parametros: ParametrosFalabella, apiKey: string): string {
  const cadena = construirCadenaAFirmar(parametros);
  const firma = createHmac("sha256", apiKey).update(cadena, "utf8").digest("hex");
  return `${cadena}&${PARAMETRO_FIRMA}=${firma}`;
}

/**
 * `Timestamp` en ISO 8601 con offset explícito, como pide la documentación:
 * «La hora actual en formato ISO8601 relativo a UTC (por ejemplo,
 * Timestamp=2015-04-01T10:00:00+02:00 …)». Se emite siempre en UTC con offset
 * `+00:00` — la misma forma del vector oficial de la doc.
 *
 * Se emite SIN milisegundos a propósito: el ejemplo canónico de la doc no los
 * lleva. (Algunos ejemplos recientes de cURL de la propia doc usan la forma
 * `…Z` con milisegundos, así que ambas parecen aceptarse, pero se elige la
 * documentada como canónica.)
 *
 * El `+` y los `:` del resultado son justamente los caracteres que hay que
 * escapar bien al firmar (`%2B`, `%3A`): este parámetro es el que destapa una
 * codificación mal hecha.
 *
 * Ojo con el reloj: la API rechaza marcas de tiempo viejas o futuras con
 * `E003: Timestamp has expired`. Por eso el cliente HTTP genera un `Timestamp`
 * nuevo en CADA intento, en vez de firmar una vez y reintentar la misma cadena.
 */
export function timestampFalabella(fecha: Date): string {
  if (Number.isNaN(fecha.getTime())) {
    throw new ErrorFirmaFalabella("Fecha inválida para construir el Timestamp de Falabella.");
  }

  // Se arma campo por campo en UTC en vez de recortar un `toISOString()`, por
  // dos razones que apuntan al mismo lado. La de forma: el guard
  // `src/lib/fecha-santiago.guard.test.ts` prohíbe truncar un instante ISO, y
  // su exención es de un solo archivo — no se toca. La de fondo: aquí NO se
  // está derivando una fecha civil chilena (para eso está
  // `src/lib/fecha-santiago.ts`); es la marca de tiempo de un protocolo, que
  // Falabella exige en UTC y que no debe seguir el huso de Santiago jamás.
  const cero = (valor: number, ancho = 2) => String(valor).padStart(ancho, "0");

  const anio = cero(fecha.getUTCFullYear(), 4);
  const mes = cero(fecha.getUTCMonth() + 1);
  const dia = cero(fecha.getUTCDate());
  const hora = cero(fecha.getUTCHours());
  const minuto = cero(fecha.getUTCMinutes());
  const segundo = cero(fecha.getUTCSeconds());

  return `${anio}-${mes}-${dia}T${hora}:${minuto}:${segundo}+00:00`;
}
