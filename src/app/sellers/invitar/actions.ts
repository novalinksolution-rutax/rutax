"use server";

/**
 * Server Actions — Pantalla K (alta de seller + invitación, RF-010, §3.2).
 *
 * "El courier conoce los datos del seller (es su cliente)": esta pantalla
 * crea PRIMERO la entidad de negocio (`identidad.sellers`) y LUEGO dispara la
 * invitación asociada (`tipoUsuario: 'seller'`, `sellerId` obligatorio,
 * `rol: 'seller'`). Son dos escrituras relacionadas — no una sola — pero se
 * presentan al usuario como un único paso ("Invitar a este seller").
 *
 * Capa delgada: valida sesión + capacidad y delega la creación de la
 * invitación íntegra a `crearInvitacion` (ya valida coherencia tipo↔rol y
 * registra en bitácora) — no se duplica esa lógica aquí. El alta de `sellers`
 * sí vive en esta capa porque no existe (todavía) una función de dominio para
 * ello en `identidad` — se modela como la operación mínima y explícita que es:
 * un insert validado + auditado, con rollback manual si la invitación falla
 * (ver comentario en `invitarSeller`).
 *
 * Usa `service_role` porque `crearInvitacion` ya lo exige (escribe en
 * `bitacora_auditoria`, sin política de INSERT para `authenticated`) y porque
 * el insert en `sellers` + esa invitación deben quedar atómicamente
 * consistentes desde la perspectiva del actor (mismo cliente para ambas).
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
import { crearInvitacion } from "@/modules/identidad/invitaciones";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from "@/modules/identidad/errores";
import { normalizarYValidarRut } from "@/modules/identidad/rut";

export interface InvitarSellerEntrada {
  razonSocial: string;
  rut: string;
  nombreContacto: string;
  emailContacto: string;
}

export interface SellerInvitado {
  sellerId: string;
  razonSocial: string;
  rut: string;
  emailContacto: string;
}

export type AccionInvitarSellerResultado =
  | { ok: true; seller: SellerInvitado }
  | { ok: false; tipo: "permiso" | "validacion" | "conflicto" | "desconocido"; mensaje: string };

/**
 * Mismo mensaje de validación de RUT que el formulario de cliente
 * (`formulario-alta-empresa.tsx`, que ya replica el criterio del backend para
 * el RUT del courier) — criterio transversal #3: "el mismo mensaje de error
 * que produce el backend, evita que el usuario vea un mensaje en la UI y otro
 * distinto si el error llega del servidor". No existe (todavía) una función
 * de dominio que valide específicamente el RUT de un seller con su propio
 * mensaje — esta acción y su formulario comparten exactamente el mismo texto
 * para que cliente↔servidor jamás diverjan.
 */
const MENSAJE_RUT_INVALIDO = "El dígito verificador no corresponde a este RUT.";
const MENSAJE_RUT_FORMATO = "Ingresa el RUT con el formato 12.345.678-9.";

export async function invitarSeller(entrada: InvitarSellerEntrada): Promise<AccionInvitarSellerResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return {
      ok: false,
      tipo: "permiso",
      mensaje: "No tienes permiso para invitar sellers — contacta al dueño de la cuenta.",
    };
  }

  const razonSocial = entrada.razonSocial.trim();
  const nombreContacto = entrada.nombreContacto.trim();
  const emailContacto = entrada.emailContacto.trim().toLowerCase();

  if (!razonSocial) {
    return { ok: false, tipo: "validacion", mensaje: "Ingresa la razón social del seller." };
  }
  if (!nombreContacto) {
    return { ok: false, tipo: "validacion", mensaje: "Ingresa el nombre de la persona de contacto." };
  }
  if (!emailContacto || !emailContacto.includes("@")) {
    return { ok: false, tipo: "validacion", mensaje: "Ingresa un correo de contacto válido." };
  }

  const rutLimpio = entrada.rut.trim();
  if (!rutLimpio) {
    return { ok: false, tipo: "validacion", mensaje: "Ingresa el RUT del seller." };
  }
  if (!/^[0-9]{1,8}-[0-9kK]$/.test(rutLimpio)) {
    return { ok: false, tipo: "validacion", mensaje: MENSAJE_RUT_FORMATO };
  }
  const rutNormalizado = normalizarYValidarRut(rutLimpio);
  if (!rutNormalizado) {
    return { ok: false, tipo: "validacion", mensaje: MENSAJE_RUT_INVALIDO };
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  // 1) Alta de la entidad de negocio `sellers`. El constraint de formato de
  //    RUT ya vive en BD (`sellers_rut_formato`) — `normalizarYValidarRut`
  //    deja el valor en el formato que ese constraint exige (NNNNNNNN-K).
  const { data: sellerCreado, error: errorSeller } = await cliente
    .from("sellers")
    .insert({
      tenant_id: tenantId,
      razon_social: razonSocial,
      rut: rutNormalizado,
      nombre_contacto: nombreContacto,
      email_contacto: emailContacto,
      estado: "invitado",
    })
    .select("id, razon_social, rut, email_contacto")
    .single();

  if (errorSeller || !sellerCreado) {
    // `unique_violation` de Postgres — si en el futuro se agrega una restricción
    // de unicidad sobre (tenant_id, rut), este código la traduce a un mensaje
    // de conflicto específico en lugar de uno genérico.
    if (errorSeller?.code === "23505") {
      return {
        ok: false,
        tipo: "conflicto",
        mensaje: "Ya existe un seller registrado con ese RUT en tu cuenta.",
      };
    }
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos registrar al seller por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  const sellerId = sellerCreado.id as string;

  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId: sesion.usuarioId,
    actorTipo: "usuario",
    accion: "seller.creado",
    entidadTipo: "seller",
    entidadId: sellerId,
    detalle: { razon_social: razonSocial, rut: rutNormalizado },
  });

  // 2) Invitación asociada — delega íntegro a `crearInvitacion` (valida
  //    coherencia tipo_usuario↔rol↔seller_id y audita por su cuenta).
  try {
    await crearInvitacion(cliente, sesion.usuario, sesion.usuarioId, {
      email: emailContacto,
      tipoUsuario: "seller",
      rol: "seller",
      sellerId,
    });
  } catch (error) {
    // La fila `sellers` ya quedó creada — no la revertimos: es una entidad de
    // negocio legítima (el courier sí tiene este cliente) aunque el envío de
    // la invitación haya fallado por, p. ej., un correo duplicado. El courier
    // puede reintentar la invitación desde la lista (Pantalla H-bis), igual
    // que con el equipo interno — se modela como dos pasos relacionados, no
    // como una transacción todo-o-nada que obligaría a "deshacer" un cliente
    // real por un problema de envío de correo.
    const mapeado = mapearErrorInvitacion(error);
    return {
      ok: false,
      tipo: mapeado.tipo,
      mensaje:
        mapeado.tipo === "conflicto"
          ? `Registramos a ${razonSocial}, pero no pudimos enviarle la invitación: ${mapeado.mensaje}`
          : mapeado.mensaje,
    };
  }

  return {
    ok: true,
    seller: {
      sellerId,
      razonSocial,
      rut: rutNormalizado,
      emailContacto,
    },
  };
}

function mapearErrorInvitacion(
  error: unknown,
): { tipo: "permiso" | "validacion" | "conflicto" | "desconocido"; mensaje: string } {
  if (error instanceof ErrorValidacion) {
    return { tipo: "validacion", mensaje: error.message };
  }
  if (error instanceof ErrorConflicto) {
    return { tipo: "conflicto", mensaje: error.message };
  }
  if (error instanceof ErrorNoEncontrado) {
    return { tipo: "desconocido", mensaje: "No pudimos completar la invitación por un problema de nuestro sistema." };
  }
  return {
    tipo: "desconocido",
    mensaje: "No pudimos enviar la invitación por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
  };
}
