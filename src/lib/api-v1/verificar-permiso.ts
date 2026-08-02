/**
 * Verificación de permisos para /api/v1/.
 *
 * Comprueba que el contexto de la API key incluya el permiso requerido.
 * Simple contiene-en-array: la lista de permisos la define el tenant al
 * crear la clave (`accionCrearApiKey`), y la valida el endpoint.
 *
 * Permisos disponibles (convención):
 *   - 'pedidos:leer'
 *   - 'liquidaciones:leer'
 *   - 'webhooks:gestionar'
 */

import type { ContextoApiKey } from './autenticar-api-key';

/**
 * Devuelve `true` si el contexto de la API key incluye el permiso indicado.
 */
export function verificarPermiso(contexto: ContextoApiKey, permiso: string): boolean {
  return contexto.permisos.includes(permiso);
}
