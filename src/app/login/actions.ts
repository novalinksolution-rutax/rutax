"use server";

/**
 * Server Actions — login por código de 6 dígitos (fallback de F1, login sin
 * contraseña del courier). Google es el camino principal (`/auth/callback`);
 * este es el camino de respaldo para quien no usa Google o prefiere el
 * código, sirviendo a las TRES personas que entran por `/login` (H11: equipo
 * del courier, sellers, conductores web) sin ninguna lógica por tipo de
 * usuario aquí — eso lo decide `/` después de que la sesión exista.
 *
 * H1: acá `shouldCreateUser: false` — LOGIN nunca crea una cuenta nueva (a
 * diferencia de `enviarCodigoRegistro`/`altaDeEmpresa` en `/registro`, que sí
 * deben poder crearla). Sin esto, cualquiera podría "loguearse" con un correo
 * cualquiera y terminar con un usuario Auth huérfano sin perfil de dominio.
 *
 * Mensaje neutro en `enviarCodigoLogin` (no revela si el correo tiene o no
 * cuenta): es una pantalla PÚBLICA sin sesión, distinta del caso que motivó
 * revertir esa regla en `cuenta-por-email.ts` (ahí quien pregunta es un
 * usuario YA autenticado, con capacidad de invitar y su bitácora — acá es
 * cualquier visitante).
 */

import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { activarPerfilDueno, buscarPerfilPorAuthUserId } from "@/modules/identidad/onboarding";

export interface EnviarCodigoLoginResultado {
  ok: boolean;
  mensaje: string;
}

export async function enviarCodigoLogin(email: string): Promise<EnviarCodigoLoginResultado> {
  const correo = email.trim().toLowerCase();
  if (!correo || !correo.includes("@")) {
    return { ok: false, mensaje: "Ingresa un correo válido." };
  }

  const supabase = await createClient();
  // H1: `shouldCreateUser: false` — nunca crea una cuenta nueva desde el login.
  await supabase.auth.signInWithOtp({
    email: correo,
    options: { shouldCreateUser: false },
  });

  // Mensaje neutro siempre, con error o sin él: no se revela si el correo
  // tiene cuenta en Rutax desde una pantalla pública sin sesión.
  return { ok: true, mensaje: `Si ${correo} tiene una cuenta en Rutax, te enviamos un código. Dura 10 minutos.` };
}

export type VerificarCodigoLoginResultado = { ok: true } | { ok: false; mensaje: string };

export async function verificarCodigoLogin(
  email: string,
  codigo: string,
): Promise<VerificarCodigoLoginResultado> {
  const correo = email.trim().toLowerCase();
  const token = codigo.trim();
  if (!correo || !token) {
    return { ok: false, mensaje: "Ingresa el correo y el código." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: "email", email: correo, token });

  if (error || !data.user) {
    return { ok: false, mensaje: "El código no es válido o venció. Pide uno nuevo." };
  }

  // Caso borde real (mismo que en `/auth/callback`, ver el comentario de
  // `buscarPerfilPorAuthUserId` en `onboarding.ts`): un dueño invitado por el
  // backstage que entra por CÓDIGO antes de aceptar nunca el enlace de correo
  // — su cuenta Auth ya existe (la creó `inviteUserByEmail`), así que
  // `verifyOtp` autentica como ESE mismo usuario, con `estado: invitado`. Se
  // activa acá mismo para no dejarlo atrapado en el bucle
  // `/login` → `/` → `/dashboard` → `/login`.
  const admin = crearClienteServiceRole();
  const perfil = await buscarPerfilPorAuthUserId(admin, data.user.id);
  if (perfil?.estado === "invitado") {
    await activarPerfilDueno(admin, data.user.id);
  }

  // H4: refrescar el JWT — sin esto, los claims (tenant_id/rol/estado_usuario)
  // pueden quedar del token anterior y el layout correspondiente rebota a su
  // login.
  await supabase.auth.refreshSession();

  return { ok: true };
}
