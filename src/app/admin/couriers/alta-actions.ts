"use server";

/**
 * Alta de un courier nuevo desde el backstage — solo el correo del dueño.
 * =============================================================================
 *
 * Decisión del usuario (2026-08-30): Rutax NO teclea los datos de la empresa.
 * El backstage solo invita al dueño por correo; el dueño, al aceptar, define su
 * contraseña y en su puesta en marcha completa razón social, RUT, giro,
 * dirección, sellers, conductores y tarifas.
 *
 * Qué crea, entonces, este alta:
 *   · el tenant, con un nombre PROVISIONAL (derivado del correo o el que el
 *     admin quiera dar) y `razon_social`/`rut` en NULL — el dueño los pone luego;
 *   · el usuario del dueño, invitado por correo (`crearTenantConDueno`);
 *   · sus cinco áreas de producto encendidas.
 *
 * -----------------------------------------------------------------------------
 * NO ASIGNA PLAN, Y NO ES UN OLVIDO
 * -----------------------------------------------------------------------------
 * El plan se asigna aparte, desde Suscripciones, cuando el courier ya tiene sus
 * datos. Meterlo acá obligaría a elegir plan en un alta que se quiso reducir a
 * un solo campo. El courier recién invitado aparece en Suscripciones (como
 * tenant sin suscripción) y en el panel de Couriers marcado «sin suscripción».
 *
 * -----------------------------------------------------------------------------
 * ACTOR Y AUDITORÍA
 * -----------------------------------------------------------------------------
 * El actor es el super-admin real (`exigirActorAdmin`), no el `formData`. El
 * `tenant.alta` queda en bitácora con ese autor (lo escribe `crearTenantConDueno`).
 */

import { revalidatePath } from "next/cache";

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { crearTenantConDueno } from "@/modules/identidad/onboarding";
import { exigirActorAdmin } from "../sesion-admin";

export interface ResultadoAltaCourier {
  ok: boolean;
  tenantId?: string;
  /** Correo al que se envió la invitación — para el acuse en pantalla. */
  emailInvitado?: string;
  mensaje?: string;
}

/**
 * Nombre provisional del courier a partir del correo, cuando el admin no da
 * uno. «Courier de juan@flex.cl» es más útil en el panel que «Nuevo courier»:
 * el admin reconoce a quién invitó. El dueño lo reemplaza en su puesta en marcha.
 */
function nombreProvisionalDesdeEmail(email: string): string {
  return `Courier de ${email.trim().toLowerCase()}`;
}

export async function accionCrearCourier(formData: FormData): Promise<ResultadoAltaCourier> {
  let actorUsuarioId: string;
  try {
    ({ actorUsuarioId } = await exigirActorAdmin());
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Sesión no autorizada." };
  }

  const emailDueno = ((formData.get("email_dueno") as string) ?? "").trim().toLowerCase();
  const nombreDueno = ((formData.get("nombre_dueno") as string) ?? "").trim();
  // Nombre de referencia OPCIONAL: si el admin no lo da, se deriva del correo.
  const nombreReferencia = ((formData.get("nombre_referencia") as string) ?? "").trim();

  if (!emailDueno || !emailDueno.includes("@")) {
    return { ok: false, mensaje: "El correo del dueño es obligatorio y debe ser válido." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const { tenantId } = await crearTenantConDueno(cliente, {
      tenant: {
        nombreFantasia: nombreReferencia || nombreProvisionalDesdeEmail(emailDueno),
        // razón social y RUT quedan en NULL: los pone el dueño en su puesta en
        // marcha (ver migración 20260830000001).
      },
      dueno: {
        email: emailDueno,
        // Si el admin no da el nombre, se usa el correo como marcador; el dueño
        // lo corrige al activar (la pantalla de activación ya pide su nombre).
        nombreCompleto: nombreDueno || emailDueno,
      },
      actor: { usuarioId: actorUsuarioId, tipo: "super_admin" },
    });

    revalidatePath("/admin/couriers");
    return { ok: true, tenantId, emailInvitado: emailDueno };
  } catch (err) {
    // `crearTenantConDueno` ya compensó lo que hubiera creado; traducimos el
    // error (correo duplicado, etc.) a un mensaje.
    return { ok: false, mensaje: err instanceof Error ? err.message : "No se pudo crear el courier." };
  }
}
