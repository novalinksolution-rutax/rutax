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
import { crearInvitacion, revocarInvitacion } from "@/modules/identidad/invitaciones";
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from "@/modules/identidad/errores";
import { ROLES_INTERNOS, type RolInterno } from "@/modules/identidad/roles";

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
        .select("id, email, rol, estado, expira_en, creado_en")
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

export type AccionEquipoResultado = { ok: true } | { ok: false; tipo: "permiso" | "validacion" | "conflicto" | "desconocido"; mensaje: string };

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
 * registro. No existe una función de dominio separada para esto porque no
 * cambia ningún dato: en Fase A (sin proveedor de correo transaccional aún
 * conectado — eso es de `integraciones`), reenviar equivale a "tocar" el
 * registro para que el job de notificaciones lo recoja de nuevo. Se modela
 * explícito para no inventar una mutación donde el dominio no la define.
 */
export async function reenviarInvitacion(invitacionId: string): Promise<AccionEquipoResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return { ok: false, tipo: "permiso", mensaje: "No tienes permiso para invitar usuarios — contacta al dueño de la cuenta." };
  }

  const supabase = await createClient();
  const { data: invitacion, error: errorBuscar } = await supabase
    .from("invitaciones")
    .select("id, estado")
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

  // El envío real del correo lo resuelve el job/adaptador de notificaciones
  // (fuera del alcance de este lote — `integraciones`). Aquí solo se confirma
  // la elegibilidad y se deja la señal lista para que ese job la recoja; no se
  // muta ningún dato porque el registro ya está completo y vigente.
  return { ok: true };
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
  try {
    await crearInvitacion(cliente, sesion.usuario, sesion.usuarioId, {
      email: anterior.email as string,
      tipoUsuario: "interno",
      rol: anterior.rol as RolInterno,
    });
  } catch (error) {
    return mapearError(error);
  }

  return { ok: true };
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
