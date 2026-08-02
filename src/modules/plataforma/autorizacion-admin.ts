/**
 * Gate de autorización REAL del backstage `/admin` (super-admin de Rutax).
 * =============================================================================
 * F3-A — Paso 1 "dual-gate" del diseño de `arquitecto`. Reemplaza el secreto
 * compartido (`SUPER_ADMIN_SECRET` + cookie HMAC, ver histórico en
 * `src/app/admin/sesion-admin.ts`) por SESIONES SUPABASE AUTH reales de
 * super-admins nombrados, con rol fino y MFA (TOTP).
 *
 * DOS verificaciones independientes ("dual-gate"), en este orden:
 *   1. Identidad — sesión Supabase real + claim `tipo_usuario='super_admin'`
 *      (`esSuperAdminDePlataforma`, inyectado por el
 *      `custom_access_token_hook` desde `identidad.usuarios_perfil`).
 *   2. Gobernanza — fila ACTIVA en `plataforma.super_admins`, leída FRESCA
 *      (nunca cacheada en el JWT) en cada request vía `service_role`. Esto es
 *      lo que permite REVOCACIÓN INMEDIATA: desactivar a un super-admin
 *      (`activo=false`) le corta el acceso en la siguiente request, sin
 *      esperar a que expire ni se refresque su JWT.
 *
 * Sobre esas dos verificaciones se resuelve el AAL (Authenticator Assurance
 * Level) de la sesión vía `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`
 * — NUNCA se fuerza aal2 aquí: cada llamador decide qué exige
 * (`exigirSuperAdmin` permite aal1 para las páginas de solo lectura y el
 * enrolamiento/step-up de MFA; `exigirSuperAdminEscritura` exige aal2 SIEMPRE,
 * sin excepción, para cualquier acción de escritura del backstage).
 *
 * `plataforma` sigue siendo deny-all para `authenticated` (invariante de
 * CLAUDE.md): el super-admin JAMÁS opera contra `plataforma.*` con su propio
 * rol de sesión — este módulo usa `crearClienteServiceRole()` para leer
 * `super_admins`, y las funciones de negocio (`modules/plataforma/acciones.ts`)
 * siguen operando 100% vía `service_role`. La sesión Supabase real del
 * super-admin es SOLO el gate de autorización, no el rol con el que se toca la
 * base de datos.
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { esSuperAdminDePlataforma } from "@/modules/identidad/capacidades";

// =============================================================================
// Tipos
// =============================================================================

/** Rol fino de backstage (`plataforma.super_admins.rol_admin`, migración 20260711000001). */
export type RolAdmin = "admin_total" | "soporte_lectura";

/** AAL normalizado a los dos valores que este backstage entiende (nunca `null`). */
export type NivelAal = "aal1" | "aal2";

/** Super-admin ACTIVO resuelto fresco desde `plataforma.super_admins`. */
export interface SuperAdminActivo {
  usuarioId: string;
  email: string;
  nombre: string;
  rolAdmin: RolAdmin;
}

/** Actor resuelto por `exigirSuperAdmin` — identidad + gobernanza + AAL de la sesión. */
export interface ActorSuperAdmin {
  usuarioId: string;
  email: string;
  nombre: string;
  rolAdmin: RolAdmin;
  /** AAL actual de la sesión ('aal2' solo si el usuario YA verificó su TOTP en esta sesión). */
  aal: NivelAal;
  /**
   * AAL al que la sesión PODRÍA subir verificando un factor ya enrolado
   * (`supabase.auth.mfa.getAuthenticatorAssuranceLevel().nextLevel`). Patrón
   * documentado por Supabase para distinguir los dos casos de "falta MFA":
   *   - `aal === 'aal1' && aalSiguiente === 'aal2'` → tiene un factor TOTP
   *     enrolado, falta el STEP-UP (verificarlo en esta sesión).
   *   - `aal === 'aal1' && aalSiguiente === 'aal1'` → NO tiene ningún factor
   *     enrolado todavía (falta el ENROLAMIENTO, no solo la verificación).
   * `frontend` usa esta distinción para decidir qué pantalla mostrar
   * (`/admin/seguridad` de enrolamiento vs. modal de step-up).
   */
  aalSiguiente: NivelAal;
}

// =============================================================================
// Errores tipados — la UI los captura para decidir qué pantalla mostrar
// =============================================================================

/** Sin sesión real, o sesión real pero sin identidad/gobernanza de super-admin vigente. */
export class NoAutorizadoAdmin extends Error {
  constructor(mensaje = "No autorizado.") {
    super(mensaje);
    this.name = "NoAutorizadoAdmin";
  }
}

/** Sesión de super-admin válida, pero `rol_admin='soporte_lectura'` intentando escribir. */
export class RequierePermisoEscritura extends Error {
  constructor(mensaje = "Tu rol de soporte (solo lectura) no puede realizar esta acción.") {
    super(mensaje);
    this.name = "RequierePermisoEscritura";
  }
}

/** Sesión de super-admin válida con rol de escritura, pero sin MFA verificado (AAL1). */
export class RequiereAal2 extends Error {
  constructor(mensaje = "Esta acción exige verificación en dos pasos (MFA) en esta sesión.") {
    super(mensaje);
    this.name = "RequiereAal2";
  }
}

// =============================================================================
// Lectura fresca de gobernanza — plataforma.super_admins
// =============================================================================

/**
 * Lee FRESCO (sin caché, sin JWT) `plataforma.super_admins` para `usuarioId`
 * vía `service_role` — el schema `plataforma` es deny-all para `authenticated`,
 * así que ESTA es la única vía. Devuelve `null` si la fila no existe o si
 * `activo=false`: nunca se distingue el motivo al llamador (mismo criterio de
 * "no filtrar por qué" que ya usaba `resolverSuperAdminPorEmail`).
 *
 * DELIBERADAMENTE no se cachea por request ni se guarda en el JWT: es lo que
 * permite que desactivar a un super-admin (`activo=false`) le corte el acceso
 * de inmediato, en vez de esperar horas a que expire su JWT.
 */
export async function resolverSuperAdminActivo(usuarioId: string): Promise<SuperAdminActivo | null> {
  if (!usuarioId) return null;

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("plataforma")
    .from("super_admins")
    .select("usuario_id, email, nombre, rol_admin, activo")
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (error) throw new Error(`Error al validar super-admin: ${error.message}`);
  if (!data || data.activo !== true) return null;

  return {
    usuarioId: data.usuario_id as string,
    email: data.email as string,
    nombre: data.nombre as string,
    rolAdmin: data.rol_admin as RolAdmin,
  };
}

// =============================================================================
// Gate principal
// =============================================================================

/** Normaliza el AAL que devuelve supabase-js (`'aal1'|'aal2'|string|null`) a `NivelAal`. */
function normalizarAal(nivel: string | null | undefined): NivelAal {
  return nivel === "aal2" ? "aal2" : "aal1";
}

/**
 * Exige sesión Supabase REAL de un super-admin ACTIVO (identidad + gobernanza,
 * ver cabecera del módulo). Resuelve el AAL de la sesión pero NO lo exige en
 * ningún nivel particular — los callers de solo lectura (páginas `/admin/*`,
 * la página de enrolamiento/step-up de MFA) aceptan tanto aal1 como aal2;
 * `exigirSuperAdminEscritura` es quien sube la vara a aal2 para escritura.
 *
 * Lanza `NoAutorizadoAdmin` si: no hay sesión, la sesión no es de
 * `tipo_usuario='super_admin'`, o no hay fila ACTIVA en
 * `plataforma.super_admins` para ese `usuarioId` (cubre tanto "nunca fue
 * super-admin" como "fue desactivado").
 *
 * Memoizada por request con `cache()` de React — mismo criterio que
 * `obtenerSesionActual` (`usuario-actual-servidor.ts`): `layout.tsx` y cada
 * página `/admin/*` (vía `tieneSesionAdmin()`) la invocan por su cuenta
 * ("doble verificación" deliberada, defensa en profundidad); sin memoizar,
 * cada una repetiría la lectura fresca de `plataforma.super_admins` Y la
 * resolución del AAL contra Auth. La memoización es por-request (cero
 * staleness): dentro de una misma petición la sesión/gobernanza no cambian.
 */
export const exigirSuperAdmin = cache(async function exigirSuperAdmin(): Promise<ActorSuperAdmin> {
  const sesion = await obtenerSesionActual();
  if (!sesion || !esSuperAdminDePlataforma(sesion.usuario)) {
    throw new NoAutorizadoAdmin();
  }

  const admin = await resolverSuperAdminActivo(sesion.usuarioId);
  if (!admin) {
    throw new NoAutorizadoAdmin();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) {
    // Fail-closed: si no se puede resolver el AAL de la sesión, se trata como
    // no autorizado en vez de asumir aal1 silenciosamente.
    throw new NoAutorizadoAdmin();
  }

  return {
    usuarioId: admin.usuarioId,
    email: admin.email,
    nombre: admin.nombre,
    rolAdmin: admin.rolAdmin,
    aal: normalizarAal(data?.currentLevel),
    aalSiguiente: normalizarAal(data?.nextLevel),
  };
});

/**
 * Exige, ADEMÁS de `exigirSuperAdmin`, permiso de ESCRITURA:
 *   - `rolAdmin === 'admin_total'` (si `soporte_lectura` → `RequierePermisoEscritura`).
 *   - `aal === 'aal2'` (MFA verificado EN ESTA SESIÓN; si aal1 →
 *     `RequiereAal2`, sin importar el rol — toda escritura del backstage
 *     exige el segundo factor, sin excepción).
 *
 * Es la puerta que usa `exigirActorAdmin()` (`src/app/admin/sesion-admin.ts`)
 * para las ~7 acciones financieras de `modules/plataforma/acciones.ts` — así
 * ninguna escritura del backstage puede ocurrir sin rol `admin_total` Y AAL2.
 */
export async function exigirSuperAdminEscritura(): Promise<ActorSuperAdmin> {
  const actor = await exigirSuperAdmin();

  if (actor.rolAdmin !== "admin_total") {
    throw new RequierePermisoEscritura();
  }
  if (actor.aal !== "aal2") {
    throw new RequiereAal2();
  }

  return actor;
}
