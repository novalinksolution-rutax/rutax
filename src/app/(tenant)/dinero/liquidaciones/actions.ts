"use server";

/**
 * Server Actions para liquidaciones de conductores — Pantalla D-3.
 *
 * Criterio C-3: signed URLs de 15 min para descargar PDFs de liquidaciones.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { marcarLiquidacionPagada, emitirPagoLiquidacion, ajustarLiquidacion } from "@/modules/dinero/acciones";

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
      sesion.usuarioId,
    );
    return { ok: true };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error desconocido al marcar la liquidación como pagada.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Emitir pago electrónico de liquidación — compuerta F19
// =============================================================================

export async function accionEmitirPagoLiquidacion(
  liquidacionId: string,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }

  try {
    await emitirPagoLiquidacion(
      sesion.usuario.tenantId,
      liquidacionId,
      sesion.usuario,
      sesion.usuarioId,
    );
    return { ok: true };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error al emitir el pago.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Ajustar liquidación — bono / penalización manual (F16)
// =============================================================================

export async function accionAjustarLiquidacion(
  liquidacionId: string,
  bonoClp: number,
  penalizacionClp: number,
  notaAjuste: string | null,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }

  try {
    await ajustarLiquidacion(
      sesion.usuario.tenantId,
      liquidacionId,
      bonoClp,
      penalizacionClp,
      notaAjuste,
      sesion.usuario,
      sesion.usuarioId,
    );
    return { ok: true };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error desconocido al ajustar la liquidación.";
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
