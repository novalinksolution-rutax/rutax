"use server";

/**
 * Server Actions para liquidaciones de conductores — Pantalla D-3.
 *
 * Criterio C-3: signed URLs de 15 min para descargar PDFs de liquidaciones.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { marcarLiquidacionPagada } from "@/modules/dinero/acciones";

// =============================================================================
// Marcar liquidación como pagada
// =============================================================================

export async function accionMarcarLiquidacionPagada(
  liquidacionId: string,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }

  try {
    await marcarLiquidacionPagada(
      sesion.usuario.tenantId,
      liquidacionId,
      sesion.usuario,
    );
    return { ok: true };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error desconocido al marcar la liquidación como pagada.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Descargar PDF de liquidación — signed URL de 15 min (criterio C-3)
// =============================================================================

export async function accionDescargarPdfLiquidacion(pdfRef: string): Promise<void> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase.storage
    .from("liquidaciones")
    .createSignedUrl(pdfRef, 900);

  if (error || !data) {
    throw new Error("No se pudo generar el enlace de descarga de la liquidación.");
  }

  redirect(data.signedUrl);
}
