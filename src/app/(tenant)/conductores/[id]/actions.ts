"use server";

/**
 * Server Actions — Invitar un conductor a la app (ficha del conductor).
 *
 * MOLDE: `src/app/(tenant)/sellers/invitar/actions.ts` — mismo patrón de
 * "asociar una invitación a una entidad de negocio ya creada" (allá
 * `sellerId`, acá `driverId`). Diferencia clave: el conductor YA EXISTE (se
 * dio de alta desde `/conductores`, `actionCrearConductor`) — esta acción no
 * crea ninguna entidad nueva, solo la invitación, así que delega ÍNTEGRO a
 * `crearInvitacion` (ya valida coherencia tipo_usuario↔rol↔driver_id y
 * registra en bitácora) sin duplicar esa lógica aquí.
 *
 * Por qué el chequeo de "¿ya tiene cuenta o invitación pendiente?" vive ACÁ y
 * no solo en la UI: invitar dos veces al mismo conductor —o no saber si ya se
 * invitó— es exactamente la fricción que este botón viene a quitar (encargo).
 * Ocultar el botón en la interfaz no basta (CLAUDE.md: "la autorización real
 * vive en el backend — ocultar no basta"), así que el guard se repite en el
 * servidor antes de crear la invitación. `identidad.usuarios_perfil.driver_id`
 * no tiene unicidad en base de datos (ver `20260101000002_sellers_conductores.sql`,
 * índice simple, no `unique`), así que sin este guard un conductor podría
 * terminar con dos cuentas si se le invita dos veces y ambas se aceptan.
 *
 * RBAC: `puedeInvitarUsuarios` (capacidad `invitar_usuarios_internos`) — la
 * MISMA que gatea `/equipo` (`invitarPersona`) y `/sellers/invitar`
 * (`invitarSeller`). No se inventa una capacidad nueva ni se reusa una de
 * operación (`asignar_y_reasignar_pedidos`, que gatea el resto de
 * `/conductores`): invitar a la app es gestión de acceso, no configuración
 * operativa del pool.
 *
 * Usa `service_role` porque `crearInvitacion` ya lo exige (escribe en
 * `bitacora_auditoria`, sin política de INSERT para `authenticated`) y porque
 * las comprobaciones de "¿ya existe cuenta/invitación?" deben ver el tenant
 * completo con el mismo cliente que hace el INSERT final — mismo criterio que
 * `sellers/invitar/actions.ts`.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
import { crearInvitacion } from "@/modules/identidad/invitaciones";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from "@/modules/identidad/errores";

// -----------------------------------------------------------------------------
// 1. Invitar
// -----------------------------------------------------------------------------

export interface ConductorInvitado {
  email: string;
  expiraEn: string;
  /**
   * `true` solo si el correo SALIÓ de verdad. En sandbox (o sin URL pública
   * declarada) es `false` — la UI debe ofrecer "Copiar enlace" en vez de
   * prometer un correo que nadie va a recibir.
   */
  emailEnviado: boolean;
}

export type AccionInvitarConductorResultado =
  | { ok: true; invitacion: ConductorInvitado }
  | { ok: false; tipo: "permiso" | "validacion" | "conflicto" | "desconocido"; mensaje: string };

function mapearErrorInvitacion(error: unknown): AccionInvitarConductorResultado {
  if (error instanceof ErrorValidacion) {
    return { ok: false, tipo: "validacion", mensaje: error.message };
  }
  if (error instanceof ErrorConflicto) {
    return { ok: false, tipo: "conflicto", mensaje: error.message };
  }
  if (error instanceof ErrorNoEncontrado) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos completar la invitación por un problema de nuestro sistema.",
    };
  }
  // Un error que llega hasta aquí es, por definición, uno que no anticipamos —
  // y el usuario solo ve "problema de nuestro sistema". Sin este log queda sin
  // rastro en ninguna parte: el POST responde 200 (la Server Action no lanza) y
  // los logs del servidor no muestran nada. Pasó al probar esta pantalla: el
  // fallo era reproducible y aun así invisible.
  console.error("[invitarConductor] error no anticipado:", error);
  return {
    ok: false,
    tipo: "desconocido",
    mensaje: "No pudimos enviar la invitación por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
  };
}

/**
 * Invita a un conductor YA CREADO a la app (`tipoUsuario: 'conductor'`,
 * `rol: 'conductor'`, `driverId` obligatorio — ver `crearInvitacion`).
 */
export async function invitarConductor(
  driverId: string,
  email: string,
): Promise<AccionInvitarConductorResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return {
      ok: false,
      tipo: "permiso",
      mensaje: "No tienes permiso para invitar conductores a la app — contacta al dueño de la cuenta.",
    };
  }

  const emailNormalizado = email.trim().toLowerCase();
  if (!emailNormalizado || !emailNormalizado.includes("@")) {
    return { ok: false, tipo: "validacion", mensaje: "Ingresa un correo válido." };
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  // Cruce de tenant: el conductor debe existir Y pertenecer al tenant del
  // actor. `service_role` salta RLS, así que el aislamiento aquí lo impone
  // esta cláusula y no la base — mismo criterio que el resto de `identidad`.
  const { data: conductor, error: errorConductor } = await cliente
    .from("conductores")
    .select("id, nombre_completo")
    .eq("id", driverId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (errorConductor) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos verificar al conductor por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
  if (!conductor) {
    return { ok: false, tipo: "validacion", mensaje: "No encontramos a este conductor." };
  }

  // Ya tiene cuenta → no duplicar (ver nota de cabecera: driver_id no es
  // único en usuarios_perfil, el guard vive en código a propósito).
  const { data: perfilExistente, error: errorPerfil } = await cliente
    .from("usuarios_perfil")
    .select("id")
    .eq("driver_id", driverId)
    .eq("tenant_id", tenantId)
    .eq("tipo_usuario", "conductor")
    .maybeSingle();

  if (errorPerfil) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje:
        "No pudimos verificar la cuenta del conductor por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
  if (perfilExistente) {
    return {
      ok: false,
      tipo: "conflicto",
      mensaje: `${conductor.nombre_completo as string} ya tiene una cuenta en la app.`,
    };
  }

  // Ya tiene una invitación pendiente y vigente → no duplicar; "Copiar
  // enlace" es el camino para volver a compartírsela.
  const { data: invitacionExistente, error: errorInvitacion } = await cliente
    .from("invitaciones")
    .select("id, expira_en")
    .eq("driver_id", driverId)
    .eq("tenant_id", tenantId)
    .eq("tipo_usuario", "conductor")
    .eq("estado", "pendiente")
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (errorInvitacion) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje:
        "No pudimos verificar invitaciones anteriores por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
  if (invitacionExistente && new Date(invitacionExistente.expira_en as string).getTime() > Date.now()) {
    return {
      ok: false,
      tipo: "conflicto",
      mensaje: 'Este conductor ya tiene una invitación pendiente — usa "Copiar enlace" para compartírsela de nuevo.',
    };
  }

  let creada;
  try {
    creada = await crearInvitacion(cliente, sesion.usuario, sesion.usuarioId, {
      email: emailNormalizado,
      tipoUsuario: "conductor",
      rol: "conductor",
      driverId,
    });
  } catch (error) {
    return mapearErrorInvitacion(error);
  }

  return {
    ok: true,
    invitacion: {
      email: emailNormalizado,
      expiraEn: creada.expiraEn,
      emailEnviado: creada.emailEnviado,
    },
  };
}

// -----------------------------------------------------------------------------
// 2. "Copiar enlace" — mismo patrón que `sellers/actions.ts` →
//    `obtenerInvitacionPendienteSeller`. Obligatorio, no opcional: el correo
//    puede no llegar (sandbox, rebote) y sin esta salida el conductor queda
//    bloqueado sin forma de entrar a la app.
// -----------------------------------------------------------------------------

export type EnlaceInvitacionConductorResultado =
  | { ok: true; token: string; email: string; expiraEn: string }
  | { ok: false; mensaje: string };

/**
 * Devuelve el token de la invitación pendiente de un conductor para que el
 * cliente arme el enlace con su propio `window.location.origin` (siempre
 * correcto, sin depender de una variable de entorno bien puesta).
 *
 * El token se pide bajo demanda y NUNCA viaja con el HTML de la página — quien
 * lo tiene entra como ese conductor. Cada entrega queda en bitácora con su
 * autor (RNF-04), igual que en `/sellers`.
 */
export async function obtenerInvitacionPendienteConductor(
  driverId: string,
): Promise<EnlaceInvitacionConductorResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No hay una sesión activa." };
  }
  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return {
      ok: false,
      mensaje: "No tienes permiso para ver enlaces de invitación — contacta al dueño de la cuenta.",
    };
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  // El filtro por tenant_id es lo que impide que un driverId de otro courier
  // devuelva algo: `service_role` salta RLS, así que el aislamiento aquí lo
  // impone esta cláusula y no la base. No quitarla.
  const { data, error } = await cliente
    .from("invitaciones")
    .select("id, token, email, expira_en")
    .eq("driver_id", driverId)
    .eq("tenant_id", tenantId)
    .eq("tipo_usuario", "conductor")
    .eq("estado", "pendiente")
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      mensaje: "No pudimos recuperar el enlace por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
  if (!data) {
    return {
      ok: false,
      mensaje: "Este conductor ya no tiene una invitación pendiente — puede que ya haya entrado.",
    };
  }

  const expiraEn = data.expira_en as string;
  if (new Date(expiraEn).getTime() <= Date.now()) {
    return {
      ok: false,
      mensaje: "Esta invitación venció. Vuelve a invitarlo para generar una nueva.",
    };
  }

  // Entregar el enlace es dar acceso: queda en bitácora con su autor (RNF-04).
  // El token NUNCA se registra — la BD además lo rechazaría (constraint
  // `bitacora_auditoria_detalle_sin_secretos`).
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId: sesion.usuarioId,
    actorTipo: "usuario",
    accion: "invitacion.enlace_entregado",
    entidadTipo: "invitacion",
    entidadId: data.id as string,
    detalle: { driver_id: driverId, email: data.email as string, via: "copiar_enlace" },
  });

  return {
    ok: true,
    token: data.token as string,
    email: data.email as string,
    expiraEn,
  };
}
