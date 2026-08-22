/**
 * Sesión de SOPORTE time-boxed del backstage `/admin` — "ver como el
 * courier" (gap 4, F3-B).
 * =============================================================================
 * PRINCIPIO NO NEGOCIABLE (arquitecto): "ver como el courier" son
 * PROYECCIONES DE SOLO LECTURA vía `service_role`, con la identidad del
 * super-admin REAL en scope. Este módulo NUNCA asume la sesión del courier,
 * NUNCA mintea un JWT con su `tenant_id`, NUNCA abre un bypass de RLS para
 * escribir como él. No hay — ni puede haber — ninguna función de ESCRITURA
 * del courier alcanzable desde aquí: `soporte.ts` solo abre/cierra/valida una
 * VENTANA DE TIEMPO durante la cual `obtenerVistaSoporteTenant`
 * (`vista-soporte.ts`) puede leer proyecciones curadas de un tenant. La
 * bitácora atribuye todo al super-admin real (`actorUsuarioId`), nunca al
 * courier.
 *
 * Mecanismo: cookie firmada (HMAC-SHA256), NO una tabla — recomendación
 * explícita del arquitecto por simplicidad (una sesión de soporte es
 * transitoria y de un solo actor; no necesita persistencia ni revocación
 * remota — expira sola). El secreto de firma es `SUPER_ADMIN_SECRET`: es EL
 * secreto ya designado como "la puerta del área de administración"
 * (`.env.example`), el mismo que históricamente firmaba las cookies de sesión
 * del backstage pre-F3-A (ver cabecera de `app/admin/sesion-admin.ts`) — no se
 * introduce un secreto nuevo.
 *
 * Payload de la cookie: SOLO `{ tenantId, adminId, exp }`. Nunca el motivo, ni
 * ningún dato personal — el motivo se audita en `bitacora_auditoria`, no
 * viaja en la cookie.
 *
 * Autorización: iniciar/usar una sesión de soporte exige `exigirSuperAdmin()`
 * (identidad + gobernanza — ver `autorizacion-admin.ts`). Iniciarla, además,
 * exige AAL2: es una función sensible (abre la puerta a leer datos de
 * cualquier courier), pero AMBOS roles (`admin_total` y `soporte_lectura`)
 * pueden hacerlo — a diferencia de `exigirSuperAdminEscritura`, aquí no se
 * exige `rolAdmin==='admin_total'` porque esto es lectura, no escritura.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { exigirSuperAdmin, RequiereAal2, type ActorSuperAdmin } from "./autorizacion-admin";

// =============================================================================
// Constantes
// =============================================================================

/** Nombre de la cookie de sesión de soporte. */
export const COOKIE_SOPORTE_TENANT = "rutax_admin_soporte";

/** Duración de la ventana de soporte — corta a propósito (15–30 min). */
export const DURACION_SOPORTE_MINUTOS = 20;

/** Largo mínimo exigido del motivo (evita motivos vacíos o de relleno tipo "."). */
export const LARGO_MINIMO_MOTIVO = 10;

// =============================================================================
// Tipos
// =============================================================================

/** Sesión de soporte activa/recién creada — lo que consume la UI y las proyecciones. */
export interface SesionSoporte {
  tenantId: string;
  adminId: string;
  /** ISO 8601 — cuándo expira la ventana de soporte. */
  expiraEn: string;
}

/** No hay sesión de soporte activa (nunca hubo cookie, expiró, o es inválida). */
export class NoHaySesionSoporte extends Error {
  constructor(mensaje = "No hay una sesión de soporte activa para este courier.") {
    super(mensaje);
    this.name = "NoHaySesionSoporte";
  }
}

/** Payload firmado dentro de la cookie — SIN motivo ni ningún dato personal. */
interface PayloadSoporte {
  tenantId: string;
  adminId: string;
  /** Epoch ms de expiración. */
  exp: number;
}

// =============================================================================
// Firma HMAC de la cookie (mismo criterio matemático que
// `integraciones/pagos/firma-webhook-fintoc.ts`: HMAC-SHA256 + comparación en
// tiempo constante — aquí self-contained porque el formato del token es
// propio, no el de un proveedor externo).
// =============================================================================

function resolverSecretoFirma(): string {
  const secreto = process.env.SUPER_ADMIN_SECRET;
  if (!secreto) {
    throw new Error("El backstage no está configurado en este entorno (falta SUPER_ADMIN_SECRET).");
  }
  return secreto;
}

function compararTiempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Firma `payload` como `<cuerpo_base64url>.<hmac_base64url>`. */
function firmarPayload(payload: PayloadSoporte): string {
  const secreto = resolverSecretoFirma();
  const cuerpo = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const firma = createHmac("sha256", secreto).update(cuerpo).digest("base64url");
  return `${cuerpo}.${firma}`;
}

/**
 * Verifica la firma del `token` y devuelve el payload si es válido; `null` en
 * cualquier otro caso (formato inválido, firma que no calza, secreto ausente,
 * JSON corrupto, o payload con forma inesperada). Fail-closed: nunca lanza.
 */
function verificarYExtraerPayload(token: string): PayloadSoporte | null {
  if (!token || typeof token !== "string") return null;
  const separador = token.indexOf(".");
  if (separador === -1) return null;

  const cuerpo = token.slice(0, separador);
  const firmaRecibida = token.slice(separador + 1);
  if (!cuerpo || !firmaRecibida) return null;

  let secreto: string;
  try {
    secreto = resolverSecretoFirma();
  } catch {
    return null;
  }

  const firmaEsperada = createHmac("sha256", secreto).update(cuerpo).digest("base64url");
  if (!compararTiempoConstante(firmaEsperada, firmaRecibida)) return null;

  try {
    const bruto = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as Partial<PayloadSoporte>;
    if (
      typeof bruto.tenantId !== "string" ||
      typeof bruto.adminId !== "string" ||
      typeof bruto.exp !== "number" ||
      !bruto.tenantId ||
      !bruto.adminId
    ) {
      return null;
    }
    return { tenantId: bruto.tenantId, adminId: bruto.adminId, exp: bruto.exp };
  } catch {
    return null;
  }
}

// =============================================================================
// exigirSuperAdmin + AAL2 — variante local, distinta de `exigirSuperAdminEscritura`
// (esa TAMBIÉN exige `rolAdmin==='admin_total'`; iniciar soporte NO: ambos
// roles pueden, es lectura).
// =============================================================================

async function exigirActorSoporte(): Promise<ActorSuperAdmin> {
  const actor = await exigirSuperAdmin();
  if (actor.aal !== "aal2") {
    throw new RequiereAal2();
  }
  return actor;
}

// =============================================================================
// iniciarSoporteTenant
// =============================================================================

/**
 * Abre una ventana de soporte time-boxed para `tenantId`. Exige sesión real de
 * super-admin CON AAL2 (soporte es función sensible, aunque de solo lectura).
 *
 * Orden estricto (invariante CLAUDE.md — bitácora ANTES que efectos externos):
 *   1. Autoriza (AAL2) y valida el `motivo`.
 *   2. Registra `plataforma.soporte_iniciado` en bitácora — CON `actorUsuarioId`
 *      real (RNF-04).
 *   3. Recién ahí, setea la cookie firmada (el "efecto").
 *
 * La cookie NUNCA lleva el motivo ni ningún dato personal — solo
 * `{ tenantId, adminId, exp }`.
 */
export async function iniciarSoporteTenant(opts: {
  tenantId: string;
  motivo: string;
}): Promise<SesionSoporte> {
  const actor = await exigirActorSoporte();

  const tenantId = opts.tenantId?.trim() ?? "";
  if (!tenantId) {
    throw new Error("tenantId requerido.");
  }

  const motivo = opts.motivo?.trim() ?? "";
  if (motivo.length < LARGO_MINIMO_MOTIVO) {
    throw new Error(`El motivo debe tener al menos ${LARGO_MINIMO_MOTIVO} caracteres.`);
  }

  const expiraEnMs = Date.now() + DURACION_SOPORTE_MINUTOS * 60_000;
  const expiraEnIso = new Date(expiraEnMs).toISOString();

  const supabase = crearClienteServiceRole();

  // Bitácora ANTES de cualquier efecto (setear la cookie) — RNF-04.
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: actor.usuarioId,
    actorTipo: "super_admin",
    accion: "plataforma.soporte_iniciado",
    entidadTipo: "tenant",
    entidadId: tenantId,
    detalle: { motivo, expira_en: expiraEnIso },
  });

  const token = firmarPayload({ tenantId, adminId: actor.usuarioId, exp: expiraEnMs });

  const almacenCookies = await cookies();
  almacenCookies.set(COOKIE_SOPORTE_TENANT, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: DURACION_SOPORTE_MINUTOS * 60,
  });

  return { tenantId, adminId: actor.usuarioId, expiraEn: expiraEnIso };
}

// =============================================================================
// exigirSoporteActivo
// =============================================================================

/**
 * Exige una sesión de soporte ACTIVA y vigente para `tenantId`. Gate de
 * `obtenerVistaSoporteTenant` (`vista-soporte.ts`) y de cualquier pantalla que
 * muestre datos "como el courier".
 *
 * Reglas de invalidez (cualquiera lanza `NoHaySesionSoporte`):
 *   - No hay cookie → nunca hubo sesión, NO se audita (evita ruido en la
 *     bitácora por navegación normal fuera de modo soporte).
 *   - Cookie con firma inválida, expirada, para otro tenant, o para otro
 *     admin (cookie "extraviada" de otra sesión en el mismo navegador) → SÍ
 *     se audita como `plataforma.soporte_expirado` (una entrada por chequeo
 *     fallido — no hay tabla de estado que deduplicar).
 *
 * Limpieza de la cookie: SOLO para los casos "muertos" (firma inválida,
 * expirada, admin ajeno) — un mismatch de TENANT no borra una cookie que
 * puede seguir siendo una sesión legítima para OTRO tenant (evita que visitar
 * por error la URL de soporte de otro courier corte la sesión activa real).
 * `cookies().delete()` es best-effort: si `exigirSoporteActivo` se invoca
 * desde un Server Component (contexto de solo lectura), Next.js no permite
 * mutar cookies — se ignora en silencio, igual criterio que
 * `lib/supabase/server.ts`.
 */
/**
 * Lectura PASIVA de la ventana de soporte vigente, sin exigir un tenant.
 *
 * Existe para que el marco —y no cada pantalla— pueda pintar el banner de
 * sesión suplantada. La regla 7 del sistema de diseño es explícita: ese banner
 * vive en el marco, no se colapsa, no se oculta al hacer scroll. Mientras
 * vivió dentro de la página, desaparecía en su propia rama de error y en
 * cualquier excepción que escalara al boundary raíz — justo cuando alguien más
 * necesita ver que está mirando la cuenta de otra empresa.
 *
 * ⚠️ **No escribe bitácora, a diferencia de `exigirSoporteActivo`.** Esto corre
 * en CADA render de CADA pantalla del backstage: dejar un registro de auditoría
 * por render llenaría la bitácora de ruido y escondería los hechos reales.
 * Tampoco borra la cookie vencida — de eso se sigue encargando la vía que
 * exige, que es la que sabe a nombre de qué tenant se está pidiendo.
 */
export async function leerSoporteActivo(): Promise<SesionSoporte | null> {
  const almacenCookies = await cookies();
  const cookie = almacenCookies.get(COOKIE_SOPORTE_TENANT);
  if (!cookie?.value) return null;

  const payload = verificarYExtraerPayload(cookie.value);
  if (!payload || payload.exp <= Date.now()) return null;

  return {
    tenantId: payload.tenantId,
    adminId: payload.adminId,
    expiraEn: new Date(payload.exp).toISOString(),
  };
}

export async function exigirSoporteActivo(tenantId: string): Promise<SesionSoporte> {
  const actor = await exigirSuperAdmin();

  const almacenCookies = await cookies();
  const cookie = almacenCookies.get(COOKIE_SOPORTE_TENANT);

  if (!cookie?.value) {
    throw new NoHaySesionSoporte();
  }

  const payload = verificarYExtraerPayload(cookie.value);

  let motivoInvalidez: "firma_invalida" | "expirada" | "tenant_no_coincide" | "admin_no_coincide" | null =
    null;
  if (!payload) motivoInvalidez = "firma_invalida";
  else if (payload.exp <= Date.now()) motivoInvalidez = "expirada";
  else if (payload.tenantId !== tenantId) motivoInvalidez = "tenant_no_coincide";
  else if (payload.adminId !== actor.usuarioId) motivoInvalidez = "admin_no_coincide";

  if (motivoInvalidez || !payload) {
    const supabase = crearClienteServiceRole();
    await registrarEnBitacora(supabase, {
      tenantId: payload?.tenantId ?? tenantId,
      actorUsuarioId: actor.usuarioId,
      actorTipo: "super_admin",
      accion: "plataforma.soporte_expirado",
      entidadTipo: "tenant",
      entidadId: payload?.tenantId ?? tenantId,
      detalle: { motivo_invalidez: motivoInvalidez ?? "firma_invalida" },
    });

    const debeLimpiarCookie =
      motivoInvalidez === "firma_invalida" ||
      motivoInvalidez === "expirada" ||
      motivoInvalidez === "admin_no_coincide";
    if (debeLimpiarCookie) {
      try {
        almacenCookies.delete(COOKIE_SOPORTE_TENANT);
      } catch {
        // No-op: invocado desde un contexto de solo lectura (Server Component).
      }
    }

    throw new NoHaySesionSoporte();
  }

  return { tenantId: payload.tenantId, adminId: payload.adminId, expiraEn: new Date(payload.exp).toISOString() };
}

// =============================================================================
// terminarSoporteTenant
// =============================================================================

/**
 * Cierra la sesión de soporte activa (si la hay): limpia la cookie y deja
 * constancia en bitácora. Exige sesión real de super-admin (AAL1 basta —
 * terminar una sesión es de bajo riesgo, análogo a un cierre de sesión).
 *
 * Si no hay cookie o es inválida, es un no-op silencioso (no hay sesión que
 * terminar ni tenant al cual atribuir el cierre).
 */
export async function terminarSoporteTenant(): Promise<void> {
  const actor = await exigirSuperAdmin();

  const almacenCookies = await cookies();
  const cookie = almacenCookies.get(COOKIE_SOPORTE_TENANT);
  const payload = cookie?.value ? verificarYExtraerPayload(cookie.value) : null;

  if (payload) {
    const supabase = crearClienteServiceRole();
    // Bitácora ANTES de limpiar la cookie (el efecto) — RNF-04.
    await registrarEnBitacora(supabase, {
      tenantId: payload.tenantId,
      actorUsuarioId: actor.usuarioId,
      actorTipo: "super_admin",
      accion: "plataforma.soporte_terminado",
      entidadTipo: "tenant",
      entidadId: payload.tenantId,
      detalle: {},
    });
  }

  almacenCookies.delete(COOKIE_SOPORTE_TENANT);
}
