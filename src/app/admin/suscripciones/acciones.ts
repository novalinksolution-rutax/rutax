"use server";

/**
 * Server Actions del backstage de suscripciones.
 *
 * El secreto de plataforma y el actor se obtienen de la SESIÓN admin (cookies
 * httpOnly, validadas en tiempo constante), NUNCA del `formData` enviado por
 * el cliente — el navegador ya no conoce el secreto. `exigirActorAdmin` lanza
 * si no hay sesión válida CON actor declarado (gap 3, F2-mínimo — ver
 * `sesion-admin.ts`); el secreto crudo se lee server-side desde env solo para
 * pasarlo a las funciones de `plataforma` que aún lo exigen, y el
 * `actorUsuarioId` real (uuid de `auth.users`) viaja a la bitácora.
 */

import {
  asignarPlan,
  activarSuscripcion,
  suspenderSuscripcion,
  cancelarSuscripcion,
  registrarPagoManual,
  generarLinkCobroPeriodo,
  establecerCaracteristicasOverride,
  establecerEmisionDteReal,
} from "@/modules/plataforma/acciones";
import type { EstadoSuscripcion } from "@/modules/plataforma/tipos";
import { exigirActorAdmin } from "../sesion-admin";

export async function accionAsignarPlan(formData: FormData) {
  try {
    const { adminSecret, actorUsuarioId } = await exigirActorAdmin();
    return await asignarPlan({
      adminSecret,
      actorUsuarioId,
      tenantId: formData.get("tenant_id") as string,
      planId: formData.get("plan_id") as string,
      estado: ((formData.get("estado") as string) || "trial") as EstadoSuscripcion,
      trialHasta: (formData.get("trial_hasta") as string) || undefined,
      notas: (formData.get("notas") as string) || undefined,
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al asignar plan." };
  }
}

export async function accionActivarSuscripcion(formData: FormData) {
  try {
    const { adminSecret, actorUsuarioId } = await exigirActorAdmin();
    return await activarSuscripcion({
      adminSecret,
      actorUsuarioId,
      suscripcionId: formData.get("suscripcion_id") as string,
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al activar suscripción." };
  }
}

export async function accionSuspenderSuscripcion(formData: FormData) {
  try {
    const { adminSecret, actorUsuarioId } = await exigirActorAdmin();
    return await suspenderSuscripcion({
      adminSecret,
      actorUsuarioId,
      suscripcionId: formData.get("suscripcion_id") as string,
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al suspender suscripción." };
  }
}

export async function accionCancelarSuscripcion(formData: FormData) {
  try {
    const { adminSecret, actorUsuarioId } = await exigirActorAdmin();
    return await cancelarSuscripcion({
      adminSecret,
      actorUsuarioId,
      suscripcionId: formData.get("suscripcion_id") as string,
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al cancelar suscripción." };
  }
}

export async function accionRegistrarPagoManual(formData: FormData) {
  try {
    const { adminSecret, actorUsuarioId } = await exigirActorAdmin();
    return await registrarPagoManual({
      adminSecret,
      actorUsuarioId,
      periodoId: formData.get("periodo_id") as string,
      metodo: (formData.get("metodo") as "transferencia_manual" | "cortesia") || "transferencia_manual",
      notas: (formData.get("notas") as string) || undefined,
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al registrar pago." };
  }
}

export async function accionGenerarLinkCobro(formData: FormData) {
  try {
    const { adminSecret, actorUsuarioId } = await exigirActorAdmin();
    return await generarLinkCobroPeriodo({
      adminSecret,
      actorUsuarioId,
      periodoId: formData.get("periodo_id") as string,
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al generar el link de cobro." };
  }
}

// =============================================================================
// Entitlements / overrides por courier + opt-in de emisión DTE real
// (F2 "Ola 1", ítems 6 y 8)
// =============================================================================

/**
 * Reconstruye el payload de override a partir del formulario. Semántica
 * WYSIWYG: el formulario representa el estado DESEADO completo de las 3
 * llaves que esta pantalla administra, así que siempre se envían las 3 —
 * `establecerCaracteristicasOverride` interpreta un valor `null` explícito
 * como "borra la llave" (vuelve a heredar del plan), y cualquier otro valor
 * como "fija el override" (ver `modules/plataforma/acciones.ts`).
 *
 * - `conductores_max`: vacío ⇒ `null` (usa el plan); número ⇒ override.
 * - `api_publica` / `webhooks`: select tri-estado con valores `""` (usa el
 *   plan) | `"true"` | `"false"`.
 */
function construirOverridePayload(formData: FormData): Record<string, unknown> {
  const conductoresRaw = String(formData.get("conductores_max") ?? "").trim();
  const conductoresMax = conductoresRaw === "" ? null : Number(conductoresRaw);

  const apiPublicaRaw = String(formData.get("api_publica") ?? "");
  const apiPublica = apiPublicaRaw === "" ? null : apiPublicaRaw === "true";

  const webhooksRaw = String(formData.get("webhooks") ?? "");
  const webhooks = webhooksRaw === "" ? null : webhooksRaw === "true";

  return {
    conductores_max: conductoresMax,
    api_publica: apiPublica,
    webhooks: webhooks,
  };
}

export async function accionEstablecerOverride(formData: FormData) {
  try {
    const { adminSecret, actorUsuarioId } = await exigirActorAdmin();
    return await establecerCaracteristicasOverride({
      adminSecret,
      actorUsuarioId,
      tenantId: String(formData.get("tenant_id") ?? ""),
      override: construirOverridePayload(formData),
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al actualizar el override." };
  }
}

/**
 * Opt-in/opt-out de emisión DTE real (ítem 8). SOLO habilita la CAPACIDAD del
 * courier — nunca emite nada. Ver la advertencia en el componente de UI y en
 * `establecerEmisionDteReal` (invariante no-negociable de CLAUDE.md).
 */
export async function accionEstablecerEmisionDteReal(formData: FormData) {
  try {
    const { adminSecret, actorUsuarioId } = await exigirActorAdmin();
    return await establecerEmisionDteReal({
      adminSecret,
      actorUsuarioId,
      tenantId: String(formData.get("tenant_id") ?? ""),
      habilitada: formData.get("habilitada") === "true",
    });
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al actualizar el opt-in de DTE real.",
    };
  }
}
