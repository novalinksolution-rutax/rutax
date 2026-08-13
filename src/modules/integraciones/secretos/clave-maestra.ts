/**
 * Resolución de la clave maestra de cifrado (AES-256-GCM) y su esquema de
 * `kid` (identificador de versión de clave, para rotación).
 * =====================================================================
 *
 * Extraído de `cifrado.ts` (donde vivía privado, como `resolverClave`) para
 * que OTRO consumidor de las primitivas de `cifrado-primitivas.ts` — hoy el
 * retiro en bodega (etapa 3 de `docs/arquitectura/retiro-y-ruteo-plan.md`,
 * que cifra `hash_code` del QR de Flex con AAD `tenant_id || ':' ||
 * bulto_id`, fuera de `identidad.secretos_cifrados`) — use la MISMA clave
 * maestra y el MISMO esquema de `kid`, sin duplicar la lectura de variables
 * de entorno ni el mapeo kid→variable. Mismo movimiento que
 * `resolverCoordenadaConCache` en la etapa 2 (ver
 * `src/modules/integraciones/geocoding/resolver-coordenada.ts`).
 *
 * `cifrado.ts` (la capa que persiste en `identidad.secretos_cifrados`) sigue
 * siendo la única que decide política de metadata/persistencia; este módulo
 * solo resuelve la clave — no toca Supabase ni sabe nada de tablas.
 *
 * Nunca registra el VALOR de una variable de entorno en un error — solo su
 * nombre (regla dura del proyecto: certificados y tokens, nunca en logs).
 */

import { LONGITUD_CLAVE_BYTES } from "./cifrado-primitivas";

/**
 * Identificador de la versión/clave activa. Permite rotar claves: las filas
 * antiguas guardan su `kid` usado y quien descifra elige la clave
 * correspondiente. Hoy solo existe la clave activa ("v1").
 *
 * Variable de entorno compartida (`SECRETOS_CIFRADO_KID`) — un solo
 * interruptor de rotación para TODO lo que use esta clave maestra, no uno
 * por consumidor.
 */
export const KID_ACTIVO = process.env.SECRETOS_CIFRADO_KID ?? "v1";

/**
 * Resuelve la clave maestra de cifrado a partir de variables de entorno
 * gestionadas por `devops` (nunca en el repo, nunca en logs).
 *
 * Formato esperado: base64 de 32 bytes (256 bits) — `SECRETOS_CLAVE_CIFRADO_B64`.
 * Se permite registrar varias claves con sufijo `_<KID>` para soportar
 * rotación: `SECRETOS_CLAVE_CIFRADO_B64`, `SECRETOS_CLAVE_CIFRADO_B64_v2`, …
 */
export function resolverClave(kid: string): Buffer {
  const nombreVariable =
    kid === "v1" ? "SECRETOS_CLAVE_CIFRADO_B64" : `SECRETOS_CLAVE_CIFRADO_B64_${kid}`;

  const claveB64 = process.env[nombreVariable];
  if (!claveB64) {
    // No incluir el VALOR de la variable — solo su nombre, jamás el contenido.
    throw new Error(
      `No hay clave de cifrado configurada para kid="${kid}" ` +
        `(variable de entorno "${nombreVariable}" ausente). ` +
        "Configúrala vía el gestor de secretos del despliegue — nunca en el repo.",
    );
  }

  const clave = Buffer.from(claveB64, "base64");
  if (clave.length !== LONGITUD_CLAVE_BYTES) {
    throw new Error(
      `La clave de cifrado para kid="${kid}" debe decodificar a ${LONGITUD_CLAVE_BYTES} bytes ` +
        `(AES-256); se obtuvieron ${clave.length}. Revisa la variable de entorno (no se loguea su valor).`,
    );
  }

  return clave;
}
