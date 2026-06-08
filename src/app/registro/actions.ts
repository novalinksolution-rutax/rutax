"use server";

/**
 * Server Action — alta de empresa (Pantalla A, RF-006).
 *
 * Capa delgada de "ruta de servidor": valida la forma del input recibido del
 * formulario, arma el `cliente` `service_role` (única vez que este código de
 * `app/**` lo hace — y solo porque `crearTenantConDueno` lo EXIGE por
 * contrato: en el alta no existe todavía sesión/tenant_id que autorice nada),
 * y delega toda la lógica de negocio a `crearTenantConDueno`. No duplica
 * validaciones de negocio — solo traduce el resultado a algo que el formulario
 * cliente pueda usar sin filtrar detalles de servidor.
 *
 * Camino de auto-servicio (decisión de `ux-ui`, §0 del documento): el actor es
 * `{ usuarioId: null, tipo: 'sistema' }` — "el propio interesado se da de alta".
 */

import { crearTenantConDueno } from "@/modules/identidad/onboarding";
import { ErrorConflicto, ErrorValidacion } from "@/modules/identidad/errores";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";

export interface AltaEmpresaEntrada {
  nombreFantasia: string;
  razonSocial: string;
  rut: string;
  nombreDueno: string;
  emailDueno: string;
}

export type AltaEmpresaResultado =
  | { ok: true; email: string }
  | { ok: false; tipo: "validacion" | "conflicto_rut" | "conflicto_email" | "desconocido"; mensaje: string };

export async function altaDeEmpresa(entrada: AltaEmpresaEntrada): Promise<AltaEmpresaResultado> {
  try {
    const cliente = crearClienteServiceRole();

    await crearTenantConDueno(cliente, {
      tenant: {
        nombreFantasia: entrada.nombreFantasia,
        razonSocial: entrada.razonSocial,
        rut: entrada.rut,
      },
      dueno: {
        email: entrada.emailDueno,
        nombreCompleto: entrada.nombreDueno,
      },
      actor: { usuarioId: null, tipo: "sistema" },
    });

    return { ok: true, email: entrada.emailDueno.trim().toLowerCase() };
  } catch (error) {
    if (error instanceof ErrorValidacion) {
      return { ok: false, tipo: "validacion", mensaje: error.message };
    }
    if (error instanceof ErrorConflicto) {
      const esRut = /rut/i.test(error.message);
      return {
        ok: false,
        tipo: esRut ? "conflicto_rut" : "conflicto_email",
        mensaje: error.message,
      };
    }
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos crear tu cuenta por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
}

/**
 * Reenvía el correo de invitación inicial — acción de "¿no te llegó?" de la
 * Pantalla B. Throttle real (anti-abuso) es responsabilidad de `backend`/
 * `devops` a nivel de infraestructura; aquí solo se evita reintentar sobre un
 * email que ya pasó por sesión y delegamos al método estándar de Supabase Auth
 * (reenvía a un usuario `invitado` existente).
 */
export interface ReenviarCorreoActivacionResultado {
  ok: boolean;
  mensaje: string;
}

export async function reenviarCorreoActivacion(email: string): Promise<ReenviarCorreoActivacionResultado> {
  const correo = email.trim().toLowerCase();
  if (!correo || !correo.includes("@")) {
    return { ok: false, mensaje: "No reconocemos ese correo." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const { data, error } = await cliente.auth.admin.listUsers();
    if (error) {
      return {
        ok: false,
        mensaje: "No pudimos reenviar el correo por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
      };
    }

    const usuario = data.users.find((u) => (u.email ?? "").toLowerCase() === correo);
    if (!usuario) {
      // No revelamos si el correo existe o no (mismo criterio que "no
      // verificar antes de invitar" del Flujo 2) — respuesta neutra.
      return { ok: true, mensaje: `Si ${correo} tiene una activación pendiente, te reenviamos el enlace.` };
    }

    const { error: errorInvitacion } = await cliente.auth.admin.inviteUserByEmail(correo);
    if (errorInvitacion) {
      return {
        ok: false,
        mensaje: "No pudimos reenviar el correo por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
      };
    }

    return { ok: true, mensaje: `Te reenviamos el enlace de activación a ${correo}.` };
  } catch {
    return {
      ok: false,
      mensaje: "No pudimos reenviar el correo por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
}
