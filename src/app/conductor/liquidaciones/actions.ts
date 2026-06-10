"use server";

/**
 * Server Actions para la PWA del conductor — liquidaciones.
 *
 * Criterio C-3: signed URL de 15 min para el PDF de liquidación.
 * Criterio C-2: el conductor no accede a datos de cobros ni de sellers.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";

export async function accionDescargarPdfLiquidacionConductor(pdfRef: string): Promise<void> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "conductor") redirect("/conductor/manifiesto");

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase.storage
    .from("liquidaciones")
    .createSignedUrl(pdfRef, 900);

  if (error || !data) {
    throw new Error("No se pudo generar el enlace de descarga de la liquidación.");
  }

  redirect(data.signedUrl);
}
