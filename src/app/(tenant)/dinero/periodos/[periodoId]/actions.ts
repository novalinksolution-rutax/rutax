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
  registrarPreflightOmitido,
} from "@/modules/dinero/acciones";
import {
  preflightEmitirFactura,
  preflightEmitirNotaCredito,
  type ResultadoPreflight,
  type TipoAccionDinero,
} from "@/modules/dinero/preflight";

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

// =============================================================================
// Preflight — hallazgo P0 de la auditoría (jul 2026)
// =============================================================================
// PREPARA/VERIFICA el estado antes de emitir factura o nota de crédito. 100%
// de lectura — la única escritura de esta sección es la bitácora del override
// "continuar bajo mi responsabilidad" (`accionRegistrarPreflightOmitido`),
// para el escenario degradado en que el preflight mismo falla al ejecutarse.

export type RespuestaPreflight =
  | { ok: true; preflight: ResultadoPreflight }
  | { ok: false; mensaje: string };

/** PREFLIGHT de `accionEmitirFactura` — mismo gate RBAC, sin escribir nada. */
export async function accionPreflightEmitirFactura(periodoId: string): Promise<RespuestaPreflight> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }
  try {
    const preflight = await preflightEmitirFactura(sesion.usuario.tenantId, periodoId, sesion.usuario);
    return { ok: true, preflight };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error desconocido al verificar la emisión de la factura.";
    return { ok: false, mensaje };
  }
}

/** PREFLIGHT de `accionEmitirNotaCredito` — mismo gate RBAC, sin escribir nada. */
export async function accionPreflightEmitirNotaCredito(periodoId: string): Promise<RespuestaPreflight> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }
  try {
    const preflight = await preflightEmitirNotaCredito(sesion.usuario.tenantId, periodoId, sesion.usuario);
    return { ok: true, preflight };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error desconocido al verificar la nota de crédito.";
    return { ok: false, mensaje };
  }
}

/**
 * Registra en bitácora que el usuario decidió CONTINUAR sin un preflight
 * válido (el preflight mismo falló — error de red/lectura, escenario
 * degradado). Se llama ANTES de permitir el click en "Confirmar" en ese caso;
 * NUNCA reemplaza al preflight normal ni se usa cuando el preflight sí corrió
 * y solo mostró advertencias (eso no requiere override, solo confirmar).
 */
export async function accionRegistrarPreflightOmitido(
  tipoAccion: TipoAccionDinero,
  entidadId: string,
): Promise<void> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    throw new Error("No autenticado.");
  }
  await registrarPreflightOmitido(
    sesion.usuario.tenantId,
    tipoAccion,
    entidadId,
    sesion.usuario,
    sesion.usuarioId,
  );
}
