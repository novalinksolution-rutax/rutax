/**
 * Onboarding del courier — alta de tenant (RF-006).
 *
 * Contrato (§11 regla 1 del documento de arquitectura): nadie fuera de
 * `identidad` escribe en `tenants`/`usuarios_perfil`/`bitacora_auditoria`
 * directamente. Esta función es la ÚNICA puerta para crear un tenant nuevo
 * junto con su primer usuario `dueno`, y usa `service_role` (bypass deliberado
 * y controlado de RLS — nunca un atajo general) porque:
 *   - en el momento de la creación no existe todavía un `tenant_id` en los
 *     claims del usuario que la ejecuta (si la ejecuta el propio fundador como
 *     `super_admin`, ese rol no tiene `tenant_id`; si es autoservicio, el
 *     usuario recién se está provisionando), y
 *   - las políticas RLS de `tenants`/`usuarios_perfil` no permiten INSERT a
 *     `authenticated` por diseño (ver migración 0001 §8) — exactamente para
 *     forzar que el alta pase por aquí, auditada.
 *
 * Esta operación es de request/respuesta (no un job en segundo plano): es una
 * acción puntual de onboarding, no un proceso pesado recurrente — coherente
 * con la nota de "no sobre-diseñes con colas" del enunciado.
 *
 * El cliente `service_role` se recibe POR PARÁMETRO (inyección de
 * dependencias): en producción constrúyelo con `crearClienteServiceRole()` de
 * `@/lib/supabase/service-role` (nunca lo expongas al navegador); en pruebas,
 * pásale un doble — ver `onboarding.test.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarEnBitacora } from "./auditoria";
import { ErrorConflicto, ErrorValidacion } from "./errores";
import { normalizarYValidarRut } from "./rut";

export interface DatosTenant {
  nombreFantasia: string;
  razonSocial: string;
  /** RUT del courier — formato `NNNNNNNN-DV`; se normaliza y valida (módulo 11) antes de persistir. */
  rut: string;
  /** Default `America/Santiago` — Localización Chile (CLAUDE.md). Casi nunca debería variar en el MVP. */
  zonaHoraria?: string;
}

export interface DatosDueno {
  email: string;
  nombreCompleto: string;
}

export interface CrearTenantConDuenoInput {
  tenant: DatosTenant;
  dueno: DatosDueno;
  /**
   * Quién ejecuta el alta, para la bitácora. `null` cuando es autoservicio
   * (el propio interesado se da de alta) — en ese caso `actorTipo` debe ser
   * `'sistema'` o, si lo opera el fundador, `'super_admin'` con su uuid.
   */
  actor: { usuarioId: string | null; tipo: "super_admin" | "sistema" };
}

export interface CrearTenantConDuenoResultado {
  tenantId: string;
  duenoUsuarioId: string;
}

/** Forma mínima del cliente service_role que esta función necesita — facilita pruebas con dobles. */
type ClienteServicio = Pick<SupabaseClient, "auth" | "from">;

function validarEntrada(input: CrearTenantConDuenoInput): { rutNormalizado: string } {
  const { tenant, dueno } = input;

  if (!tenant.nombreFantasia.trim()) {
    throw new ErrorValidacion("El nombre de fantasía del courier es obligatorio.");
  }
  if (!tenant.razonSocial.trim()) {
    throw new ErrorValidacion("La razón social del courier es obligatoria.");
  }
  const rutNormalizado = normalizarYValidarRut(tenant.rut);
  if (!rutNormalizado) {
    throw new ErrorValidacion(
      "El RUT del courier no es válido (formato esperado NNNNNNNN-DV con dígito verificador correcto).",
    );
  }
  if (!dueno.email.trim() || !dueno.email.includes("@")) {
    throw new ErrorValidacion("El email del dueño es obligatorio y debe ser un correo válido.");
  }
  if (!dueno.nombreCompleto.trim()) {
    throw new ErrorValidacion("El nombre completo del dueño es obligatorio.");
  }

  return { rutNormalizado };
}

/**
 * Crea un tenant nuevo junto con su primer usuario `dueno`.
 *
 * Pasos (con compensación best-effort si algo falla a medio camino — no hay
 * transacción cross-resource entre Auth y Postgres, así que se deshace lo ya
 * creado para no dejar residuos huérfanos):
 *   1. Valida datos (incluye RUT con dígito verificador).
 *   2. Crea el usuario en Supabase Auth (invitación por email — no contraseña
 *      provisoria: el dueño define su propia clave al aceptar).
 *   3. Inserta la fila en `tenants` (`estado = 'onboarding'`).
 *   4. Inserta el perfil en `usuarios_perfil` (`tipo_usuario = 'interno'`,
 *      `rol = 'dueno'`, `estado = 'invitado'` — queda consistente con el hook
 *      de claims: cuando acepte la invitación de Auth y haga login, el hook
 *      leerá este perfil y resolverá tenant_id/rol correctamente).
 *   5. Registra `tenant.alta` en la bitácora (tenant_id ya conocido).
 *
 * Devuelve los ids creados. Lanza `ErrorValidacion`/`ErrorConflicto` para
 * fallas esperables (datos inválidos, RUT/email duplicado) y `Error` genérico
 * para fallas de infraestructura.
 */
export async function crearTenantConDueno(
  cliente: ClienteServicio,
  input: CrearTenantConDuenoInput,
): Promise<CrearTenantConDuenoResultado> {
  const { rutNormalizado } = validarEntrada(input);
  const zonaHoraria = input.tenant.zonaHoraria?.trim() || "America/Santiago";

  // --- 1. Usuario en Supabase Auth (identidad técnica) -----------------------
  // `inviteUserByEmail` crea el usuario en `auth.users` y dispara el correo de
  // invitación (define su propia contraseña al aceptar) — evita manejar
  // contraseñas provisorias, que terminarían siendo un secreto más que cuidar.
  const { data: authData, error: authError } = await cliente.auth.admin.inviteUserByEmail(
    input.dueno.email.trim().toLowerCase(),
    { data: { nombre_completo: input.dueno.nombreCompleto.trim() } },
  );

  if (authError || !authData?.user) {
    if (esErrorDeEmailDuplicado(authError)) {
      throw new ErrorConflicto(`Ya existe una cuenta con el email ${input.dueno.email}.`);
    }
    throw new Error(`No se pudo crear el usuario de autenticación del dueño: ${authError?.message ?? "desconocido"}`);
  }

  const duenoUsuarioId = authData.user.id;

  // --- 2. Fila en tenants -----------------------------------------------------
  const { data: tenantRow, error: tenantError } = await cliente
    .from("tenants")
    .insert({
      nombre_fantasia: input.tenant.nombreFantasia.trim(),
      razon_social: input.tenant.razonSocial.trim(),
      rut: rutNormalizado,
      estado: "onboarding",
      zona_horaria: zonaHoraria,
    })
    .select("id")
    .single();

  if (tenantError || !tenantRow) {
    await deshacerUsuarioAuth(cliente, duenoUsuarioId);
    if (esErrorDeRutDuplicado(tenantError)) {
      throw new ErrorConflicto(`Ya existe un courier registrado con el RUT ${rutNormalizado}.`);
    }
    throw new Error(`No se pudo crear el tenant: ${tenantError?.message ?? "desconocido"}`);
  }

  const tenantId = tenantRow.id as string;

  // --- 3. Perfil de dominio (usuarios_perfil) ---------------------------------
  // tipo_usuario='interno' + rol='dueno' + estado='invitado': consistente con
  // el constraint usuarios_perfil_rol_coherente_con_tipo y con lo que el
  // custom_access_token_hook necesita resolver al primer login del dueño.
  const { error: perfilError } = await cliente.from("usuarios_perfil").insert({
    id: duenoUsuarioId,
    tenant_id: tenantId,
    nombre_completo: input.dueno.nombreCompleto.trim(),
    tipo_usuario: "interno",
    rol: "dueno",
    estado: "invitado",
  });

  if (perfilError) {
    await deshacerTenant(cliente, tenantId);
    await deshacerUsuarioAuth(cliente, duenoUsuarioId);
    throw new Error(`No se pudo crear el perfil del dueño: ${perfilError.message}`);
  }

  // --- 4. Bitácora -------------------------------------------------------------
  // Sin secretos: solo nombres, email (dato de contacto, no credencial) e ids.
  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId,
    actorUsuarioId: input.actor.usuarioId,
    actorTipo: input.actor.tipo,
    accion: "tenant.alta",
    entidadTipo: "tenant",
    entidadId: tenantId,
    detalle: {
      nombre_fantasia: input.tenant.nombreFantasia.trim(),
      rut: rutNormalizado,
      dueno_email: input.dueno.email.trim().toLowerCase(),
      dueno_usuario_id: duenoUsuarioId,
    },
  });

  return { tenantId, duenoUsuarioId };
}

// -----------------------------------------------------------------------------
// Helpers de compensación e inspección de errores
// -----------------------------------------------------------------------------

async function deshacerUsuarioAuth(cliente: ClienteServicio, usuarioId: string): Promise<void> {
  try {
    await cliente.auth.admin.deleteUser(usuarioId);
  } catch {
    // Best-effort: si la compensación falla, preferimos no enmascarar el error
    // original — quedará un usuario Auth huérfano que requiere limpieza manual,
    // pero NUNCA un usuario_perfil/tenant a medio crear (eso sí lo evitamos).
  }
}

async function deshacerTenant(cliente: ClienteServicio, tenantId: string): Promise<void> {
  try {
    await cliente.from("tenants").delete().eq("id", tenantId);
  } catch {
    // Best-effort — ver nota de deshacerUsuarioAuth.
  }
}

function esErrorDeEmailDuplicado(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const mensaje = (error.message ?? "").toLowerCase();
  return (
    error.code === "email_exists" ||
    mensaje.includes("already been registered") ||
    mensaje.includes("already registered") ||
    mensaje.includes("duplicate")
  );
}

function esErrorDeRutDuplicado(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  // Postgres unique_violation = 23505; el índice único es `tenants_rut_uk`.
  return error.code === "23505" || (error.message ?? "").toLowerCase().includes("tenants_rut_uk");
}
