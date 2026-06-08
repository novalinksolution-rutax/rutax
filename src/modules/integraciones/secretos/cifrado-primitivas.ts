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
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ALGORITMO_AEAD = "aes-256-gcm";
export const LONGITUD_NONCE_BYTES = 12; // recomendado para GCM
export const LONGITUD_TAG_BYTES = 16;
export const VERSION_FORMATO_PAQUETE = 1;
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
 */
export function cifrarPaquete(valor: string | Uint8Array, clave: Buffer): Buffer {
  validarClave(clave);

  const nonce = randomBytes(LONGITUD_NONCE_BYTES);
  const cipher = createCipheriv(ALGORITMO_AEAD, clave, nonce);
  const textoPlano = aBuffer(valor);
  const ciphertext = Buffer.concat([cipher.update(textoPlano), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([Buffer.from([VERSION_FORMATO_PAQUETE]), nonce, tag, ciphertext]);
}

/**
 * Descifra un paquete producido por `cifrarPaquete`. Lanza
 * `ErrorDescifradoFallido` (sin envolver la causa, que podría incluir
 * fragmentos del buffer) si: la clave es incorrecta, el paquete fue alterado,
 * o el formato/versión no se reconoce.
 */
export function descifrarPaquete(paquete: Buffer, clave: Buffer): Buffer {
  validarClave(clave);

  if (paquete.length < 1 + LONGITUD_NONCE_BYTES + LONGITUD_TAG_BYTES) {
    throw new ErrorDescifradoFallido("Paquete cifrado demasiado corto — formato inválido o dato corrupto.");
  }

  const version = paquete.readUInt8(0);
  if (version !== VERSION_FORMATO_PAQUETE) {
    throw new ErrorDescifradoFallido(
      `Versión de formato desconocida (${version}). ¿Datos de un esquema de empaquetado distinto?`,
    );
  }

  let cursor = 1;
  const nonce = paquete.subarray(cursor, cursor + LONGITUD_NONCE_BYTES);
  cursor += LONGITUD_NONCE_BYTES;
  const tag = paquete.subarray(cursor, cursor + LONGITUD_TAG_BYTES);
  cursor += LONGITUD_TAG_BYTES;
  const ciphertext = paquete.subarray(cursor);

  const decipher = createDecipheriv(ALGORITMO_AEAD, clave, Buffer.from(nonce));
  decipher.setAuthTag(Buffer.from(tag));

  try {
    return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
  } catch {
    throw new ErrorDescifradoFallido(
      "Verificación de integridad (AEAD) fallida — clave incorrecta, dato alterado o corrupto.",
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
