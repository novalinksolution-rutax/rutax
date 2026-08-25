"use server";

/**
 * Server Actions — Pantalla H (lista de usuarios e invitaciones, RF-005) y
 * puente hacia la Pantalla I (formulario de invitación).
 *
 * Capa delgada de "ruta de servidor": valida sesión + capacidad y delega
 * SIEMPRE a `crearInvitacion`/`revocarInvitacion` (ya validan capacidad,
 * coherencia tipo_usuario↔rol y registran en bitácora) — no se duplica esa
 * lógica aquí. Usa `service_role` porque ambas funciones de `identidad` ya lo
 * exigen (escriben en `invitaciones` + `bitacora_auditoria`, esta última sin
 * política de INSERT para `authenticated` — ver `auditoria.ts`).
 *
 * "Reenviar" vs. "reinvitar" (decisión clave de §2.2): una invitación
 * `pendiente` se REENVÍA (mismo token, mismo registro — solo se reenvía el
 * correo); una `expirada`/`revocada` se REINVITA (`crearInvitacion` de nuevo,
 * con los mismos datos, porque el token/vigencia anteriores ya no sirven). Son
 * dos funciones de servidor DISTINTAS — el cliente nunca debe poder confundirlas
 * bajo un mismo botón.
 */

import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  puedeGestionarUsuariosYRoles,
  puedeInvitarUsuarios,
  puedeRevocarInvitaciones,
} from "@/modules/identidad/capacidades";
import {
  crearInvitacion,
  revocarInvitacion,
  type TipoUsuarioInvitacion,
} from "@/modules/identidad/invitaciones";
import { enviarEmailInvitacion } from "@/modules/identidad/notificaciones-invitacion";
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from "@/modules/identidad/errores";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { esRolInterno, ROLES_INTERNOS, type Rol, type RolInterno } from "@/modules/identidad/roles";

// -----------------------------------------------------------------------------
// Lectura — usuarios activos + invitaciones del tenant (cliente de sesión: P1
// estricta, RLS ya filtra por tenant_id, ver migración 0001 §8)
// -----------------------------------------------------------------------------

export interface UsuarioEquipo {
  id: string;
  nombreCompleto: string;
  email: string | null;
  rol: RolInterno;
  estado: "activo" | "suspendido";
  creadoEn: string;
}

export type EstadoInvitacion = "pendiente" | "aceptada" | "expirada" | "revocada";

export interface InvitacionEquipo {
  id: string;
  email: string;
  rol: RolInterno;
  estado: EstadoInvitacion;
  expiraEn: string;
  creadoEn: string;
  /**
   * Qué pasó con el correo DESPUÉS de que el proveedor lo aceptó — lo cuenta el
   * webhook de Resend, no el envío. `null` mientras no haya vuelto ningún
   * evento (o para invitaciones anteriores a que el webhook existiera).
   *
   * Sin esto, una dirección mal escrita se veía en esta pantalla EXACTAMENTE
   * igual que una que llegó: "Enviada hace 1 minuto" y nada más. El dato ya
   * estaba en la base desde el 7-ago; lo que faltaba era traerlo hasta el ojo
   * de quien invita (verificado con un rebote real, 2026-08-16).
   */
  emailEstado: string | null;
  emailMotivo: string | null;
}

export interface EstadoEquipo {
  usuarios: UsuarioEquipo[];
  invitaciones: InvitacionEquipo[];
}

export async function obtenerEstadoEquipo(): Promise<
  { ok: true; estado: EstadoEquipo } | { ok: false; mensaje: string }
> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No hay una sesión activa." };
  }
  if (!puedeGestionarUsuariosYRoles(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para ver esta sección." };
  }

  const supabase = await createClient();
  const [{ data: filasUsuarios, error: errorUsuarios }, { data: filasInvitaciones, error: errorInvitaciones }] =
    await Promise.all([
      supabase
        .from("usuarios_perfil")
        .select("id, nombre_completo, rol, estado, creado_en")
        .eq("tenant_id", sesion.usuario.tenantId)
        .eq("tipo_usuario", "interno")
        .order("creado_en", { ascending: true }),
      supabase
        .from("invitaciones")
        .select("id, email, rol, estado, expira_en, creado_en, email_estado, email_motivo")
        .eq("tenant_id", sesion.usuario.tenantId)
        .eq("tipo_usuario", "interno")
        .order("creado_en", { ascending: false }),
    ]);

  if (errorUsuarios || errorInvitaciones) {
    return { ok: false, mensaje: "No pudimos cargar tu equipo por un problema de nuestro sistema." };
  }

  // El email vive en `auth.users`, no en `usuarios_perfil` (perfil de dominio
  // vs. identidad de Auth). Lo resolvemos vía `service_role` — el mismo patrón
  // que ya usa `invitacion/[token]/actions.ts` para `existeCuentaConEmail` —
  // porque `authenticated` no tiene acceso de lectura a `auth.users` ajenos.
  const cliente = crearClienteServiceRole();
  const correos = await resolverCorreos(cliente, (filasUsuarios ?? []).map((fila) => fila.id as string));

  const usuarios: UsuarioEquipo[] = (filasUsuarios ?? [])
    .filter((fila) => esRolInternoSeguro(fila.rol))
    .map((fila) => ({
      id: fila.id as string,
      nombreCompleto: fila.nombre_completo as string,
      email: correos.get(fila.id as string) ?? null,
      rol: fila.rol as RolInterno,
      estado: fila.estado as UsuarioEquipo["estado"],
      creadoEn: fila.creado_en as string,
    }));

  const invitaciones: InvitacionEquipo[] = (filasInvitaciones ?? [])
    .filter((fila) => esRolInternoSeguro(fila.rol))
    .map((fila) => ({
      id: fila.id as string,
      email: fila.email as string,
      rol: fila.rol as RolInterno,
      estado: fila.estado as EstadoInvitacion,
      expiraEn: fila.expira_en as string,
      creadoEn: fila.creado_en as string,
      emailEstado: (fila.email_estado as string | null) ?? null,
      emailMotivo: (fila.email_motivo as string | null) ?? null,
    }));

  return { ok: true, estado: { usuarios, invitaciones } };
}

function esRolInternoSeguro(valor: unknown): valor is RolInterno {
  return typeof valor === "string" && (ROLES_INTERNOS as readonly string[]).includes(valor);
}

type ClienteAdmin = ReturnType<typeof crearClienteServiceRole>;

async function resolverCorreos(cliente: ClienteAdmin, ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (ids.length === 0) return mapa;

  const pendientes = new Set(ids);
  let pagina = 1;
  // `listUsers` es paginado — recorremos hasta resolver todos los ids
  // pedidos o agotar las páginas (tope defensivo de 20: ~2.000 usuarios de
  // Auth, generoso para Fase A de un tenant).
  while (pendientes.size > 0 && pagina <= 20) {
    const { data, error } = await cliente.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error || !data?.users?.length) break;

    for (const usuario of data.users) {
      if (pendientes.has(usuario.id)) {
        if (usuario.email) mapa.set(usuario.id, usuario.email);
        pendientes.delete(usuario.id);
      }
    }
    if (data.users.length < 200) break;
    pagina += 1;
  }

  return mapa;
}

// -----------------------------------------------------------------------------
// Acciones sobre invitaciones — reenviar / reinvitar / revocar (tabla §2.2)
// -----------------------------------------------------------------------------

export type AccionEquipoResultado =
  | {
      ok: true;
      /**
       * Presente solo en las acciones que mandan correo (reenviar/reinvitar).
       * `false` significa que NO salió — en sandbox, o sin URL pública
       * declarada. La UI debe decirlo tal cual en vez de afirmar "enviada".
       */
      emailEnviado?: boolean;
    }
  | { ok: false; tipo: "permiso" | "validacion" | "conflicto" | "desconocido"; mensaje: string };

function mapearError(error: unknown): AccionEquipoResultado {
  if (error instanceof ErrorValidacion) {
    return { ok: false, tipo: "permiso", mensaje: "No tienes permiso para invitar usuarios — contacta al dueño de la cuenta." };
  }
  if (error instanceof ErrorConflicto) {
    return { ok: false, tipo: "conflicto", mensaje: error.message };
  }
  if (error instanceof ErrorNoEncontrado) {
    return { ok: false, tipo: "validacion", mensaje: "Esta invitación ya no existe — recarga la lista." };
  }
  return {
    ok: false,
    tipo: "desconocido",
    mensaje: "No pudimos completar esta acción por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
  };
}

/**
 * Reenvía el correo de una invitación `pendiente` — MISMO token, mismo
 * registro, ningún dato mutado (esa es la diferencia con "reinvitar", que crea
 * una invitación nueva porque la anterior ya no sirve).
 *
 * HISTORIA: esta función era un no-op. Confirmaba la elegibilidad y devolvía
 * `ok:true` dejando el envío "para el job de notificaciones" — un job que no
 * existía. El botón decía "Reenviar correo", la UI confirmaba "Invitación
 * reenviada" y no salía nada. Ahora envía de verdad por el mismo camino que el
 * alta (`enviarEmailInvitacion`) y devuelve si SALIÓ, para que la confirmación
 * no vuelva a ser una promesa vacía.
 *
 * Usa `service_role` (no el cliente de sesión) por dos razones: necesita leer
 * el `token` para poder armar el enlace, y `enviarEmailInvitacion` escribe en
 * `bitacora_auditoria`, que no admite INSERT de ningún rol de cliente.
 */
export async function reenviarInvitacion(invitacionId: string): Promise<AccionEquipoResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return { ok: false, tipo: "permiso", mensaje: "No tienes permiso para invitar usuarios — contacta al dueño de la cuenta." };
  }

  const cliente = crearClienteServiceRole();
  // El filtro por `tenant_id` es lo que aísla: `service_role` salta RLS.
  // `.schema("identidad")` es obligatorio: este SELECT pide `token` para armar
  // el enlace, y `token` NO existe en `public.invitaciones` (la vista PostgREST
  // por defecto la omite desde la migración 20260807000001, a propósito, para
  // que ningún interno la lea por PostgREST). Sin esto, el SELECT falla con
  // 42703 y "Reenviar correo" queda roto. No quitar este `.schema(...)`.
  const { data: invitacion, error: errorBuscar } = await cliente
    .schema("identidad")
    .from("invitaciones")
    // `rol` entra en el SELECT para que el correo del equipo pueda decir a qué
    // acceso está entrando quien lo recibe — igual que en el primer envío.
    .select("id, estado, email, tipo_usuario, rol, token, expira_en")
    .eq("id", invitacionId)
    .eq("tenant_id", sesion.usuario.tenantId)
    .maybeSingle();

  if (errorBuscar) {
    return { ok: false, tipo: "desconocido", mensaje: "No pudimos reenviar esta invitación por un problema de nuestro sistema." };
  }
  if (!invitacion) {
    return { ok: false, tipo: "validacion", mensaje: "Esta invitación ya no existe — recarga la lista." };
  }
  if (invitacion.estado !== "pendiente") {
    return {
      ok: false,
      tipo: "conflicto",
      mensaje: "Esta invitación ya no está pendiente — usa 'Reinvitar' para enviar una nueva.",
    };
  }
  // Una `pendiente` puede estar vencida por el reloj sin que nadie haya movido
  // su estado todavía: reenviarla mandaría un enlace que no sirve.
  if (new Date(invitacion.expira_en as string).getTime() <= Date.now()) {
    return {
      ok: false,
      tipo: "conflicto",
      mensaje: "Esta invitación ya venció — usa 'Reinvitar' para enviar una nueva.",
    };
  }

  const envio = await enviarEmailInvitacion(cliente, {
    tenantId: sesion.usuario.tenantId,
    invitacionId: invitacion.id as string,
    email: invitacion.email as string,
    tipoUsuario: invitacion.tipo_usuario as TipoUsuarioInvitacion,
    rolInterno: esRolInterno(invitacion.rol as Rol) ? (invitacion.rol as RolInterno) : null,
    token: invitacion.token as string,
    expiraEn: invitacion.expira_en as string,
  });

  return { ok: true, emailEnviado: envio.enviado };
}

/**
 * Reinvita a alguien cuya invitación quedó `expirada`/`revocada`: crea una
 * invitación NUEVA reusando email + rol — el token/vigencia anteriores ya no
 * sirven (decisión de §2.2: "operaciones distintas en el backend").
 */
export async function reinvitarUsuario(invitacionId: string): Promise<AccionEquipoResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return { ok: false, tipo: "permiso", mensaje: "No tienes permiso para invitar usuarios — contacta al dueño de la cuenta." };
  }

  const supabase = await createClient();
  const { data: anterior, error: errorBuscar } = await supabase
    .from("invitaciones")
    .select("id, email, rol, estado")
    .eq("id", invitacionId)
    .eq("tenant_id", sesion.usuario.tenantId)
    .maybeSingle();

  if (errorBuscar) {
    return { ok: false, tipo: "desconocido", mensaje: "No pudimos reinvitar a esta persona por un problema de nuestro sistema." };
  }
  if (!anterior) {
    return { ok: false, tipo: "validacion", mensaje: "Esta invitación ya no existe — recarga la lista." };
  }
  if (anterior.estado !== "expirada" && anterior.estado !== "revocada") {
    return {
      ok: false,
      tipo: "conflicto",
      mensaje: "Solo se puede reinvitar a alguien cuya invitación venció o fue revocada.",
    };
  }
  if (!esRolInternoSeguro(anterior.rol)) {
    return { ok: false, tipo: "validacion", mensaje: "El rol de esta invitación ya no es válido — invita a la persona de nuevo desde cero." };
  }

  const cliente = crearClienteServiceRole();
  let emailEnviado = false;
  try {
    const nueva = await crearInvitacion(cliente, sesion.usuario, sesion.usuarioId, {
      email: anterior.email as string,
      tipoUsuario: "interno",
      rol: anterior.rol as RolInterno,
    });
    emailEnviado = nueva.emailEnviado;
  } catch (error) {
    return mapearError(error);
  }

  return { ok: true, emailEnviado };
}

/** Revoca una invitación `pendiente` — delega íntegro a `revocarInvitacion`. */
export async function revocarInvitacionDeEquipo(invitacionId: string): Promise<AccionEquipoResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeRevocarInvitaciones(sesion.usuario)) {
    return { ok: false, tipo: "permiso", mensaje: "No tienes permiso para revocar invitaciones — contacta al dueño de la cuenta." };
  }

  const cliente = crearClienteServiceRole();
  try {
    await revocarInvitacion(cliente, sesion.usuario, sesion.usuarioId, { invitacionId });
  } catch (error) {
    return mapearError(error);
  }

  return { ok: true };
}

// -----------------------------------------------------------------------------
// Pantalla I — crear invitación (sin selector de tipo_usuario, §2.2: solo
// roles internos invitables; tipo_usuario='interno' inferido)
// -----------------------------------------------------------------------------

export interface InvitarPersonaEntrada {
  email: string;
  rol: RolInterno;
}

export interface InvitacionEnviada {
  id: string;
  email: string;
  rol: RolInterno;
  estado: "pendiente";
  expiraEn: string;
  creadoEn: string;
}

export type AccionInvitarResultado =
  | { ok: true; invitacion: InvitacionEnviada }
  | { ok: false; tipo: "permiso" | "validacion" | "conflicto" | "desconocido"; mensaje: string };

export async function invitarPersona(entrada: InvitarPersonaEntrada): Promise<AccionInvitarResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return { ok: false, tipo: "permiso", mensaje: "No tienes permiso para invitar usuarios — contacta al dueño de la cuenta." };
  }

  const email = entrada.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, tipo: "validacion", mensaje: "Ingresa un correo válido para la persona que invitas." };
  }
  if (!esRolInternoSeguro(entrada.rol)) {
    return { ok: false, tipo: "validacion", mensaje: "Elige un rol de la lista." };
  }

  const cliente = crearClienteServiceRole();
  let creada;
  try {
    creada = await crearInvitacion(cliente, sesion.usuario, sesion.usuarioId, {
      email,
      tipoUsuario: "interno",
      rol: entrada.rol,
    });
  } catch (error) {
    const mapeado = mapearError(error);
    if (!mapeado.ok) return mapeado;
    // mapearError siempre retorna `ok: false` — esta línea es inalcanzable,
    // pero TS necesita un retorno coherente con el tipo de la rama de error.
    return { ok: false, tipo: "desconocido", mensaje: "No pudimos enviar la invitación." };
  }

  return {
    ok: true,
    invitacion: {
      id: creada.id,
      email,
      rol: entrada.rol,
      estado: "pendiente",
      expiraEn: creada.expiraEn,
      creadoEn: new Date().toISOString(),
    },
  };
}

// -----------------------------------------------------------------------------
// Cambiar el rol, suspender y reactivar — las tres que faltaban
// -----------------------------------------------------------------------------
/**
 * 🐞 Las tres no existían, y la interfaz lo admitía a medias.
 *
 * La celda de acciones de una persona activa decía, literal, **«Gestión de rol
 * próximamente»** —única ocurrencia de esa palabra en todo `src/`— y la celda de
 * estado pintaba **«Suspendido»** sin que ninguna acción llevara a ese estado ni
 * saliera de él. Un estado que se dibuja sin transiciones o es código muerto o,
 * peor, dejó gente atrapada por un camino que ya no existe.
 *
 * Las tres escriben bitácora ANTES del efecto, con `actorUsuarioId`: cambiarle
 * el rol a alguien o cortarle el acceso es una acción de acceso, y RNF-04 exige
 * el quién.
 *
 * No se delega a un módulo de `identidad` porque no hay uno para esto: el ciclo
 * de vida del usuario interno vive en `usuarios_perfil` y hasta hoy solo lo
 * escribía la aceptación de invitación.
 */

/** Nadie puede cambiarse el rol a sí mismo ni suspenderse solo. */
function esUnoMismo(sesionUsuarioId: string, usuarioId: string): boolean {
  return sesionUsuarioId === usuarioId;
}

export async function cambiarRolDePersona(
  usuarioId: string,
  rolNuevo: RolInterno,
): Promise<AccionEquipoResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeGestionarUsuariosYRoles(sesion.usuario)) {
    return {
      ok: false,
      tipo: "permiso",
      mensaje: "No tienes permiso para cambiar roles — contacta al dueño de la cuenta.",
    };
  }
  if (!ROLES_INTERNOS.includes(rolNuevo)) {
    return { ok: false, tipo: "validacion", mensaje: "Ese rol no existe." };
  }
  // Quitarse a uno mismo la gestión de usuarios deja al tenant sin quién la
  // ejerza si además es el único dueño. Se prohíbe entero: es más simple de
  // entender que una regla condicional, y nadie necesita degradarse solo.
  if (esUnoMismo(sesion.usuarioId, usuarioId)) {
    return {
      ok: false,
      tipo: "validacion",
      mensaje: "No puedes cambiarte el rol a ti mismo. Pídeselo a otra persona con acceso.",
    };
  }

  const cliente = crearClienteServiceRole();

  const { data: actual, error: errorLectura } = await cliente
    .schema("identidad")
    .from("usuarios_perfil")
    .select("rol, nombre_completo, tipo_usuario")
    .eq("id", usuarioId)
    .eq("tenant_id", sesion.usuario.tenantId)
    .maybeSingle();

  if (errorLectura) {
    return { ok: false, tipo: "desconocido", mensaje: "No se pudo leer a esa persona." };
  }
  if (!actual) {
    return { ok: false, tipo: "validacion", mensaje: "Esa persona no está en tu equipo." };
  }
  if (actual.tipo_usuario !== "interno") {
    return {
      ok: false,
      tipo: "validacion",
      mensaje: "Solo se puede cambiar el rol de alguien de tu equipo interno.",
    };
  }
  if (actual.rol === rolNuevo) return { ok: true };

  try {
    await registrarEnBitacora(cliente, {
      tenantId: sesion.usuario.tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "usuario.rol_cambiado",
      entidadTipo: "usuario",
      entidadId: usuarioId,
      detalle: { rol_anterior: actual.rol, rol_nuevo: rolNuevo },
    });

    const { error } = await cliente
      .schema("identidad")
      .from("usuarios_perfil")
      .update({ rol: rolNuevo })
      .eq("id", usuarioId)
      .eq("tenant_id", sesion.usuario.tenantId);

    if (error) throw error;
  } catch (error) {
    return mapearError(error);
  }

  return { ok: true };
}

/**
 * Suspende o reactiva a alguien del equipo.
 *
 * Suspender no borra: la persona conserva su historial —sus manifiestos, sus
 * acciones en la bitácora— y deja de poder entrar. `capacidadesDe` ya devuelve
 * el conjunto vacío para quien no está activo, así que el corte es real en toda
 * la app y no depende de que cada pantalla se acuerde de comprobarlo.
 */
export async function cambiarEstadoDePersona(
  usuarioId: string,
  activo: boolean,
): Promise<AccionEquipoResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeGestionarUsuariosYRoles(sesion.usuario)) {
    return {
      ok: false,
      tipo: "permiso",
      mensaje: "No tienes permiso para suspender personas — contacta al dueño de la cuenta.",
    };
  }
  if (esUnoMismo(sesion.usuarioId, usuarioId)) {
    return {
      ok: false,
      tipo: "validacion",
      mensaje: "No puedes suspenderte a ti mismo: te quedarías fuera sin poder volver a entrar.",
    };
  }

  const cliente = crearClienteServiceRole();
  const estadoNuevo = activo ? "activo" : "suspendido";

  try {
    await registrarEnBitacora(cliente, {
      tenantId: sesion.usuario.tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: activo ? "usuario.reactivado" : "usuario.suspendido",
      entidadTipo: "usuario",
      entidadId: usuarioId,
      detalle: { estado: estadoNuevo },
    });

    const { error } = await cliente
      .schema("identidad")
      .from("usuarios_perfil")
      .update({ estado: estadoNuevo })
      .eq("id", usuarioId)
      .eq("tenant_id", sesion.usuario.tenantId)
      .eq("tipo_usuario", "interno");

    if (error) throw error;
  } catch (error) {
    return mapearError(error);
  }

  return { ok: true };
}
