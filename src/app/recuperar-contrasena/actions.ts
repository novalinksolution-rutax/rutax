"use server";

/**
 * Server Action — "¿Olvidaste tu contraseña?" (paso 1 de 2).
 *
 * Dispara el correo nativo de Supabase Auth (`resetPasswordForEmail`), cuyo
 * enlace entra por `/auth/confirm?type=recovery&next=/restablecer-contrasena`
 * — el mismo puente que ya usa la activación del dueño. El paso 2 (fijar la
 * contraseña nueva) vive en `/restablecer-contrasena`.
 *
 * DOS DECISIONES DE SEGURIDAD, ambas deliberadas:
 *
 * 1. NO se revela si el correo existe. La respuesta es idéntica para una
 *    cuenta real y para una inventada. Sin esto, este formulario sería un
 *    oráculo de enumeración: cualquiera podría descubrir qué correos tienen
 *    cuenta en Rutax probándolos de a uno. Por eso tampoco se consulta la
 *    tabla de usuarios antes de enviar — no hay nada que consultar.
 *
 * 2. Límite de tasa por correo ANTES de llamar a Auth. El SMTP integrado de
 *    Supabase ya limita globalmente, pero ese límite es del proyecto: sin uno
 *    propio por destinatario, pedir mil recuperaciones del mismo correo lo
 *    inunda y de paso consume la cuota que necesitan los demás couriers.
 *    Fail-open igual que en los webhooks (ver `src/lib/rate-limit`): si el
 *    limitador falla, preferimos enviar el correo a bloquear a alguien que sí
 *    perdió su clave.
 */

import { createClient } from "@/lib/supabase/server";
import { consumirRateLimit } from "@/lib/rate-limit";

/** 3 solicitudes por hora y por correo — suficiente para un error de tipeo, no para abusar. */
const LIMITE_POR_CORREO = 3;
const VENTANA_SEGUNDOS = 3600;

export type SolicitarRecuperacionResultado =
  | { ok: true }
  | { ok: false; tipo: "validacion" | "limite"; mensaje: string };

export async function solicitarRecuperacionContrasena(
  emailCrudo: string,
): Promise<SolicitarRecuperacionResultado> {
  const email = emailCrudo.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return { ok: false, tipo: "validacion", mensaje: "Escribe un correo electrónico válido." };
  }

  const limite = await consumirRateLimit(`recuperacion:${email}`, LIMITE_POR_CORREO, VENTANA_SEGUNDOS);
  if (!limite.permitido) {
    const minutos = Math.max(1, Math.ceil(limite.reintentarEnSegundos / 60));
    return {
      ok: false,
      tipo: "limite",
      mensaje: `Ya pediste varios enlaces para este correo. Espera ${minutos} minuto${minutos === 1 ? "" : "s"} e intenta de nuevo.`,
    };
  }

  const supabase = await createClient();

  // `redirectTo` es el destino DESPUÉS de que `/auth/confirm` valide el token.
  // La plantilla de correo apunta a `/auth/confirm`; esto cubre el caso de que
  // alguien la deje en el `{{ .ConfirmationURL }}` por defecto.
  const base = process.env.APP_PUBLIC_URL?.trim();
  await supabase.auth.resetPasswordForEmail(
    email,
    base ? { redirectTo: `${base}/auth/confirm?next=/restablecer-contrasena` } : undefined,
  );

  // Éxito SIEMPRE, incluso si Auth devolvió error (correo inexistente,
  // proveedor caído). Ver decisión 1 arriba: la respuesta no puede depender de
  // si la cuenta existe. Los fallos reales quedan en los logs de Supabase Auth.
  return { ok: true };
}
