"use server";

/**
 * Server Actions para períodos de cobro — Pantalla D-1 y D-2.
 *
 * Criterio C-3: los botones de PDF/XML nunca exponen referencias de Storage al cliente.
 * Siempre se genera una signed URL de 15 minutos y se redirige.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { cerrarPeriodoManualmente, emitirFacturaPeriodo } from "@/modules/dinero/acciones";

// =============================================================================
// Cerrar período manualmente
// =============================================================================

export async function accionCerrarPeriodo(
  periodoId: string,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }

  try {
    await cerrarPeriodoManualmente(
      sesion.usuario.tenantId,
      periodoId,
      sesion.usuario,
      sesion.usuarioId,
    );
    return { ok: true };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error desconocido al cerrar el período.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Emitir factura (DTE) — compuerta de aprobación humana (B1-1)
// =============================================================================

/**
 * Solicita la emisión del DTE de un período YA cerrado. Es la única vía por la
 * que se emite una factura: el cierre del período (manual o por cron) NO
 * factura. Requiere capacidad `emitir_facturas` (validada en la acción).
 */
export async function accionEmitirFactura(
  periodoId: string,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }

  try {
    await emitirFacturaPeriodo(
      sesion.usuario.tenantId,
      periodoId,
      sesion.usuario,
      sesion.usuarioId,
    );
    return { ok: true };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error desconocido al emitir la factura.";
    return { ok: false, mensaje };
  }
}

// =============================================================================
// Descargar PDF del DTE — signed URL de 15 min (criterio C-3)
// =============================================================================

export async function accionDescargarPdfDte(pdfRef: string): Promise<void> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase.storage
    .from("documentos-dte")
    .createSignedUrl(pdfRef, 900);

  if (error || !data) {
    throw new Error("No se pudo generar el enlace de descarga del PDF.");
  }

  redirect(data.signedUrl);
}

// =============================================================================
// Descargar XML del DTE — signed URL de 15 min (criterio C-3)
// =============================================================================

export async function accionDescargarXmlDte(xmlRef: string): Promise<void> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase.storage
    .from("documentos-dte")
    .createSignedUrl(xmlRef, 900);

  if (error || !data) {
    throw new Error("No se pudo generar el enlace de descarga del XML.");
  }

  redirect(data.signedUrl);
}
