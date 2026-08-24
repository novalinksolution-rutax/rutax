/**
 * Quién aplicó el ajuste de una liquidación.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTO NO SALE DE LA FILA
 * -----------------------------------------------------------------------------
 * `dinero.liquidaciones` guarda `bono_clp`, `penalizacion_clp` y `nota_ajuste`,
 * pero **no quién los puso**. El autor está en la bitácora, bajo la acción
 * `dinero.liquidacion_ajustada`, que es donde tiene que estar: es el registro de
 * auditoría, no un campo de negocio.
 *
 * -----------------------------------------------------------------------------
 * Y POR QUÉ EL CONDUCTOR LO VE
 * -----------------------------------------------------------------------------
 * El tablero lo pide con una razón que vale la pena conservar: el motivo del
 * ajuste **es el que Administración escribió sabiendo que él lo iba a leer**. Un
 * descuento firmado con nombre se discute con una persona; uno anónimo se
 * discute con «el sistema», y esa conversación termina en el teléfono del
 * coordinador.
 *
 * ⚠️ Se devuelve **el nombre, no el correo ni el identificador**. El conductor
 * necesita saber con quién hablar, no cómo escribirle por otro canal.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AutorAjuste {
  nombre: string;
  /** Cuándo se aplicó, en ISO. La pantalla lo formatea. */
  fecha: string;
}

export async function resolverAutorDeAjuste(
  cliente: SupabaseClient,
  entrada: { tenantId: string; liquidacionId: string },
): Promise<AutorAjuste | null> {
  const { data, error } = await cliente
    .schema("identidad")
    .from("bitacora_auditoria")
    .select("actor_usuario_id, creado_en")
    .eq("tenant_id", entrada.tenantId)
    .eq("entidad_tipo", "liquidacion")
    .eq("entidad_id", entrada.liquidacionId)
    .eq("accion", "dinero.liquidacion_ajustada")
    // El ÚLTIMO ajuste, no el primero: si Administración corrigió su propia
    // corrección, el que rige es el de arriba.
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Un fallo acá no puede tumbar la pantalla: la liquidación se muestra igual,
  // solo que el ajuste queda sin firma. Es peor perder la cifra que la firma.
  if (error || !data?.actor_usuario_id) return null;

  const { data: perfil } = await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .select("nombre_completo")
    .eq("id", data.actor_usuario_id as string)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  const nombre = (perfil?.nombre_completo as string | null)?.trim();
  if (!nombre) return null;

  return { nombre, fecha: data.creado_en as string };
}
