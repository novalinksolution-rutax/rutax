"use server";

/**
 * Server Actions — «Crea tu cuenta» (registro v2, paso 1).
 * =============================================================================
 * Este paso SOLO identifica a la persona: Google o código de 6 dígitos por
 * correo. No pide ni guarda nada de la empresa (eso es `/registro/empresa`). Lo
 * único que deja anotado es la **intención de registro** (cookie firmada,
 * `src/lib/identidad/intencion-registro.ts`): qué versión de términos y de
 * privacidad estaba vigente cuando pulsó, y cuándo.
 *
 * Sin casilla a propósito: el aviso «Al continuar aceptas los términos y
 * declaras haber leído la política de privacidad» va junto a los botones y el
 * clic es la aceptación. Un texto que dice «aceptas» sin que se pueda no
 * aceptar solo es honesto si deja evidencia de qué se mostró — por eso la
 * versión sale del servidor (`versiones.ts`) y no de lo que mande el cliente.
 *
 * Quien ya tiene cuenta no registra: el correo con perfil se rechaza ANTES de
 * enviar el código. Una identidad que se identificó y nunca creó su empresa NO
 * cuenta como cuenta: puede volver a empezar (ver `correoTienePerfil`).
 */

import { asegurarIntencion, limpiarIntencion } from "@/lib/identidad/intencion-registro";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { correoTienePerfil, mensajeCorreoOcupado } from "@/modules/identidad/cuenta-por-email";
import { activarPerfilDueno, buscarPerfilPorAuthUserId } from "@/modules/identidad/onboarding";
import { RUTA_REGISTRO_EMPRESA } from "@/modules/identidad/registro-empresa";


// -----------------------------------------------------------------------------
// 1. Intención (camino Google)
// -----------------------------------------------------------------------------

/**
 * Anota la intención ANTES de mandar a la persona a Google. El navegador sale
 * del sitio y vuelve a `/auth/callback`, que lee esta cookie para saber que
 * venía a registrarse y no a entrar.
 */
export async function iniciarIntencionRegistro(): Promise<{ ok: true }> {
  await asegurarIntencion();
  return { ok: true };
}

// -----------------------------------------------------------------------------
// 2. Código por correo
// -----------------------------------------------------------------------------

export type EnviarCodigoRegistroResultado =
  | { ok: true; mensaje: string }
  | { ok: false; tipo: "correo_invalido" | "correo_ocupado" | "envio_fallido"; mensaje: string };

export async function enviarCodigoRegistro(email: string): Promise<EnviarCodigoRegistroResultado> {
  const correo = email.trim().toLowerCase();
  if (!correo || !correo.includes("@")) {
    return { ok: false, tipo: "correo_invalido", mensaje: "Ingresa un correo válido." };
  }

  // Antes de gastar un código: si ya es una cuenta de Rutax, se dice acá.
  if (await correoTienePerfil(crearClienteServiceRole(), correo)) {
    return {
      ok: false,
      tipo: "correo_ocupado",
      mensaje: mensajeCorreoOcupado({ existe: true, tipoEnMiCourier: null }),
    };
  }

  // La intención se anota ANTES del envío: es el clic lo que se acepta, y si el
  // envío falla igual quedó dicho qué se mostró.
  await asegurarIntencion();

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: correo,
    // En el registro SÍ se crea la identidad si el correo no la tiene (a
    // diferencia del login, `shouldCreateUser: false`).
    options: { shouldCreateUser: true },
  });

  if (error) {
    return {
      ok: false,
      tipo: "envio_fallido",
      mensaje: "No pudimos enviar el código. Intenta de nuevo en unos minutos.",
    };
  }

  return { ok: true, mensaje: `Te enviamos un código a ${correo}. Dura 10 minutos.` };
}

export type VerificarCodigoRegistroResultado =
  | { ok: true; destino: string }
  | { ok: false; tipo: "codigo_invalido" | "correo_ocupado"; mensaje: string };

export async function verificarCodigoRegistro(
  email: string,
  codigo: string,
): Promise<VerificarCodigoRegistroResultado> {
  const correo = email.trim().toLowerCase();
  const token = codigo.trim();
  if (!correo || !token) {
    return { ok: false, tipo: "codigo_invalido", mensaje: "Ingresa el correo y el código." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: "email", email: correo, token });

  if (error || !data.user) {
    return { ok: false, tipo: "codigo_invalido", mensaje: "El código no es válido o venció. Pide uno nuevo." };
  }

  const authUserId = data.user.id;
  const admin = crearClienteServiceRole();
  const perfil = await buscarPerfilPorAuthUserId(admin, authUserId);

  if (!perfil) {
    // Identificada y sin empresa: al paso 2. La sesión ya existe; el JWT
    // todavía no trae tenant y no hace falta — lo refresca la acción del paso 2
    // cuando lo cree.
    return { ok: true, destino: RUTA_REGISTRO_EMPRESA };
  }

  if (perfil.tipoUsuario === "interno" && perfil.rol === "dueno") {
    // Ya era dueño (se registró antes, o llegó a /registro por error): se
    // comporta como un login. Si el perfil sigue `invitado` (invitación del
    // backstage a la misma persona) se activa, para no dejarlo en el bucle
    // /login → / → /dashboard → /login.
    if (perfil.estado === "invitado") {
      await activarPerfilDueno(admin, authUserId);
    }
    await limpiarIntencion();
    await supabase.auth.refreshSession();
    return { ok: true, destino: "/" };
  }

  // Un correo, una cuenta (H2): ya es otra cosa en Rutax. No se crea nada encima.
  await limpiarIntencion();
  await supabase.auth.signOut();
  return {
    ok: false,
    tipo: "correo_ocupado",
    mensaje: mensajeCorreoOcupado({ existe: true, tipoEnMiCourier: null }),
  };
}
