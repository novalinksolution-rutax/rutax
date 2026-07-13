/**
 * Sesión del backstage de plataforma (super-admin de Rutax) — SOLO SERVIDOR.
 * =============================================================================
 *
 * F3-A: este módulo dejó de manejar cookies propias. La sesión del backstage
 * ES la sesión Supabase Auth real del super-admin (misma cookie que usa
 * `src/lib/supabase/server.ts` para cualquier otro usuario de la app) — el
 * "dual-gate" (identidad + gobernanza + MFA) vive en
 * `@/modules/plataforma/autorizacion-admin` (`exigirSuperAdmin` /
 * `exigirSuperAdminEscritura`). Este archivo es ahora una fachada delgada
 * sobre ese gate, para no tener que tocar cada Server Action / página que ya
 * importa `tieneSesionAdmin` / `exigirActorAdmin` desde aquí.
 *
 * HISTÓRICO (lo que este módulo hacía hasta F3-A, ya retirado):
 * - Secreto compartido `SUPER_ADMIN_SECRET` validado por formulario POST.
 * - Cookie `rutax_admin_session`: token derivado `HMAC-SHA256(secreto, …)`.
 * - Cookie `rutax_admin_actor`: el super-admin AUTO-DECLARABA su identidad
 *   (elegía su email de una lista), firmada con el mismo HMAC — "gap 3,
 *   F2-mínimo": mejor que `actorUsuarioId: null`, pero NO era no-repudiación
 *   real (cualquiera con el secreto podía declararse cualquier admin).
 * F3-A cierra ese gap: la identidad ahora la certifica Supabase Auth (login
 * con contraseña propia + MFA), no una auto-declaración.
 *
 * `SUPER_ADMIN_SECRET` NO desaparece todavía: las ~7 funciones de
 * `modules/plataforma/acciones.ts` siguen validándolo internamente
 * (`verificarAdminSecret`) — asunto del "Paso 2" (retirar ese secreto de esas
 * funciones), deliberadamente FUERA de alcance de F3-A. Por eso
 * `exigirActorAdmin()` sigue devolviendo `adminSecret`: es un DROP-IN, ningún
 * caller existente (`suscripciones/acciones.ts`, `planes/acciones.ts`) necesita
 * cambiar. Lo que cambió es CÓMO se autoriza el acceso a esa función, no su
 * contrato de salida.
 */

import {
  exigirSuperAdmin,
  exigirSuperAdminEscritura,
  type RolAdmin,
  type NivelAal,
} from "@/modules/plataforma/autorizacion-admin";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";

/**
 * `true` si la request trae una sesión de super-admin válida CON MFA
 * verificado en esta sesión (AAL2) — la política de F3-A exige AAL2 para TODO
 * `/admin/*` salvo la propia pantalla de enrolamiento/step-up de MFA (que usa
 * `exigirSuperAdmin()` directo, sin esta exigencia). Nombre conservado para no
 * tener que tocar las ~9 páginas de `/admin/*` que ya lo importan como guarda
 * de "doble verificación" (defensa en profundidad detrás del gate real de
 * `layout.tsx`).
 */
export async function tieneSesionAdmin(): Promise<boolean> {
  try {
    const actor = await exigirSuperAdmin();
    return actor.aal === "aal2";
  } catch {
    return false;
  }
}

/**
 * `rolAdmin` de la sesión actual, o `null` si no hay sesión admin válida —
 * insumo para que las pantallas `/admin/*` OCULTEN/DESHABILITEN controles de
 * ESCRITURA cuando `rolAdmin !== 'admin_total'` (UX; el gate real que importa
 * es `exigirSuperAdminEscritura`, que cada Server Action ya exige por su
 * cuenta vía `exigirActorAdmin()` — esto es solo para no ofrecerle a un
 * `soporte_lectura` un botón que el servidor va a rechazar igual).
 *
 * Memoizada por request (misma `cache()` de `exigirSuperAdmin`): llamarla
 * junto a `tieneSesionAdmin()` en la misma página no repite ninguna consulta.
 */
export async function obtenerRolAdminActual(): Promise<RolAdmin | null> {
  try {
    const actor = await exigirSuperAdmin();
    return actor.rolAdmin;
  } catch {
    return null;
  }
}

/**
 * Exige sesión admin válida CON actor real y devuelve el `adminSecret` (leído
 * de env, para las ~7 funciones de `plataforma` que aún lo piden — Paso 2
 * pendiente, ver cabecera) junto al `actorUsuarioId` REAL (uuid de
 * `auth.users`) para la bitácora, y `rolAdmin`/`aal` por si el caller quiere
 * usarlos (los callers actuales solo desestructuran `adminSecret` y
 * `actorUsuarioId` — DROP-IN).
 *
 * Exige permiso de ESCRITURA (`exigirSuperAdminEscritura`): rol `admin_total`
 * Y MFA verificado (AAL2) en esta sesión — un `soporte_lectura` o una sesión
 * sin step-up lanzan (`RequierePermisoEscritura` / `RequiereAal2`,
 * respectivamente) antes de tocar ninguna acción financiera.
 */
export async function exigirActorAdmin(): Promise<{
  adminSecret: string;
  actorUsuarioId: string;
  rolAdmin: RolAdmin;
  aal: NivelAal;
}> {
  const actor = await exigirSuperAdminEscritura();

  const secreto = process.env.SUPER_ADMIN_SECRET;
  if (!secreto) {
    throw new Error("El backstage no está configurado en este entorno (falta SUPER_ADMIN_SECRET).");
  }

  return {
    adminSecret: secreto,
    actorUsuarioId: actor.usuarioId,
    rolAdmin: actor.rolAdmin,
    aal: actor.aal,
  };
}

// =============================================================================
// Listado de super-admins — usado por el filtro de actor de `/admin/bitacora`
// =============================================================================
// Sin relación con el gate de arriba: es una lectura de catálogo (para mostrar
// nombres legibles en el filtro), no una verificación de autorización.

/**
 * Super-admin activo, forma reducida para listados (sin `rolAdmin`). Nombrado
 * distinto de `SuperAdminActivo` (`@/modules/plataforma/autorizacion-admin`)
 * a propósito — ese otro tipo es el resultado de la lectura de GOBERNANZA del
 * gate (con `rolAdmin`, usado para autorizar); este es solo un DTO de catálogo
 * para poblar un `<select>`.
 */
export interface SuperAdminListado {
  usuarioId: string;
  email: string;
  nombre: string;
}

/**
 * Lista los super-admins ACTIVOS — insumo del filtro "actor" de
 * `/admin/bitacora` (lo consume `frontend`). Solo `usuario_id`/`email`/`nombre`.
 */
export async function obtenerSuperAdminsActivos(): Promise<SuperAdminListado[]> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("plataforma")
    .from("super_admins")
    .select("usuario_id, email, nombre")
    .eq("activo", true)
    .order("nombre", { ascending: true });

  if (error) throw new Error(`Error al listar super-admins activos: ${error.message}`);

  return (data ?? []).map((f) => ({
    usuarioId: f.usuario_id as string,
    email: f.email as string,
    nombre: f.nombre as string,
  }));
}
