"use server";

/**
 * Server Actions del detalle de período (D-2).
 * Duplica las acciones de descarga de la sección periodos para satisfacer
 * la restricción de Next.js: los archivos "use server" no pueden re-exportar.
 *
 * Criterio C-3: signed URLs de 15 min (900 segundos) para PDF y XML DTE.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  cerrarPeriodoManualmente,
  emitirFacturaPeriodo,
  emitirNotaCreditoPeriodo,
} from "@/modules/dinero/acciones";

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

/**
 * Emitir factura (DTE) del período cerrado — compuerta de aprobación (B1-1).
 * Única vía de emisión; el cierre no factura. Requiere `emitir_facturas`.
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

/**
 * Emitir NOTA DE CRÉDITO (DTE 61) que anula TOTALMENTE la factura del período
 * (RF-038, decisión B7). Compuerta humana con motivo obligatorio; requiere
 * capacidad `emitir_facturas` (validada en la acción de dominio).
 */
export async function accionEmitirNotaCredito(
  periodoId: string,
  motivo: string,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }
  try {
    await emitirNotaCreditoPeriodo(
      sesion.usuario.tenantId,
      periodoId,
      motivo,
      sesion.usuario,
      sesion.usuarioId,
    );
    // Refresca el detalle y la lista (el período pasará a "anulado" cuando
    // termine el job; la solicitud ya quedó registrada).
    revalidatePath(`/dinero/periodos/${periodoId}`);
    revalidatePath("/dinero/periodos");
    return { ok: true };
  } catch (err) {
    const mensaje =
      err instanceof Error
        ? err.message
        : "Error desconocido al emitir la nota de crédito.";
    return { ok: false, mensaje };
  }
}

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
