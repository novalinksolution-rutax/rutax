"use server";

/**
 * Server Actions del portal del seller — cobros.
 *
 * Criterio C-3: signed URL de 15 min para descargar el PDF DTE.
 * El seller solo tiene acceso al PDF (no al XML).
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";

export async function accionDescargarFacturaPdf(pdfRef: string): Promise<void> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller") redirect("/portal");

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase.storage
    .from("documentos-dte")
    .createSignedUrl(pdfRef, 900);

  if (error || !data) {
    throw new Error("No se pudo generar el enlace de descarga de la factura.");
  }

  redirect(data.signedUrl);
}
