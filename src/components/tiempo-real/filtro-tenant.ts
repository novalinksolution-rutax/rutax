/**
 * El filtro de tenant de una suscripción Realtime, y por qué se valida.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 UNA SUSCRIPCIÓN MAL FORMADA DEJA SIN TIEMPO REAL A TODO EL PROYECTO
 * -----------------------------------------------------------------------------
 * Encontrado el 24-08-2026 en el log del contenedor de Realtime:
 *
 * ```
 * PoolingReplicationError: invalid input syntax for type uuid: "null"
 *   en realtime.apply_rls(jsonb, integer) → walrus_rls_stmt
 * ```
 *
 * El filtro viaja como texto —`tenant_id=eq.${tenantId}`— así que un `tenantId`
 * nulo se interpola como **la cadena `"null"`**. Del otro lado, `walrus` arma la
 * consulta de RLS y castea ese valor a `uuid`. El casteo revienta.
 *
 * **Y ahí está lo grave: no falla solo esa suscripción.** `apply_rls` procesa el
 * lote de cambios de todos los suscriptores a la vez, así que la excepción se
 * lleva el lote completo. **Una sola pestaña con el tenant nulo deja sin eventos
 * a todos los usuarios del proyecto**, y ninguno se entera: el indicador sigue
 * diciendo «En vivo» porque el canal está suscrito de verdad — lo que no llega
 * son los datos.
 *
 * Un fallo de disponibilidad que se dispara desde el cliente y que la interfaz
 * declara sano. Por eso la barrera va acá, antes de suscribir, y no en cada
 * pantalla que monta el indicador: basta que **una** se olvide.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SE VALIDA LA FORMA Y NO SOLO QUE «NO SEA NULO»
 * -----------------------------------------------------------------------------
 * `if (!tenantId)` deja pasar `"undefined"`, `"null"` y cualquier cadena que
 * venga de una interpolación previa — que es justo el caso que ocurrió. Lo que
 * hay que garantizar es que el valor **sea casteable a uuid del otro lado**, y
 * eso es una forma, no una ausencia.
 */

/** Un UUID de cualquier versión, en minúsculas o mayúsculas. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ¿Sirve este identificador para armar un filtro de Realtime?
 *
 * Acepta solo lo que Postgres va a poder castear a `uuid`. Todo lo demás —vacío,
 * `"null"`, `"undefined"`, un id truncado— se rechaza acá, donde el costo es no
 * suscribirse, en vez de allá, donde el costo es tumbar el tiempo real de todos.
 */
export function tenantIdEsUsable(tenantId: unknown): tenantId is string {
  return typeof tenantId === "string" && UUID.test(tenantId.trim());
}

/** `tenant_id=eq.<uuid>`. Devuelve `null` si el identificador no sirve. */
export function filtroTenant(tenantId: unknown): string | null {
  return tenantIdEsUsable(tenantId) ? `tenant_id=eq.${tenantId.trim()}` : null;
}
