/**
 * Normalización de dirección/comuna + hash determinista del cache.
 * =====================================================================
 *
 * Punto único donde se decide cómo se normaliza una dirección antes de:
 *   1. calcular su `clave_hash` (punto de upsert en `integraciones.geocoding_cache`), y
 *   2. compararla contra el catálogo `COMUNAS_RM` (comuna canónica).
 *
 * El algoritmo de hash DEBE ser estable: si cambia, el cache global queda
 * invalidado (las claves dejan de coincidir). Por eso vive aquí, aislado y
 * cubierto por tests, y no disperso en el job ni en los adaptadores.
 */

import { createHash } from 'node:crypto';
import { COMUNAS_RM } from '@/lib/ui/comunas-rm';

/**
 * Normaliza un texto para comparación/hash:
 *   - quita acentos (NFD + strip diacríticos),
 *   - pasa a minúsculas,
 *   - colapsa espacios internos a uno solo,
 *   - recorta extremos.
 *
 * Determinista y sin I/O.
 */
function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // quitar diacríticos (combining marks)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normaliza una dirección de calle (trim, lowercase, colapso de espacios). */
export function normalizarDireccion(direccion: string): string {
  return normalizarTexto(direccion);
}

/**
 * Resuelve la comuna canónica del catálogo `COMUNAS_RM` a partir del texto
 * declarado (tolerante a acentos y mayúsculas). Devuelve el nombre EXACTO del
 * catálogo (p. ej. "Ñuñoa", "Peñalolén") o `null` si no está en la RM.
 */
export function resolverComunaCanonica(comuna: string): string | null {
  const objetivo = normalizarTexto(comuna);
  for (const candidata of COMUNAS_RM) {
    if (normalizarTexto(candidata) === objetivo) {
      return candidata;
    }
  }
  return null;
}

/**
 * Normaliza la comuna a su forma minúscula-sin-acentos para el hash. Si la
 * comuna está en el catálogo usa la canónica; si no, normaliza el texto crudo
 * (así una comuna fuera de la RM sigue produciendo un hash estable y cacheable).
 */
export function normalizarComuna(comuna: string): string {
  const canonica = resolverComunaCanonica(comuna);
  return normalizarTexto(canonica ?? comuna);
}

/**
 * Calcula la `clave_hash` determinista de una dirección+comuna.
 *
 * Construcción: `sha256( direccion_norm + '|' + comuna_norm )` en hex.
 * El separador `|` evita colisiones entre ("ab","c") y ("a","bc").
 *
 * Es el punto de upsert en `integraciones.geocoding_cache` (columna UNIQUE).
 */
export function calcularClaveHash(direccion: string, comuna: string): {
  claveHash: string;
  direccionNorm: string;
  comunaNorm: string;
} {
  const direccionNorm = normalizarDireccion(direccion);
  const comunaNorm = normalizarComuna(comuna);
  const claveHash = createHash('sha256')
    .update(`${direccionNorm}|${comunaNorm}`, 'utf8')
    .digest('hex');
  return { claveHash, direccionNorm, comunaNorm };
}
