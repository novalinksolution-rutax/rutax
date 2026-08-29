"use server";

/**
 * Server Actions del CRUD de planes (backstage de plataforma, F2 "Ola 1",
 * ítem D). Mismo patrón que `admin/suscripciones/acciones.ts`: el secreto y el
 * actor SIEMPRE se resuelven de la sesión admin (`exigirActorAdmin`), nunca
 * del `formData` que envía el navegador.
 *
 * `caracteristicas` es un reemplazo COMPLETO del jsonb (no un merge — ver
 * `actualizarPlan` en `modules/plataforma/acciones.ts`): por eso el formulario
 * de edición viaja con un campo oculto `caracteristicas_previas` (el jsonb tal
 * como está hoy en el plan) para poder preservar cualquier llave que esta UI
 * no edita explícitamente (hoy solo administra `conductores_max`,
 * `api_publica` y `webhooks`).
 */

import {
  crearPlan,
  actualizarPlan,
  activarDesactivarPlan,
} from "@/modules/plataforma/acciones";
import { exigirActorAdmin } from "../sesion-admin";

/** `null` si el campo viene vacío/no numérico — usado para "ilimitado". */
function parseNumeroOpcional(valor: FormDataEntryValue | null): number | null {
  if (valor === null) return null;
  const texto = String(valor).trim();
  if (!texto) return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

function parseNumeroObligatorio(valor: FormDataEntryValue | null): number {
  return parseNumeroOpcional(valor) ?? 0;
}

/**
 * Reconstruye el jsonb `caracteristicas` completo: parte de las llaves
 * PREVIAS (para no perder features fijadas por fuera de este formulario) y
 * pisa las 3 que esta pantalla administra. `conductores_max` vacío = borra la
 * llave (plan sin tope de conductores).
 */
function construirCaracteristicas(
  formData: FormData,
  previas: Record<string, unknown> = {},
): Record<string, unknown> {
  const conductoresMax = parseNumeroOpcional(formData.get("conductores_max"));
  const resultado: Record<string, unknown> = { ...previas };

  if (conductoresMax === null) {
    delete resultado.conductores_max;
  } else {
    resultado.conductores_max = conductoresMax;
  }
  resultado.api_publica = formData.get("api_publica") === "on";
  resultado.webhooks = formData.get("webhooks") === "on";

  return resultado;
}

function parseCaracteristicasPrevias(formData: FormData): Record<string, unknown> {
  const crudo = formData.get("caracteristicas_previas");
  if (typeof crudo !== "string" || !crudo) return {};
  try {
    const parsed = JSON.parse(crudo);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function accionCrearPlan(formData: FormData) {
  try {
    const { adminSecret, actorUsuarioId } = await exigirActorAdmin();
    return await crearPlan({
      adminSecret,
      actorUsuarioId,
      nombre: String(formData.get("nombre") ?? ""),
      descripcion: (formData.get("descripcion") as string) || null,
      precioPorPedidoClp: parseNumeroObligatorio(formData.get("precio_por_pedido_clp")),
      minimoMensualClp: parseNumeroOpcional(formData.get("minimo_mensual_clp")),
      caracteristicas: construirCaracteristicas(formData),
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al crear el plan." };
  }
}

export async function accionActualizarPlan(formData: FormData) {
  try {
    const { adminSecret, actorUsuarioId } = await exigirActorAdmin();
    const previas = parseCaracteristicasPrevias(formData);
    return await actualizarPlan({
      adminSecret,
      actorUsuarioId,
      planId: String(formData.get("plan_id") ?? ""),
      nombre: String(formData.get("nombre") ?? ""),
      descripcion: (formData.get("descripcion") as string) || null,
      precioPorPedidoClp: parseNumeroObligatorio(formData.get("precio_por_pedido_clp")),
      minimoMensualClp: parseNumeroOpcional(formData.get("minimo_mensual_clp")),
      caracteristicas: construirCaracteristicas(formData, previas),
    });
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al actualizar el plan." };
  }
}

export async function accionActivarDesactivarPlan(formData: FormData) {
  try {
    const { adminSecret, actorUsuarioId } = await exigirActorAdmin();
    return await activarDesactivarPlan({
      adminSecret,
      actorUsuarioId,
      planId: String(formData.get("plan_id") ?? ""),
      activo: formData.get("activo") === "true",
    });
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al cambiar el estado del plan.",
    };
  }
}
