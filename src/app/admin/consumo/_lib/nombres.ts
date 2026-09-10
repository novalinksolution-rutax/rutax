/**
 * Resolución de nombres para las pantallas de Consumo: los agregados
 * (`consumo-agregado.ts`) devuelven `tenantId`/`usuarioId` (UUIDs) — el
 * usuario pidió identificar "por courier → usuario", no leer UUIDs sueltos.
 *
 * `usuarioId` en `infra.eventos_consumo` es el `usuario_id` que capturó
 * `autenticarBearer`/la sesión (ver `src/lib/consumo/index.ts`), que es el
 * mismo id de `identidad.usuarios_perfil` (el uid de Supabase Auth) — se
 * resuelve por ahí, no por `identidad.conductores` (que tiene su propio `id`
 * distinto). Si no se encuentra el nombre, cae a los primeros 8 caracteres
 * del UUID: nunca se deja la celda vacía.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";

type ClienteServiceRole = ReturnType<typeof crearClienteServiceRole>;

/** Primeros 8 caracteres del UUID, el respaldo cuando no hay nombre que mostrar. */
export function acortarId(id: string | null): string {
  if (!id) return "—";
  return id.slice(0, 8);
}

/** `tenantId` → `nombre_fantasia`, para TODOS los couriers que aparezcan en la ventana. */
export async function resolverNombresCourier(
  tenantIds: Array<string | null>,
  cliente: ClienteServiceRole = crearClienteServiceRole(),
): Promise<Map<string, string>> {
  const ids = [...new Set(tenantIds.filter((id): id is string => id !== null))];
  const mapa = new Map<string, string>();
  if (ids.length === 0) return mapa;

  const { data, error } = await cliente
    .schema("identidad")
    .from("tenants")
    .select("id, nombre_fantasia")
    .in("id", ids);
  if (error) throw new Error(`Error al resolver nombres de courier: ${error.message}`);

  for (const fila of (data ?? []) as Array<{ id: string; nombre_fantasia: string | null }>) {
    mapa.set(fila.id, fila.nombre_fantasia ?? acortarId(fila.id));
  }
  return mapa;
}

/** `usuarioId` → `nombre_completo` (de `identidad.usuarios_perfil`, el uid de Auth). */
export async function resolverNombresUsuario(
  usuarioIds: Array<string | null>,
  cliente: ClienteServiceRole = crearClienteServiceRole(),
): Promise<Map<string, string>> {
  const ids = [...new Set(usuarioIds.filter((id): id is string => id !== null))];
  const mapa = new Map<string, string>();
  if (ids.length === 0) return mapa;

  const { data, error } = await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .select("id, nombre_completo")
    .in("id", ids);
  if (error) throw new Error(`Error al resolver nombres de usuario: ${error.message}`);

  for (const fila of (data ?? []) as Array<{ id: string; nombre_completo: string | null }>) {
    mapa.set(fila.id, fila.nombre_completo ?? acortarId(fila.id));
  }
  return mapa;
}
