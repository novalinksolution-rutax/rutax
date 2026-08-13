/**
 * Primitivas puras de cifrado simétrico autenticado (AES-256-GCM).
 *
 * Separadas de `cifrado.ts` deliberadamente: aquí NO hay llamadas a Supabase
 * ni lectura de variables de entorno — solo la operación criptográfica sobre
 * buffers ya resueltos. Esto permite probar el round-trip
 * cifrar→empaquetar→desempaquetar→descifrar (y sus casos de fallo: clave
 * incorrecta, dato corrupto/alterado) sin un backend real — la prueba de
 * resiliencia más importante de este módulo: "¿el mecanismo de cifrado en sí
 * es correcto y detecta manipulación?".
 *
 * `cifrado.ts` (la capa que sí habla con Supabase y con el entorno) es un
 * envoltorio delgado sobre estas funciones.
 *
 * AAD (Additional Authenticated Data) — opcional, versión de paquete propia
 * ------------------------------------------------------------------------
 * `cifrarPaquete`/`descifrarPaquete` aceptan un tercer parámetro `aad`
 * opcional. AEAD autentica la AAD junto al ciphertext SIN cifrarla y SIN
 * incluirla en el paquete serializado: quien descifra debe volver a proveer
 * el MISMO valor por fuera del paquete (típicamente derivado de columnas
 * inmutables de la fila que lo contiene — p. ej., para el retiro en bodega,
 * `tenant_id || ':' || bulto_id`; ver `docs/arquitectura/retiro-y-ruteo.md`
 * §3). Eso liga criptográficamente el paquete a "dónde vive": copiarlo a otra
 * fila o a otro tenant hace fallar el descifrado aunque la clave sea
 * correcta.
 *
 * Un paquete cifrado CON AAD usa un byte de versión distinto
 * (`VERSION_FORMATO_PAQUETE_CON_AAD`) del que usa uno SIN AAD
 * (`VERSION_FORMATO_PAQUETE`) — a propósito, no reutilizado. Si ambos casos
 * compartieran versión, un descifrado fallido por "se me olvidó pasar la
 * AAD" y uno fallido por "clave incorrecta"/"dato corrupto" serían
 * indistinguibles: los dos terminan en el mismo `catch` genérico de AEAD.
 * Con versiones separadas, la ausencia/presencia de AAD se valida ANTES de
 * tocar criptografía, con un mensaje que dice exactamente qué faltó —
 * distinto del error genérico de verificación AEAD. Este modo de falla
 * genérico ya complicó un diagnóstico real (sondeo de salud de conexiones ML,
 * ver memoria del proyecto).
 *
 * Los paquetes existentes (todos v1, sin AAD — hoy los de
 * `identidad.secretos_cifrados`) siguen descifrando sin tocarlos: no pasar
 * `aad` preserva exactamente el formato y el comportamiento anteriores a este
 * cambio.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ALGORITMO_AEAD = "aes-256-gcm";
export const LONGITUD_NONCE_BYTES = 12; // recomendado para GCM
export const LONGITUD_TAG_BYTES = 16;
export const VERSION_FORMATO_PAQUETE = 1;
/**
 * Byte de versión para paquetes cifrados CON AAD — ver nota de AAD arriba.
 * El resto del formato serializado (nonce/tag/ciphertext) es idéntico entre
 * ambas versiones; la AAD nunca viaja dentro del paquete, así que esta
 * versión solo existe para diagnóstico (distinguir "falta AAD" de "clave
 * incorrecta"), no porque el layout de bytes cambie.
 */
export const VERSION_FORMATO_PAQUETE_CON_AAD = 2;
export const LONGITUD_CLAVE_BYTES = 32; // AES-256

export class ErrorDescifradoFallido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDescifradoFallido";
  }
}

function aBuffer(valor: string | Uint8Array): Buffer {
  return typeof valor === "string" ? Buffer.from(valor, "utf8") : Buffer.from(valor);
}

/**
 * Cifra `valor` con AES-256-GCM y devuelve el paquete serializado
 * `version || nonce || tag || ciphertext`, listo para `valor_cifrado bytea`.
 *
 * AEAD: el resultado es simultáneamente confidencial (cifrado) y verificable
 * (autenticado) — cualquier alteración del paquete hace fallar el descifrado
 * con `ErrorDescifradoFallido`, nunca devuelve datos corruptos en silencio.
 *
 * `aad` (opcional) — Additional Authenticated Data: un string o buffer
 * arbitrario que se autentica junto con `valor` pero NUNCA se cifra ni se
 * incluye en el paquete devuelto; quien descifre debe volver a proveer
 * exactamente el mismo valor por fuera. Sirve para ligar el criptograma a su
 * contexto (p. ej. `tenant_id || ':' || bulto_id`): si el paquete se copia a
 * otra fila o a otro tenant, la AAD ya no calza y el descifrado falla aunque
 * la clave sea correcta. Pasar `aad` produce un paquete de formato
 * `VERSION_FORMATO_PAQUETE_CON_AAD`; omitirlo preserva exactamente el
 * formato/comportamiento históricos (`VERSION_FORMATO_PAQUETE`).
 */
export function cifrarPaquete(
  valor: string | Uint8Array,
  clave: Buffer,
  aad?: string | Uint8Array,
): Buffer {
  validarClave(clave);

  const nonce = randomBytes(LONGITUD_NONCE_BYTES);
  const cipher = createCipheriv(ALGORITMO_AEAD, clave, nonce);
  if (aad !== undefined) {
    cipher.setAAD(aBuffer(aad));
  }
  const textoPlano = aBuffer(valor);
  const ciphertext = Buffer.concat([cipher.update(textoPlano), cipher.final()]);
  const tag = cipher.getAuthTag();

  const version = aad !== undefined ? VERSION_FORMATO_PAQUETE_CON_AAD : VERSION_FORMATO_PAQUETE;
  return Buffer.concat([Buffer.from([version]), nonce, tag, ciphertext]);
}

/**
 * Descifra un paquete producido por `cifrarPaquete`. Lanza
 * `ErrorDescifradoFallido` (sin envolver la causa, que podría incluir
 * fragmentos del buffer) si: la clave es incorrecta, el paquete fue alterado,
 * el formato/versión no se reconoce, o la AAD no coincide con la usada al
 * cifrar.
 *
 * `aad` debe ser EXACTAMENTE el mismo valor pasado a `cifrarPaquete` para ese
 * paquete:
 *  - Paquete v1 (sin AAD) + se provee `aad` → falla explícita ANTES de tocar
 *    criptografía: el paquete nunca se cifró con AAD.
 *  - Paquete v2 (con AAD) + NO se provee `aad` → falla explícita ANTES de
 *    tocar criptografía: falta un dato obligatorio para este formato.
 *  - Paquete v2 + se provee una `aad` distinta de la usada al cifrar → falla
 *    en la verificación AEAD del tag (misma familia de error que clave
 *    incorrecta o dato alterado — la AAD incorrecta es, para GCM, tan
 *    "manipulación" como un byte alterado del ciphertext).
 * Las dos primeras validan la VERSIÓN del paquete contra la presencia del
 * argumento — por eso pueden dar un mensaje específico ("faltó AAD"/"sobró
 * AAD") en vez de caer en el genérico de abajo.
 */
export function descifrarPaquete(paquete: Buffer, clave: Buffer, aad?: string | Uint8Array): Buffer {
  validarClave(clave);

  if (paquete.length < 1 + LONGITUD_NONCE_BYTES + LONGITUD_TAG_BYTES) {
    throw new ErrorDescifradoFallido("Paquete cifrado demasiado corto — formato inválido o dato corrupto.");
  }

  const version = paquete.readUInt8(0);
  if (version !== VERSION_FORMATO_PAQUETE && version !== VERSION_FORMATO_PAQUETE_CON_AAD) {
    throw new ErrorDescifradoFallido(
      `Versión de formato desconocida (${version}). ¿Datos de un esquema de empaquetado distinto?`,
    );
  }

  const paqueteRequiereAad = version === VERSION_FORMATO_PAQUETE_CON_AAD;
  if (paqueteRequiereAad && aad === undefined) {
    throw new ErrorDescifradoFallido(
      `El paquete es formato v${VERSION_FORMATO_PAQUETE_CON_AAD} (cifrado con AAD) pero no se proveyó ` +
        "AAD al descifrar. No es una falla de clave/integridad: falta un argumento obligatorio.",
    );
  }
  if (!paqueteRequiereAad && aad !== undefined) {
    throw new ErrorDescifradoFallido(
      `Se proveyó AAD pero el paquete es formato v${VERSION_FORMATO_PAQUETE} (sin AAD). ` +
        "No es una falla de clave/integridad: este paquete nunca se cifró con AAD.",
    );
  }

  let cursor = 1;
  const nonce = paquete.subarray(cursor, cursor + LONGITUD_NONCE_BYTES);
  cursor += LONGITUD_NONCE_BYTES;
  const tag = paquete.subarray(cursor, cursor + LONGITUD_TAG_BYTES);
  cursor += LONGITUD_TAG_BYTES;
  const ciphertext = paquete.subarray(cursor);

  const decipher = createDecipheriv(ALGORITMO_AEAD, clave, Buffer.from(nonce));
  if (aad !== undefined) {
    decipher.setAAD(aBuffer(aad));
  }
  decipher.setAuthTag(Buffer.from(tag));

  try {
    return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
  } catch {
    throw new ErrorDescifradoFallido(
      "Verificación de integridad (AEAD) fallida — clave incorrecta, AAD distinta de la usada al " +
        "cifrar, o dato alterado/corrupto.",
    );
  }
}

function validarClave(clave: Buffer): void {
  if (clave.length !== LONGITUD_CLAVE_BYTES) {
    throw new Error(
      `La clave de cifrado debe tener ${LONGITUD_CLAVE_BYTES} bytes (AES-256); se recibieron ${clave.length}.`,
    );
  }
}
