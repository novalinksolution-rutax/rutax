#!/usr/bin/env node
// =============================================================================
// Verificación de round-trip de descifrado — SOLO imprime "OK" o "FALLO",
// NUNCA el valor descifrado ni la clave. Ver runbook: docs/ops/restauracion.md §5.3
//
// Reimplementa (deliberadamente standalone, sin importar el proyecto Next.js
// para poder correr con `node` puro contra un dump restaurado) el mismo
// formato de paquete y la misma resolución de clave que produccion:
//   - src/modules/integraciones/secretos/cifrado-primitivas.ts (formato del
//     paquete: version(1) || nonce(12) || tag(16) || ciphertext, AES-256-GCM)
//   - src/modules/integraciones/secretos/cifrado.ts (resolverClave: kid "v1"
//     -> SECRETOS_CLAVE_CIFRADO_B64, otro kid -> SECRETOS_CLAVE_CIFRADO_B64_<kid>)
// Si esos módulos cambian de formato/algoritmo, actualiza este script para
// que siga reflejando el mecanismo real.
//
// Uso:
//   node scripts/verificar-descifrado-secreto.mjs <hex-del-valor_cifrado> [kid]
//   # <hex-...>: el valor de `encode(valor_cifrado, 'hex')` en psql, SIN el
//   #            prefijo "\x". [kid]: opcional, default "v1".
//
// Requiere en el entorno: SECRETOS_CLAVE_CIFRADO_B64 (o su variante _<kid>),
// ya presente en .env.local — nunca se imprime su valor.
// =============================================================================
import { createDecipheriv } from "node:crypto";

const LONGITUD_NONCE_BYTES = 12;
const LONGITUD_TAG_BYTES = 16;
const VERSION_FORMATO_PAQUETE = 1;
const ALGORITMO_AEAD = "aes-256-gcm";

const [hexPaquete, kidArg] = process.argv.slice(2);
if (!hexPaquete) {
  console.error(
    "Uso: node verificar-descifrado-secreto.mjs <hex-del-valor_cifrado> [kid]",
  );
  process.exit(2);
}
const kid = kidArg || "v1";

function resolverClave(kid) {
  const nombreVariable =
    kid === "v1" ? "SECRETOS_CLAVE_CIFRADO_B64" : `SECRETOS_CLAVE_CIFRADO_B64_${kid}`;
  const claveB64 = process.env[nombreVariable];
  if (!claveB64) {
    console.error(`FALLO (variable de entorno "${nombreVariable}" ausente)`);
    process.exit(1);
  }
  const clave = Buffer.from(claveB64, "base64");
  if (clave.length !== 32) {
    console.error(`FALLO (la clave "${nombreVariable}" no decodifica a 32 bytes)`);
    process.exit(1);
  }
  return clave;
}

function descifrarPaquete(paquete, clave) {
  if (paquete.length < 1 + LONGITUD_NONCE_BYTES + LONGITUD_TAG_BYTES) {
    throw new Error("paquete demasiado corto");
  }
  const version = paquete.readUInt8(0);
  if (version !== VERSION_FORMATO_PAQUETE) {
    throw new Error(`version de formato desconocida (${version})`);
  }
  let cursor = 1;
  const nonce = paquete.subarray(cursor, cursor + LONGITUD_NONCE_BYTES);
  cursor += LONGITUD_NONCE_BYTES;
  const tag = paquete.subarray(cursor, cursor + LONGITUD_TAG_BYTES);
  cursor += LONGITUD_TAG_BYTES;
  const ciphertext = paquete.subarray(cursor);

  const decipher = createDecipheriv(ALGORITMO_AEAD, clave, Buffer.from(nonce));
  decipher.setAuthTag(Buffer.from(tag));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
}

const clave = resolverClave(kid);
const paquete = Buffer.from(hexPaquete, "hex");

try {
  const textoPlano = descifrarPaquete(paquete, clave);
  // Solo se usa la LONGITUD para confirmar que produjo algo con forma
  // razonable — el contenido nunca se imprime ni se retiene más allá de esto.
  const ok = textoPlano.length > 0;
  textoPlano.fill(0); // descartar el buffer explícitamente
  console.log(ok ? "OK" : "FALLO (paquete vacío tras descifrar)");
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.log(`FALLO (${err.message})`);
  process.exit(1);
}
