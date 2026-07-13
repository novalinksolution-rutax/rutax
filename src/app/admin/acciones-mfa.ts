"use server";

/**
 * Server Actions de MFA (TOTP) del backstage de plataforma — F3-A.
 *
 * Tres operaciones, las tres exigen sesión real de super-admin
 * (`exigirSuperAdmin()` — AAL1 basta: un usuario que aún no tiene MFA
 * verificado en esta sesión igual debe poder ENROLAR o hacer STEP-UP; exigir
 * aal2 aquí crearía un candado sin llave):
 *
 * - `iniciarEnrolamientoTotp()`: `auth.mfa.enroll({ factorType: 'totp' })` —
 *   devuelve el QR (SVG) + secret + uri para que el usuario lo agregue a su
 *   app authenticator. El factor queda `unverified` hasta el siguiente paso.
 * - `verificarEnrolamientoTotp(factorId, code)`: `auth.mfa.challengeAndVerify`
 *   — confirma el código TOTP y deja el factor `verified`. Tras esto la
 *   sesión sube a AAL2 automáticamente (mismo paso sirve de "primer step-up").
 * - `desafiarTotp(factorId, code)`: STEP-UP de una sesión que ya tiene un
 *   factor `verified` mucho antes (login nuevo en AAL1) — mismo
 *   `challengeAndVerify`, expuesto aparte por claridad de nombre/UI, no por
 *   diferencia de lógica.
 *
 * NUNCA se loguea el secret TOTP ni el código ingresado por el usuario.
 */

import { createClient } from "@/lib/supabase/server";
import { exigirSuperAdmin } from "@/modules/plataforma/autorizacion-admin";

export type ResultadoEnrolamientoTotp =
  | { ok: true; factorId: string; qrCodeSvg: string; secret: string; uri: string }
  | { ok: false; mensaje: string };

export type ResultadoVerificacionTotp = { ok: true } | { ok: false; mensaje: string };

export async function iniciarEnrolamientoTotp(): Promise<ResultadoEnrolamientoTotp> {
  try {
    await exigirSuperAdmin();
  } catch {
    return { ok: false, mensaje: "No autorizado." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });

  if (error || !data) {
    return { ok: false, mensaje: "No se pudo iniciar el enrolamiento de MFA. Intenta de nuevo." };
  }

  return {
    ok: true,
    factorId: data.id,
    qrCodeSvg: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

export async function verificarEnrolamientoTotp(
  factorId: string,
  code: string,
): Promise<ResultadoVerificacionTotp> {
  try {
    await exigirSuperAdmin();
  } catch {
    return { ok: false, mensaje: "No autorizado." };
  }

  const codigo = code?.trim() ?? "";
  if (!factorId || !codigo) {
    return { ok: false, mensaje: "Ingresa el código de tu app authenticator." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo });

  if (error) {
    return { ok: false, mensaje: "Código incorrecto o expirado. Intenta de nuevo." };
  }

  return { ok: true };
}

export async function desafiarTotp(factorId: string, code: string): Promise<ResultadoVerificacionTotp> {
  try {
    await exigirSuperAdmin();
  } catch {
    return { ok: false, mensaje: "No autorizado." };
  }

  const codigo = code?.trim() ?? "";
  if (!factorId || !codigo) {
    return { ok: false, mensaje: "Ingresa el código de tu app authenticator." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo });

  if (error) {
    return { ok: false, mensaje: "Código incorrecto o expirado. Intenta de nuevo." };
  }

  return { ok: true };
}
