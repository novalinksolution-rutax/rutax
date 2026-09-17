/**
 * Borrador firmado del WIZARD de alta de seller por autoservicio (RF-010
 * rediseño) — progreso entre pasos, tras Google, hasta el commit final.
 * =============================================================================
 * El visitante YA se autenticó (`/auth/callback` detectó el intent
 * `registro-seller`, pasó la barrera y lo mandó al wizard). Entre que entra a
 * `/registro-seller/wizard` y que completa los N pasos (empresa, contacto,
 * bodega, WhatsApp, fuentes), el progreso vive en ESTA cookie firmada —
 * nunca en una tabla: nada se escribe en la base hasta el commit final
 * (`commitAltaSellerAutoservicio`), que es justo el punto del alcance ("el
 * seller nace activo al instante, sin aprobación", pero también sin filas a
 * medio llenar si abandona el wizard a la mitad).
 *
 * MISMO molde HMAC que `borrador-registro-seller.ts` — nombre de cookie
 * PROPIO (`rutax_wizard_seller`), duración más larga (un wizard de 5 pasos
 * con un humano completando formularios tarda más que un ida-y-vuelta OAuth).
 *
 * El `tenantId` viaja en el payload y es INMUTABLE durante todo el wizard: lo
 * fija `/auth/callback` a partir del enlace resuelto, y ningún paso del
 * wizard puede cambiarlo — nunca se lee del claim de sesión del usuario,
 * que puede apuntar a OTRO courier si esta identidad ya es seller de otro.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FuenteDeclarada } from "@/modules/identidad/alta-seller-autoservicio";

/** Nombre de la cookie del wizard de alta de seller. */
export const COOKIE_WIZARD_ALTA_SELLER = "rutax_wizard_seller";

/** Una hora: tiempo de sobra para completar los 5 pasos del wizard sin apuros. */
export const DURACION_WIZARD_ALTA_SELLER_MINUTOS = 60;

export type FuenteWizardSeller = FuenteDeclarada;

export interface PasoEmpresaWizardSeller {
  razonSocial: string;
  /** Ya normalizado (`NNNNNNNN-DV`) — el paso nunca guarda uno inválido. */
  rut: string;
  aceptaConsentimientoDatos: true;
  /**
   * ISO del momento EXACTO en que la persona marcó la casilla de consentimiento
   * (Ley 21.719) — no del commit. El commit sella este valor tal cual: la marca
   * temporal del asiento de consentimiento debe ser cuándo consintió, no cuándo
   * se escribió la fila.
   */
  consentimientoDatosEn: string;
}

export interface PasoContactoWizardSeller {
  nombreContacto: string;
  /** Ya normalizado a E.164, si vino. */
  telefono?: string;
}

export interface PasoBodegaWizardSeller {
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso?: string;
  contactoNombre?: string;
  contactoTelefono?: string;
  lat?: number;
  long?: number;
  geoEstado?: "resuelto" | "no_resuelto" | "fuera_cobertura";
  geoConfianza?: number;
  geocodificadoEn?: string;
}

export interface PasoWhatsappWizardSeller {
  /** Ya normalizado a E.164. */
  telefono: string;
  acepta: true;
}

export interface EstadoWizardAltaSeller {
  tenantId: string;
  empresa?: PasoEmpresaWizardSeller;
  contacto?: PasoContactoWizardSeller;
  bodega?: PasoBodegaWizardSeller;
  whatsapp?: PasoWhatsappWizardSeller;
  fuentes?: FuenteWizardSeller[];
}

interface PayloadWizard extends EstadoWizardAltaSeller {
  /** Epoch ms de expiración. */
  exp: number;
}

// -----------------------------------------------------------------------------
// Firma HMAC — mismo cálculo que el resto de los borradores de `identidad`.
// -----------------------------------------------------------------------------

function resolverSecretoFirma(): string {
  const secreto = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secreto) {
    throw new Error(
      "No se puede firmar el borrador del wizard de seller: falta SUPABASE_SERVICE_ROLE_KEY en este entorno.",
    );
  }
  return secreto;
}

function compararTiempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function firmarPayload(payload: PayloadWizard): string {
  const secreto = resolverSecretoFirma();
  const cuerpo = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const firma = createHmac("sha256", secreto).update(cuerpo).digest("base64url");
  return `${cuerpo}.${firma}`;
}

/**
 * Verifica la firma y devuelve el payload si es válido. Solo se comprueba
 * estrictamente la forma de `tenantId`/`exp` (lo único que este módulo
 * necesita garantizar) — el resto de los pasos son opcionales por diseño y
 * solo los escribe `guardarBorrador`, así que confiar en su forma tras
 * verificar la firma es seguro (nadie más puede haberlos escrito).
 */
function verificarYExtraerPayload(token: string): PayloadWizard | null {
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
    const bruto = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as Partial<PayloadWizard>;
    if (typeof bruto.tenantId !== "string" || typeof bruto.exp !== "number") {
      return null;
    }
    return {
      tenantId: bruto.tenantId,
      empresa: bruto.empresa,
      contacto: bruto.contacto,
      bodega: bruto.bodega,
      whatsapp: bruto.whatsapp,
      fuentes: bruto.fuentes,
      exp: bruto.exp,
    };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// API pública
// -----------------------------------------------------------------------------

/**
 * Firma y guarda el estado del wizard. Cada paso lo llama con el estado
 * COMPLETO (el propio + lo ya guardado antes) — no hace merge por su cuenta:
 * eso lo hace el llamador (`leerBorrador()` primero, spread, `guardarBorrador`
 * después), igual que `borrador-invitacion.ts`.
 */
export async function guardarBorrador(datos: EstadoWizardAltaSeller): Promise<void> {
  const exp = Date.now() + DURACION_WIZARD_ALTA_SELLER_MINUTOS * 60_000;
  const token = firmarPayload({ ...datos, exp });

  const almacenCookies = await cookies();
  almacenCookies.set(COOKIE_WIZARD_ALTA_SELLER, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACION_WIZARD_ALTA_SELLER_MINUTOS * 60,
  });
}

/** Lee el estado vigente del wizard, o `null` si no hay cookie, no calza, o venció. */
export async function leerBorrador(): Promise<EstadoWizardAltaSeller | null> {
  const almacenCookies = await cookies();
  const cookie = almacenCookies.get(COOKIE_WIZARD_ALTA_SELLER);
  if (!cookie?.value) return null;

  const payload = verificarYExtraerPayload(cookie.value);
  if (!payload || payload.exp <= Date.now()) return null;

  const { exp, ...datos } = payload;
  void exp;
  return datos;
}

/** Borra la cookie del wizard — tras terminar con éxito, o al descubrir que ya no aplica. */
export async function limpiarBorrador(): Promise<void> {
  const almacenCookies = await cookies();
  try {
    almacenCookies.delete(COOKIE_WIZARD_ALTA_SELLER);
  } catch {
    // No-op — contexto de solo lectura (Server Component).
  }
}
