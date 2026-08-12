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

/** Proyección mínima de `identidad.usuarios_perfil` para "quién hizo esto" en UI interna. */
export interface UsuarioBasico {
  id: string;
  nombreCompleto: string;
  tipoUsuario: "interno" | "seller" | "conductor" | "super_admin";
}

/**
 * Mapa id → {nombre, tipoUsuario} de los usuarios indicados (cualquier tipo —
 * `usuarios_perfil` es 1:1 con `auth.users` sin importar rol). Pensado para
 * mostrar "cancelado por <nombre>" en el detalle interno del pedido
 * (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md §6.1): el actor de
 * una cancelación puede ser un usuario interno O el propio seller, y el
 * `tipoUsuario` es lo que permite distinguir "cancelado por tu equipo" de
 * "cancelado por el seller" en el texto. Uso exclusivo de pantallas internas
 * — el portal del seller NO debe llamar a esta función (expondría el nombre
 * de un usuario interno a un tenant ajeno a su propia organización; el portal
 * resuelve "quién" sin nombre, solo por `tipo_usuario`).
 */
export async function mapaNombresUsuarios(
  cliente: SupabaseClient,
  tenantId: string,
  usuarioIds: string[],
): Promise<Record<string, UsuarioBasico>> {
  if (usuarioIds.length === 0) return {};

  const { data, error } = await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .select("id, nombre_completo, tipo_usuario")
    .eq("tenant_id", tenantId)
    .in("id", usuarioIds);

  if (error) {
    throw new Error(`Error al resolver nombres de usuarios: ${error.message}`);
  }

  return Object.fromEntries(
    (data ?? []).map((fila: Record<string, unknown>) => [
      fila.id as string,
      {
        id: fila.id as string,
        nombreCompleto: fila.nombre_completo as string,
        tipoUsuario: fila.tipo_usuario as UsuarioBasico["tipoUsuario"],
      },
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
