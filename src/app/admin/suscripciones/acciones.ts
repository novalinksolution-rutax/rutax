"use server";

/**
 * Server Actions del backstage de suscripciones.
 *
 * El secreto de plataforma se obtiene de la SESIÓN admin (cookie httpOnly,
 * validada en tiempo constante), NUNCA del `formData` enviado por el cliente —
 * el navegador ya no conoce el secreto. `exigirSecretoAdmin` lanza si no hay
 * sesión válida; el secreto crudo se lee server-side desde env solo para
 * pasarlo a las funciones de `plataforma` que aún lo exigen.
 */

import {
  asignarPlan,
  activarSuscripcion,
  suspenderSuscripcion,
  cancelarSuscripcion,
  registrarPagoManual,
} from "@/modules/plataforma/acciones";
import type { EstadoSuscripcion } from "@/modules/plataforma/tipos";
import { exigirSecretoAdmin } from "../sesion-admin";

export async function accionAsignarPlan(formData: FormData) {
  try {
    const adminSecret = await exigirSecretoAdmin();
    return await asignarPlan({
      adminSecret,
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
    const adminSecret = await exigirSecretoAdmin();
    return await activarSuscripcion({
      adminSecret,
      suscripcionId: formData.get("suscripcion_id") as string,
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al activar suscripción." };
  }
}

export async function accionSuspenderSuscripcion(formData: FormData) {
  try {
    const adminSecret = await exigirSecretoAdmin();
    return await suspenderSuscripcion({
      adminSecret,
      suscripcionId: formData.get("suscripcion_id") as string,
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al suspender suscripción." };
  }
}

export async function accionCancelarSuscripcion(formData: FormData) {
  try {
    const adminSecret = await exigirSecretoAdmin();
    return await cancelarSuscripcion({
      adminSecret,
      suscripcionId: formData.get("suscripcion_id") as string,
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al cancelar suscripción." };
  }
}

export async function accionRegistrarPagoManual(formData: FormData) {
  try {
    const adminSecret = await exigirSecretoAdmin();
    return await registrarPagoManual({
      adminSecret,
      periodoId: formData.get("periodo_id") as string,
      metodo: (formData.get("metodo") as "transferencia_manual" | "cortesia") || "transferencia_manual",
      notas: (formData.get("notas") as string) || undefined,
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al registrar pago." };
  }
}
