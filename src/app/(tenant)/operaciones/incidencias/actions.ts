"use server";

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { actualizarIncidencia } from "@/modules/operacion/incidencias";
import { puedeGestionarIncidencias } from "@/modules/identidad/capacidades";
import type { EstadoIncidencia } from "@/modules/operacion/tipos";

export async function actionActualizarIncidencia(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { error: "Sin sesión." };

  if (!puedeGestionarIncidencias(sesion.usuario)) {
    return { error: "No tienes permiso para gestionar incidencias." };
  }

  const incidenciaId = formData.get("incidenciaId") as string;
  const estado = formData.get("estado") as EstadoIncidencia | null;
  const notasResolucion = formData.get("notasResolucion") as string | null;

  if (!incidenciaId) return { error: "Falta el ID de la incidencia." };

  // Validar que si se cambia a 'resuelta', las notas sean obligatorias
  if (estado === "resuelta" && !notasResolucion?.trim()) {
    return { error: "Las notas de resolución son obligatorias para marcar como resuelta." };
  }

  try {
    const cliente = crearClienteServiceRole();
    await actualizarIncidencia(
      cliente,
      {
        incidenciaId,
        tenantId: sesion.usuario.tenantId,
        estado: estado ?? undefined,
        notasResolucion: notasResolucion ?? undefined,
        resueltaPorUsuarioId: sesion.usuarioId,
      },
      sesion.usuario,
    );
    revalidatePath("/operaciones/incidencias");
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al actualizar." };
  }
}
