"use server";

/**
 * Server Actions — alta de empresa por autoservicio (F1, login sin
 * contraseña del courier).
 * =============================================================================
 * F1 partió lo que antes era un solo paso (`altaDeEmpresa`, formulario → tenant
 * ya creado, correo de activación) en dos:
 *
 *   1. `guardarBorradorTenant` — valida el formulario de 5 campos (igual que
 *      antes) y lo guarda en una cookie firmada (`borrador-registro.ts`). NO
 *      crea nada todavía: sin identidad resuelta, no hay a quién asignarle el
 *      tenant.
 *   2. Resolver la identidad — Google (`/auth/callback`) o código OTP
 *      (`enviarCodigoRegistro` + `verificarCodigoRegistro`, acá). Recién ahí
 *      se provisiona el tenant, con el mismo borrador leído de la cookie.
 *
 * `altaDeEmpresa` y `reenviarCorreoActivacion` se RETIRAN: la primera creaba
 * el tenant de un solo golpe con `inviteUserByEmail` (correo con enlace, y una
 * contraseña por definir) — incompatible con "sin contraseña"; la segunda
 * reenviaba ESE enlace, que ya no existe en el autoservicio (solo el
 * backstage sigue invitando por correo, vía `crearTenantConDueno`, sin
 * cambios).
 *
 * ⚠️ Arranque MÍNIMO (rediseño de onboarding, doc §6): el formulario pasó de
 * 5 campos a 4 (`nombreFantasia`, `rut`, `nombreDueno`, `emailDueno`). La
 * razón social YA NO se guarda en el borrador ni se pasa a
 * `provisionarTenantParaAuthUser` — se difiere al hub de onboarding, que la
 * escribe después. El tenant nace con `razon_social = null`.
 */

import { normalizarYValidarRut } from "@/modules/identidad/rut";
import {
  guardarBorrador,
  leerBorrador,
  limpiarBorrador,
  type BorradorTenant,
} from "@/lib/identidad/borrador-registro";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { mensajeCorreoOcupado } from "@/modules/identidad/cuenta-por-email";
import {
  activarPerfilDueno,
  buscarPerfilPorAuthUserId,
  provisionarTenantParaAuthUser,
} from "@/modules/identidad/onboarding";
import { ErrorConflicto } from "@/modules/identidad/errores";

// -----------------------------------------------------------------------------
// 1. guardarBorradorTenant
// -----------------------------------------------------------------------------

export interface GuardarBorradorTenantEntrada {
  nombreFantasia: string;
  rut: string;
  nombreDueno: string;
  emailDueno: string;
  aceptaTerminos: boolean;
}

export type GuardarBorradorTenantResultado =
  | { ok: true }
  | { ok: false; campo?: keyof GuardarBorradorTenantEntrada; mensaje: string };

export async function guardarBorradorTenant(
  entrada: GuardarBorradorTenantEntrada,
): Promise<GuardarBorradorTenantResultado> {
  const nombreFantasia = entrada.nombreFantasia?.trim() ?? "";
  if (!nombreFantasia) {
    return { ok: false, campo: "nombreFantasia", mensaje: "El nombre de fantasía de tu empresa es obligatorio." };
  }

  const rutNormalizado = normalizarYValidarRut(entrada.rut ?? "");
  if (!rutNormalizado) {
    return {
      ok: false,
      campo: "rut",
      mensaje: "El RUT de tu empresa no es válido (verifica el dígito verificador).",
    };
  }

  const nombreDueno = entrada.nombreDueno?.trim() ?? "";
  if (!nombreDueno) {
    return { ok: false, campo: "nombreDueno", mensaje: "Tu nombre completo es obligatorio." };
  }

  const emailDueno = entrada.emailDueno?.trim().toLowerCase() ?? "";
  if (!emailDueno || !emailDueno.includes("@")) {
    return { ok: false, campo: "emailDueno", mensaje: "Tu correo es obligatorio y debe ser un correo válido." };
  }

  // H6: un consentimiento premarcado no es consentimiento — se exige explícito
  // y bloqueante, no un "al continuar aceptas" de relleno.
  if (entrada.aceptaTerminos !== true) {
    return {
      ok: false,
      campo: "aceptaTerminos",
      mensaje: "Debes aceptar los términos y condiciones y la política de privacidad para continuar.",
    };
  }

  const borrador: BorradorTenant = {
    nombreFantasia,
    rut: rutNormalizado,
    nombreDueno,
    emailDueno,
    aceptaTerminos: true,
  };

  await guardarBorrador(borrador);

  return { ok: true };
}

// -----------------------------------------------------------------------------
// 2. Código OTP — enviarCodigoRegistro / verificarCodigoRegistro
//
// El envío (`signInWithOtp` con `shouldCreateUser: true`) se hace aquí, en
// servidor, y no en el cliente: así queda simétrico con `verificarCodigoRegistro`
// (mismo módulo, mismo criterio de errores) y no duplica la construcción del
// cliente Supabase en un componente. H1: a diferencia del login, el registro
// SÍ debe poder crear la cuenta si no existe.
// -----------------------------------------------------------------------------

export interface EnviarCodigoRegistroResultado {
  ok: boolean;
  mensaje: string;
}

export async function enviarCodigoRegistro(email: string): Promise<EnviarCodigoRegistroResultado> {
  const correo = email.trim().toLowerCase();
  if (!correo || !correo.includes("@")) {
    return { ok: false, mensaje: "Ingresa un correo válido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: correo,
    // H1: en REGISTRO sí se crea la cuenta si el correo no la tiene — a
    // diferencia del login (`shouldCreateUser: false` en `login/actions.ts`).
    options: { shouldCreateUser: true },
  });

  if (error) {
    return {
      ok: false,
      mensaje: "No pudimos enviar el código. Intenta de nuevo en unos minutos.",
    };
  }

  return { ok: true, mensaje: `Te enviamos un código a ${correo}. Dura 10 minutos.` };
}

export type VerificarCodigoRegistroResultado =
  | { ok: true }
  | {
      ok: false;
      tipo: "codigo_invalido" | "sin_borrador" | "correo_ocupado" | "conflicto_rut" | "desconocido";
      mensaje: string;
    };

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

  // H2 + H5 combinados (ver el comentario de `buscarPerfilPorAuthUserId` en
  // onboarding.ts para el porqué de este chequeo y no `buscarCuentaPorEmail`).
  const perfilExistente = await buscarPerfilPorAuthUserId(admin, authUserId);
  if (perfilExistente) {
    if (perfilExistente.tipoUsuario === "interno" && perfilExistente.rol === "dueno") {
      // H5 — reintento del mismo registro (doble pestaña, código reenviado).
      // Defensa adicional (caso de borde, ver `buscarPerfilPorAuthUserId`): si
      // este perfil sigue `invitado`, se activa igual — nunca se deja una
      // sesión con `estado: invitado` camino al layout del tenant.
      if (perfilExistente.estado === "invitado") {
        await activarPerfilDueno(admin, authUserId);
      }
      await limpiarBorrador();
      await supabase.auth.refreshSession();
      return { ok: true };
    }

    // H2 — este correo YA es otra cosa en Rutax. No se crea un segundo perfil.
    await supabase.auth.signOut();
    return {
      ok: false,
      tipo: "correo_ocupado",
      mensaje: mensajeCorreoOcupado({ existe: true, tipoEnMiCourier: null }),
    };
  }

  const borrador = await leerBorrador();
  if (!borrador) {
    await supabase.auth.signOut();
    return {
      ok: false,
      tipo: "sin_borrador",
      mensaje: "Tu sesión de registro venció. Vuelve a completar el formulario.",
    };
  }

  try {
    await provisionarTenantParaAuthUser(
      admin,
      authUserId,
      {
        tenant: { nombreFantasia: borrador.nombreFantasia, rut: borrador.rut },
        dueno: { email: borrador.emailDueno, nombreCompleto: borrador.nombreDueno },
        actor: { usuarioId: null, tipo: "sistema" },
      },
      { estado: "activo", compensarAuthUser: false },
    );
  } catch (err) {
    await supabase.auth.signOut();
    // No borramos el usuario Auth acá: a esta altura ya sabemos que NO tenía
    // perfil (arriba), pero no tenemos forma barata de saber si Supabase lo
    // creó recién en este intento o si es un huérfano de otro origen — se deja
    // para revisión, igual que `/admin/cuentas` (marca `sin_perfil`). El
    // camino de Google (`/auth/callback`) SÍ puede decidirlo, con la
    // heurística de `created_at`/`last_sign_in_at` — acá, con código OTP,
    // ambos timestamps son igual de recientes en cualquier caso porque
    // `verifyOtp` los actualiza siempre, así que la heurística no discrimina
    // nada y se prefiere no borrar.
    if (err instanceof ErrorConflicto && /rut/i.test(err.message)) {
      return { ok: false, tipo: "conflicto_rut", mensaje: err.message };
    }
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos crear tu cuenta por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  await limpiarBorrador();
  // H4: refrescar el JWT para que tenant_id/rol/estado lleguen de inmediato.
  await supabase.auth.refreshSession();

  return { ok: true };
}
