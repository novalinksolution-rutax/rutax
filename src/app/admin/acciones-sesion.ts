"use server";

/**
 * Server Actions de sesión del backstage de plataforma.
 *
 * `iniciarSesionAdmin` valida el secreto maestro (tiempo constante) y, si es
 * correcto, fija la cookie de sesión `httpOnly` con el TOKEN DERIVADO — nunca
 * el secreto crudo, nunca en la URL. `cerrarSesionAdmin` la elimina.
 *
 * NUNCA se loguea el secreto.
 */

import { cookies } from "next/headers";
import {
  COOKIE_ADMIN,
  MAX_AGE_ADMIN_SEGUNDOS,
  tokenSesionAdmin,
  validarSecretoAdmin,
} from "./sesion-admin";

export async function iniciarSesionAdmin(
  formData: FormData,
): Promise<{ ok: boolean; mensaje?: string }> {
  const secreto = (formData.get("secreto") as string | null)?.trim() ?? "";

  if (!validarSecretoAdmin(secreto)) {
    // Mensaje genérico — no revela si el secreto está configurado ni por qué falló.
    return { ok: false, mensaje: "Credenciales inválidas." };
  }

  const token = tokenSesionAdmin();
  if (!token) {
    return { ok: false, mensaje: "El backstage no está configurado en este entorno." };
  }

  const store = await cookies();
  store.set(COOKIE_ADMIN, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: MAX_AGE_ADMIN_SEGUNDOS,
  });

  return { ok: true };
}

export async function cerrarSesionAdmin(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_ADMIN);
}
