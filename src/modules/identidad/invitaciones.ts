/**
 * Invitaciones — RF-005 (interna) y RF-010 (onboarding del seller); el mismo
 * mecanismo cubre, a futuro, conductores (§4 del documento de arquitectura).
 *
 * Tres operaciones de servidor, todas vía `service_role` y todas auditadas:
 *   - `crearInvitacion`   — quien invita necesita `puedeInvitarUsuarios`.
 *   - `aceptarInvitacion` — se resuelve por token (fuera de RLS normal: el
 *                           invitado puede no tener todavía sesión con claims
 *                           del tenant); crea/actualiza `usuarios_perfil`.
 *   - `revocarInvitacion` — quien revoca necesita `puedeRevocarInvitaciones`.
 *
 * Por qué `service_role` también para crear/revocar (no solo aceptar): la
 * tabla `invitaciones` SÍ tiene políticas de INSERT/UPDATE para `authenticated`
 * interno (migración 0001), pero `bitacora_auditoria` NO admite INSERT de
 * ningún rol de cliente — solo `service_role`. Como "cada una debe quedar en
 * la bitácora" es requisito explícito de esta tarea, las tres operaciones
 * necesitan ese cliente de todos modos. Para no fragmentar la verificación de
 * permisos entre "una capa RLS" y "otra capa de aplicación", se hace TODO el
 * chequeo de capacidad aquí, en código — explícito, legible, y la única fuente
 * de verdad de "quién puede invitar/revocar" sigue siendo el mapa rol→capacidades
 * (`capacidades.ts`), nunca una política SQL paralela que pueda desincronizarse.
 *
 * Operación de request/respuesta (no un job): no se sobre-diseña con colas.
 */

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { puedeInvitarUsuarios, puedeRevocarInvitaciones } from "./capacidades";
import type { UsuarioActual } from "./usuario-actual";
import { registrarEnBitacora } from "./auditoria";
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from "./errores";
import type { Rol } from "./roles";

/** Forma mínima del cliente service_role que estas funciones necesitan. */
type ClienteServicio = Pick<SupabaseClient, "auth" | "from">;

/** Vigencia por defecto de una invitación — 7 días, igual al estándar de invitaciones de Supabase Auth. */
const VIGENCIA_INVITACION_MS = 7 * 24 * 60 * 60 * 1000;

/** Tamaño del token: 32 bytes aleatorios codificados en base64url → ~43 caracteres, un solo uso. */
const TAMANO_TOKEN_BYTES = 32;

function generarToken(): string {
  return randomBytes(TAMANO_TOKEN_BYTES).toString("base64url");
}

// -----------------------------------------------------------------------------
// 1. Crear invitación
// -----------------------------------------------------------------------------

export type TipoUsuarioInvitacion = "interno" | "seller" | "conductor";

export interface CrearInvitacionInput {
  email: string;
  tipoUsuario: TipoUsuarioInvitacion;
  rol: Rol;
  /** Obligatorio y solo válido si `tipoUsuario === 'seller'`. */
  sellerId?: string | null;
  /** Obligatorio y solo válido si `tipoUsuario === 'conductor'`. */
  driverId?: string | null;
  /** Override de vigencia, en milisegundos desde ahora. Por defecto 7 días. */
  vigenciaMs?: number;
}

export interface InvitacionCreada {
  id: string;
  token: string;
  expiraEn: string;
}

function validarCoherenciaTipoUsuario(input: CrearInvitacionInput): void {
  if (input.tipoUsuario === "seller") {
    if (!input.sellerId) {
      throw new ErrorValidacion("Una invitación de tipo 'seller' requiere seller_id.");
    }
    if (input.driverId) {
      throw new ErrorValidacion("Una invitación de tipo 'seller' no debe llevar driver_id.");
    }
    if (input.rol !== "seller") {
      throw new ErrorValidacion("Una invitación de tipo 'seller' debe tener rol 'seller'.");
    }
  } else if (input.tipoUsuario === "conductor") {
    if (!input.driverId) {
      throw new ErrorValidacion("Una invitación de tipo 'conductor' requiere driver_id.");
    }
    if (input.sellerId) {
      throw new ErrorValidacion("Una invitación de tipo 'conductor' no debe llevar seller_id.");
    }
    if (input.rol !== "conductor") {
      throw new ErrorValidacion("Una invitación de tipo 'conductor' debe tener rol 'conductor'.");
    }
  } else {
    // interno
    if (input.sellerId || input.driverId) {
      throw new ErrorValidacion("Una invitación interna no debe llevar seller_id ni driver_id.");
    }
    if (!(["dueno", "supervisor", "coordinador", "administracion"] as const).includes(input.rol as never)) {
      throw new ErrorValidacion(
        "Una invitación interna debe tener un rol interno (dueno, supervisor, coordinador o administracion).",
      );
    }
  }
}

/**
 * Crea una invitación de un solo uso para el tenant del usuario que invita.
 *
 * Requiere `puedeInvitarUsuarios(actor)`. El `tenant_id` se toma del actor
 * (nunca del input — evita que alguien fabrique una invitación para otro
 * tenant pasando un id distinto).
 */
export async function crearInvitacion(
  cliente: ClienteServicio,
  actor: UsuarioActual,
  actorUsuarioId: string,
  input: CrearInvitacionInput,
): Promise<InvitacionCreada> {
  if (!puedeInvitarUsuarios(actor)) {
    throw new ErrorValidacion("El usuario no tiene capacidad para invitar usuarios.");
  }
  if (!actor.tenantId) {
    // No debería ocurrir para un interno activo (constraint de BD lo garantiza),
    // pero lo dejamos explícito: sin tenant no hay a qué invitar.
    throw new ErrorValidacion("El usuario que invita no pertenece a un tenant.");
  }
  if (!input.email.trim() || !input.email.includes("@")) {
    throw new ErrorValidacion("El email de la invitación es obligatorio y debe ser válido.");
  }
  validarCoherenciaTipoUsuario(input);

  const email = input.email.trim().toLowerCase();
  const token = generarToken();
  const vigenciaMs = input.vigenciaMs ?? VIGENCIA_INVITACION_MS;
  const expiraEn = new Date(Date.now() + vigenciaMs).toISOString();

  const { data, error } = await cliente
    .from("invitaciones")
    .insert({
      tenant_id: actor.tenantId,
      email,
      tipo_usuario: input.tipoUsuario,
      rol: input.rol,
      seller_id: input.sellerId ?? null,
      driver_id: input.driverId ?? null,
      token,
      estado: "pendiente",
      expira_en: expiraEn,
    })
    .select("id, token, expira_en")
    .single();

  if (error || !data) {
    throw new Error(`No se pudo crear la invitación: ${error?.message ?? "desconocido"}`);
  }

  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId: actor.tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "invitacion.creada",
    entidadTipo: "invitacion",
    entidadId: data.id as string,
    detalle: {
      email,
      tipo_usuario: input.tipoUsuario,
      rol: input.rol,
      seller_id: input.sellerId ?? null,
      driver_id: input.driverId ?? null,
      expira_en: expiraEn,
      // NUNCA se guarda `token` en la bitácora — es de un solo uso y secreto
      // hasta que se canjea; el filtro de auditoria.ts también lo bloquearía.
    },
  });

  return { id: data.id as string, token: data.token as string, expiraEn: data.expira_en as string };
}

// -----------------------------------------------------------------------------
// 2. Aceptar invitación
// -----------------------------------------------------------------------------

export interface AceptarInvitacionInput {
  token: string;
  /**
   * uuid del usuario de Supabase Auth que está aceptando. Lo resuelve el
   * llamador (p. ej. tras `auth.admin.getUserByEmail` o porque el invitado ya
   * inició sesión con un magic link / completó el signup). Esta función NO
   * crea el usuario de Auth — la invitación de Supabase Auth (si se usa ese
   * canal) o el flujo de signup ya lo hacen; aquí solo se deja consistente el
   * perfil de DOMINIO (`usuarios_perfil`).
   */
  usuarioAuthId: string;
  nombreCompleto: string;
}

export interface InvitacionAceptada {
  tenantId: string;
  usuarioId: string;
  rol: Rol;
}

/**
 * Acepta una invitación por token: crea o actualiza `usuarios_perfil` con los
 * datos de la invitación y la marca `aceptada`.
 *
 * Se resuelve completamente por token — fuera de RLS normal (regla del doc.
 * de arquitectura: "el invitado puede no tener todavía sesión con claims del
 * tenant"). Por eso usa `service_role` y valida todo en código:
 *   - token existe, está `pendiente` y no expiró → si no, error específico.
 *   - deja `usuarios_perfil` coherente con los constraints de BD y con lo que
 *     el `custom_access_token_hook` necesita (tipo_usuario + seller_id/driver_id
 *     + rol coherentes — replica exactamente la lógica de los constraints
 *     `usuarios_perfil_*_coherente*` para no poder violarlos).
 *   - usa upsert por `id` (1:1 con auth.users): cubre tanto "usuario nuevo"
 *     como "usuario ya existente que el courier vuelve a invitar con otro rol".
 */
export async function aceptarInvitacion(
  cliente: ClienteServicio,
  input: AceptarInvitacionInput,
): Promise<InvitacionAceptada> {
  if (!input.token.trim()) {
    throw new ErrorValidacion("El token de invitación es obligatorio.");
  }
  if (!input.nombreCompleto.trim()) {
    throw new ErrorValidacion("El nombre completo es obligatorio para aceptar la invitación.");
  }

  const { data: invitacion, error: buscarError } = await cliente
    .from("invitaciones")
    .select("id, tenant_id, email, tipo_usuario, rol, seller_id, driver_id, estado, expira_en")
    .eq("token", input.token.trim())
    .maybeSingle();

  if (buscarError) {
    throw new Error(`No se pudo resolver la invitación: ${buscarError.message}`);
  }
  if (!invitacion) {
    throw new ErrorNoEncontrado("El token de invitación no existe o ya fue usado.");
  }
  if (invitacion.estado !== "pendiente") {
    throw new ErrorConflicto(`La invitación ya no está disponible (estado actual: ${invitacion.estado}).`);
  }
  if (new Date(invitacion.expira_en as string).getTime() <= Date.now()) {
    // Marcamos la invitación como expirada al detectarlo (limpieza perezosa,
    // sin job aparte — sigue siendo una operación puntual de request/respuesta).
    await cliente.from("invitaciones").update({ estado: "expirada" }).eq("id", invitacion.id);
    throw new ErrorConflicto("La invitación expiró. Solicita una nueva.");
  }

  const tenantId = invitacion.tenant_id as string;
  const tipoUsuario = invitacion.tipo_usuario as TipoUsuarioInvitacion;
  const rol = invitacion.rol as Rol;
  const sellerId = (invitacion.seller_id as string | null) ?? null;
  const driverId = (invitacion.driver_id as string | null) ?? null;

  // Replica EXACTAMENTE los constraints usuarios_perfil_seller_id_coherente /
  // usuarios_perfil_driver_id_coherente / usuarios_perfil_rol_coherente_con_tipo
  // (migración 0001) — si la invitación fuera incoherente (no debería, porque
  // crearInvitacion ya valida, pero los datos pueden venir de otra vía/versión
  // anterior), preferimos un error claro aquí a que la BD rechace el insert
  // con un mensaje críptico de constraint.
  if (tipoUsuario === "seller" && !sellerId) {
    throw new ErrorValidacion("Invitación inconsistente: tipo 'seller' sin seller_id.");
  }
  if (tipoUsuario === "conductor" && !driverId) {
    throw new ErrorValidacion("Invitación inconsistente: tipo 'conductor' sin driver_id.");
  }

  const { error: upsertError } = await cliente.from("usuarios_perfil").upsert(
    {
      id: input.usuarioAuthId,
      tenant_id: tenantId,
      nombre_completo: input.nombreCompleto.trim(),
      tipo_usuario: tipoUsuario,
      seller_id: tipoUsuario === "seller" ? sellerId : null,
      driver_id: tipoUsuario === "conductor" ? driverId : null,
      rol,
      estado: "activo",
    },
    { onConflict: "id" },
  );

  if (upsertError) {
    throw new Error(`No se pudo crear/actualizar el perfil del usuario invitado: ${upsertError.message}`);
  }

  const { error: marcarError } = await cliente
    .from("invitaciones")
    .update({ estado: "aceptada" })
    .eq("id", invitacion.id)
    .eq("estado", "pendiente"); // doble candado anti-reuso concurrente (un solo uso)

  if (marcarError) {
    throw new Error(`No se pudo marcar la invitación como aceptada: ${marcarError.message}`);
  }

  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId,
    actorUsuarioId: input.usuarioAuthId,
    actorTipo: "usuario",
    accion: "invitacion.aceptada",
    entidadTipo: "invitacion",
    entidadId: invitacion.id as string,
    detalle: {
      email: invitacion.email,
      tipo_usuario: tipoUsuario,
      rol,
      seller_id: sellerId,
      driver_id: driverId,
      usuario_id: input.usuarioAuthId,
    },
  });

  return { tenantId, usuarioId: input.usuarioAuthId, rol };
}

// -----------------------------------------------------------------------------
// 3. Revocar invitación
// -----------------------------------------------------------------------------

export interface RevocarInvitacionInput {
  invitacionId: string;
}

/**
 * Revoca una invitación pendiente (no la borra — trazabilidad: cambia su
 * `estado` a `revocada`, igual que documenta la migración 0001).
 *
 * Requiere `puedeRevocarInvitaciones(actor)`. Solo se puede revocar dentro del
 * propio tenant del actor y mientras siga `pendiente` (una ya `aceptada` no
 * tiene sentido revocarla; una `expirada`/`revocada` ya está cerrada).
 */
export async function revocarInvitacion(
  cliente: ClienteServicio,
  actor: UsuarioActual,
  actorUsuarioId: string,
  input: RevocarInvitacionInput,
): Promise<void> {
  if (!puedeRevocarInvitaciones(actor)) {
    throw new ErrorValidacion("El usuario no tiene capacidad para revocar invitaciones.");
  }
  if (!actor.tenantId) {
    throw new ErrorValidacion("El usuario que revoca no pertenece a un tenant.");
  }

  const { data: invitacion, error: buscarError } = await cliente
    .from("invitaciones")
    .select("id, tenant_id, email, estado")
    .eq("id", input.invitacionId)
    .maybeSingle();

  if (buscarError) {
    throw new Error(`No se pudo resolver la invitación a revocar: ${buscarError.message}`);
  }
  if (!invitacion) {
    throw new ErrorNoEncontrado("La invitación no existe.");
  }
  // P1 a mano: aunque usamos service_role (que bypassa RLS), reforzamos en
  // código que jamás se opera sobre una invitación de OTRO tenant — el
  // aislamiento se respeta también cuando el código corre con privilegios
  // elevados, no solo cuando RLS está activo.
  if (invitacion.tenant_id !== actor.tenantId) {
    throw new ErrorNoEncontrado("La invitación no existe.");
  }
  if (invitacion.estado !== "pendiente") {
    throw new ErrorConflicto(`Solo se pueden revocar invitaciones pendientes (estado actual: ${invitacion.estado}).`);
  }

  const { error: actualizarError } = await cliente
    .from("invitaciones")
    .update({ estado: "revocada" })
    .eq("id", invitacion.id)
    .eq("estado", "pendiente");

  if (actualizarError) {
    throw new Error(`No se pudo revocar la invitación: ${actualizarError.message}`);
  }

  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId: actor.tenantId,
    actorUsuarioId,
    actorTipo: "usuario",
    accion: "invitacion.revocada",
    entidadTipo: "invitacion",
    entidadId: invitacion.id as string,
    detalle: {
      email: invitacion.email,
    },
  });
}
