"use server";

/**
 * Alta de un courier nuevo desde el backstage — en un solo acto.
 * =============================================================================
 *
 * Compone dos operaciones que hasta ahora vivían separadas y que, hechas de a
 * una, dejaban couriers a medias (fue el hueco que motivó esta pantalla):
 *
 *   1. `crearTenantConDueno` (identidad) — crea el tenant, invita al dueño por
 *      correo y enciende las cinco áreas de producto. Es «la ÚNICA puerta para
 *      crear un tenant», y desde el 2026-08-30 también la única que lo deja
 *      utilizable.
 *   2. `asignarPlan` (plataforma) — le pone el plan con el que Rutax le va a
 *      cobrar. Sin esto el courier queda sin suscripción y NUNCA se le factura
 *      (fue justo lo que pasó con Novalink).
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL FALLO DEL PLAN NO DESHACE EL COURIER
 * -----------------------------------------------------------------------------
 * Si el paso 1 falla, no hay nada que mostrar: su propia compensación deja la
 * base limpia y devolvemos el error. Pero si el courier YA se creó y falla
 * recién la asignación del plan, **no se deshace el courier**: ya salió el
 * correo de invitación al dueño, y el courier operable-sin-plan es un estado
 * recuperable en treinta segundos desde Suscripciones. Borrarlo obligaría a
 * reinvitar y a que el dueño ignore un primer correo muerto. Se informa el
 * estado parcial en vez de esconderlo.
 *
 * -----------------------------------------------------------------------------
 * ACTOR Y AUDITORÍA
 * -----------------------------------------------------------------------------
 * El actor es el super-admin real (`exigirActorAdmin` → uuid de `auth.users`),
 * no el `formData`. Las dos operaciones dejan su propia entrada de bitácora con
 * ese autor: `tenant.alta` y `plataforma.plan_asignado`.
 */

import { revalidatePath } from "next/cache";

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { crearTenantConDueno } from "@/modules/identidad/onboarding";
import { asignarPlan } from "@/modules/plataforma/acciones";
import type { EstadoSuscripcion } from "@/modules/plataforma/tipos";
import { exigirActorAdmin } from "../sesion-admin";

export interface ResultadoAltaCourier {
  ok: boolean;
  /** Presente cuando el courier se creó, aunque el plan haya fallado. */
  tenantId?: string;
  /** `true` solo si además quedó con plan asignado. */
  planAsignado?: boolean;
  /** Aviso cuando el courier se creó pero el plan NO — estado recuperable. */
  aviso?: string;
  /** Mensaje de error cuando no se pudo crear el courier. */
  mensaje?: string;
}

export async function accionCrearCourier(formData: FormData): Promise<ResultadoAltaCourier> {
  let actorUsuarioId: string;
  let adminSecret: string;
  try {
    ({ actorUsuarioId, adminSecret } = await exigirActorAdmin());
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Sesión no autorizada." };
  }

  const nombreFantasia = ((formData.get("nombre_fantasia") as string) ?? "").trim();
  const razonSocial = ((formData.get("razon_social") as string) ?? "").trim();
  const rut = ((formData.get("rut") as string) ?? "").trim();
  const nombreDueno = ((formData.get("nombre_dueno") as string) ?? "").trim();
  const emailDueno = ((formData.get("email_dueno") as string) ?? "").trim();
  // `plan_id` vacío = «sin plan por ahora»: el alta no se bloquea si todavía no
  // hay un plan en el catálogo. El courier queda visible en Suscripciones para
  // asignárselo después.
  const planId = ((formData.get("plan_id") as string) ?? "").trim();
  const estado = (((formData.get("estado") as string) || "trial") as EstadoSuscripcion);
  const trialHasta = ((formData.get("trial_hasta") as string) || "").trim() || undefined;

  // --- 1. Courier + dueño + áreas --------------------------------------------
  let tenantId: string;
  try {
    const cliente = crearClienteServiceRole();
    const resultado = await crearTenantConDueno(cliente, {
      tenant: { nombreFantasia, razonSocial, rut },
      dueno: { email: emailDueno, nombreCompleto: nombreDueno },
      actor: { usuarioId: actorUsuarioId, tipo: "super_admin" },
    });
    tenantId = resultado.tenantId;
  } catch (err) {
    // `crearTenantConDueno` ya compensó lo que hubiera creado; solo traducimos
    // el error (RUT/correo duplicado, RUT inválido, etc.) a un mensaje.
    return { ok: false, mensaje: err instanceof Error ? err.message : "No se pudo crear el courier." };
  }

  // --- 2. Plan ----------------------------------------------------------------
  if (!planId) {
    revalidatePath("/admin/couriers");
    return {
      ok: true,
      tenantId,
      planAsignado: false,
      aviso: "El courier quedó creado, pero sin plan. Asígnale uno desde Suscripciones para poder cobrarle.",
    };
  }

  try {
    await asignarPlan({
      adminSecret,
      actorUsuarioId,
      tenantId,
      planId,
      estado,
      trialHasta,
    });
  } catch (err) {
    // Estado parcial recuperable — ver cabecera. El courier existe y opera.
    revalidatePath("/admin/couriers");
    return {
      ok: true,
      tenantId,
      planAsignado: false,
      aviso: `El courier se creó y se invitó al dueño, pero no se pudo asignar el plan (${
        err instanceof Error ? err.message : "error desconocido"
      }). Asígnalo desde Suscripciones.`,
    };
  }

  revalidatePath("/admin/couriers");
  return { ok: true, tenantId, planAsignado: true };
}
