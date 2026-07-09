/**
 * Consultas de lectura simples del módulo `identidad` — proyecciones
 * livianas para selects/listas de Server Components. Sin lógica de negocio
 * ni mutaciones (eso vive en `onboarding.ts`/`invitaciones.ts`); este archivo
 * es el lugar para "dame una lista para pintar un <Select>", reusable entre
 * pantallas (hoy: la bandeja de excepciones de conciliación, §1.1 P1).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface UsuarioInterno {
  id: string;
  nombreCompleto: string;
  rol: "dueno" | "administracion";
}

/**
 * Lista los usuarios internos ACTIVOS del tenant con rol dueño o
 * administración — candidatos para "Asignado a" en flujos de gestión interna
 * (p. ej. la bandeja de excepciones de conciliación).
 *
 * Más estricto que `asignarEventoConciliacion` (que también admite usuarios
 * `invitado`, y solo rechaza `suspendido`): aquí solo se listan `activo`
 * porque no tiene sentido ofrecer como responsable a alguien que aún no
 * completó su alta. El backend sigue siendo la fuente de verdad del permiso
 * real — esta lista solo acota las opciones razonables de la UI.
 */
export async function listarUsuariosInternos(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<UsuarioInterno[]> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .select("id, nombre_completo, rol")
    .eq("tenant_id", tenantId)
    .in("rol", ["dueno", "administracion"])
    .eq("estado", "activo")
    .order("nombre_completo", { ascending: true });

  if (error) {
    throw new Error(`Error al listar usuarios internos: ${error.message}`);
  }

  return (data ?? []).map((fila: Record<string, unknown>) => ({
    id: fila.id as string,
    nombreCompleto: fila.nombre_completo as string,
    rol: fila.rol as UsuarioInterno["rol"],
  }));
}

/**
 * Mapa id → razón social de los sellers indicados. Para que las pantallas
 * muestren el nombre del seller en vez del UUID crudo. Lista vacía → mapa
 * vacío sin tocar la BD.
 */
export async function mapaNombresSellers(
  cliente: SupabaseClient,
  tenantId: string,
  sellerIds: string[],
): Promise<Record<string, string>> {
  if (sellerIds.length === 0) return {};

  const { data, error } = await cliente
    .schema("identidad")
    .from("sellers")
    .select("id, razon_social")
    .eq("tenant_id", tenantId)
    .in("id", sellerIds);

  if (error) {
    throw new Error(`Error al resolver nombres de sellers: ${error.message}`);
  }

  return Object.fromEntries(
    (data ?? []).map((fila: Record<string, unknown>) => [
      fila.id as string,
      fila.razon_social as string,
    ]),
  );
}

/**
 * Mapa id → nombre completo de los conductores indicados. Mismo propósito que
 * `mapaNombresSellers`: nombres legibles en vez de UUIDs en las pantallas.
 */
export async function mapaNombresConductores(
  cliente: SupabaseClient,
  tenantId: string,
  conductorIds: string[],
): Promise<Record<string, string>> {
  if (conductorIds.length === 0) return {};

  const { data, error } = await cliente
    .schema("identidad")
    .from("conductores")
    .select("id, nombre_completo")
    .eq("tenant_id", tenantId)
    .in("id", conductorIds);

  if (error) {
    throw new Error(`Error al resolver nombres de conductores: ${error.message}`);
  }

  return Object.fromEntries(
    (data ?? []).map((fila: Record<string, unknown>) => [
      fila.id as string,
      fila.nombre_completo as string,
    ]),
  );
}
