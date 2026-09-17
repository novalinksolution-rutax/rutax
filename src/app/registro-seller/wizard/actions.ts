"use server";

/**
 * Server Actions — wizard de alta de seller por autoservicio (RF-010
 * rediseño).
 * =============================================================================
 * El visitante YA se autenticó con Google (`/auth/callback` detectó el
 * intent `registro-seller`, pasó `verificarBarreraAutoRegistroSeller` y lo
 * mandó aquí). Su progreso vive en una cookie firmada
 * (`borrador-wizard-seller.ts`); NADA se escribe en la base hasta
 * `finalizarAltaSellerAction`, que delega en `commitAltaSellerAutoservicio`.
 *
 * El `tenantId` del wizard viene DEL ENLACE (lo fijó `/auth/callback` al
 * arrancar el wizard) y es inmutable durante todos los pasos — nunca se lee
 * del claim de sesión del usuario, que puede apuntar a OTRO courier si esta
 * identidad ya es seller de otro (multi-courier).
 *
 * El geocoding de la bodega es SÍNCRONO, en esta Server Action (CLAUDE.md:
 * "el geocoding de bodegas es síncrono en la Server Action, sin job" — hay un
 * humano esperando), vía `resolverCoordenadaConCache`.
 */

import { revalidatePath } from "next/cache";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  guardarBorrador as guardarBorradorWizard,
  leerBorrador as leerBorradorWizard,
  limpiarBorrador as limpiarBorradorWizard,
  type EstadoWizardAltaSeller,
  type FuenteWizardSeller,
} from "@/lib/identidad/borrador-wizard-seller";
import { normalizarYValidarRut } from "@/modules/identidad/rut";
import { normalizarTelefonoE164 } from "@/lib/telefono-cl";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { resolverCoordenadaConCache, TIMEOUT_GEOCODING_SINCRONO_MS } from "@/modules/integraciones/geocoding";
import {
  mensajeBarreraAutoRegistroSeller,
  verificarBarreraAutoRegistroSeller,
} from "@/modules/identidad/barrera-auto-registro-seller";
import {
  commitAltaSellerAutoservicio,
  FUENTES_DECLARABLES,
  type DatosAltaSellerAutoservicio,
} from "@/modules/identidad/alta-seller-autoservicio";
import {
  obtenerPuertoAutocompletado,
  type SugerenciaDireccion,
} from "@/modules/integraciones/geocoding/autocompletado";
import { ErrorConflicto, ErrorValidacion } from "@/modules/identidad/errores";

type Resultado<T> = { ok: true; datos: T } | { ok: false; mensaje: string };

async function exigirWizardVigente(): Promise<
  | { ok: true; authUserId: string; email: string; estado: EstadoWizardAltaSeller }
  | { ok: false; mensaje: string }
> {
  const sesion = await obtenerSesionActual();
  if (!sesion) {
    return { ok: false, mensaje: "Tu sesión venció. Vuelve a abrir el enlace de tu courier." };
  }
  const estado = await leerBorradorWizard();
  if (!estado) {
    return { ok: false, mensaje: "Tu sesión de registro venció. Vuelve a abrir el enlace de tu courier." };
  }
  return { ok: true, authUserId: sesion.usuarioId, email: sesion.email ?? "", estado };
}

/** Estado actual del wizard — para que la pantalla se reconstruya si el visitante recarga. */
export async function obtenerEstadoWizardSellerAction(): Promise<Resultado<EstadoWizardAltaSeller>> {
  const g = await exigirWizardVigente();
  if (!g.ok) return g;
  return { ok: true, datos: g.estado };
}

// -----------------------------------------------------------------------------
// Autocompletado de dirección de la bodega
// -----------------------------------------------------------------------------
// Mismo puerto que el alta same-day (`obtenerPuertoAutocompletado`), pero gateado
// por la sesión del WIZARD, no por `puedeUsarBusquedaDeDirecciones`: el seller
// aún no tiene perfil ni capacidad (se crean en el commit final), así que el gate
// interno no aplica — basta con que tenga un wizard vigente.
export type ResultadoSugerenciasSeller =
  | { ok: true; sugerencias: SugerenciaDireccion[] }
  | { ok: false; motivo: "sin_permiso" | "proveedor" };

export async function sugerirDireccionSellerAction(
  consulta: string,
  sesion: string,
): Promise<ResultadoSugerenciasSeller> {
  const g = await exigirWizardVigente();
  if (!g.ok) return { ok: false, motivo: "sin_permiso" };
  try {
    return { ok: true, sugerencias: await obtenerPuertoAutocompletado().sugerir({ consulta, sesion }) };
  } catch (error) {
    // El proveedor no puede bloquear el alta: el campo acepta texto libre y el
    // geocoding al guardar sigue corriendo. Se registra sin la consulta (es una
    // dirección) ni nada que pueda traer la clave.
    console.error(
      "[registro-seller/wizard] el proveedor de autocompletado falló:",
      error instanceof Error ? error.message : "error desconocido",
    );
    return { ok: false, motivo: "proveedor" };
  }
}

export async function resolverDireccionSellerAction(id: string, sesion: string) {
  const g = await exigirWizardVigente();
  if (!g.ok) return null;
  try {
    return await obtenerPuertoAutocompletado().resolver({ id, sesion });
  } catch (error) {
    console.error(
      "[registro-seller/wizard] el proveedor no pudo resolver la dirección elegida:",
      error instanceof Error ? error.message : "error desconocido",
    );
    return null;
  }
}

// -----------------------------------------------------------------------------
// Paso 1 — empresa
// -----------------------------------------------------------------------------
export interface EntradaPasoEmpresa {
  razonSocial: string;
  rut: string;
  aceptaConsentimientoDatos: boolean;
}

export async function guardarPasoEmpresaAction(entrada: EntradaPasoEmpresa): Promise<Resultado<null>> {
  const g = await exigirWizardVigente();
  if (!g.ok) return g;

  const razonSocial = entrada.razonSocial?.trim() ?? "";
  if (!razonSocial) return { ok: false, mensaje: "La razón social de tu empresa es obligatoria." };

  const rutNormalizado = normalizarYValidarRut(entrada.rut ?? "");
  if (!rutNormalizado) {
    return { ok: false, mensaje: "El RUT de tu empresa no es válido (verifica el dígito verificador)." };
  }
  if (entrada.aceptaConsentimientoDatos !== true) {
    return { ok: false, mensaje: "Debes aceptar el tratamiento de tus datos para continuar." };
  }

  await guardarBorradorWizard({
    ...g.estado,
    empresa: {
      razonSocial,
      rut: rutNormalizado,
      aceptaConsentimientoDatos: true,
      // Se sella AHORA, en el momento en que la persona marcó la casilla —
      // no en el commit final, que puede ocurrir varios pasos después.
      consentimientoDatosEn: new Date().toISOString(),
    },
  });
  return { ok: true, datos: null };
}

// -----------------------------------------------------------------------------
// Paso 2 — contacto
// -----------------------------------------------------------------------------
export interface EntradaPasoContacto {
  nombreContacto: string;
  telefono?: string;
}

export async function guardarPasoContactoAction(entrada: EntradaPasoContacto): Promise<Resultado<null>> {
  const g = await exigirWizardVigente();
  if (!g.ok) return g;

  const nombreContacto = entrada.nombreContacto?.trim() ?? "";
  if (!nombreContacto) return { ok: false, mensaje: "Tu nombre de contacto es obligatorio." };

  let telefono: string | undefined;
  if (entrada.telefono?.trim()) {
    const normalizado = normalizarTelefonoE164(entrada.telefono);
    if (!normalizado.valido) return { ok: false, mensaje: "Ese teléfono no tiene un formato válido." };
    telefono = normalizado.telefonoE164;
  }

  await guardarBorradorWizard({ ...g.estado, contacto: { nombreContacto, telefono } });
  return { ok: true, datos: null };
}

// -----------------------------------------------------------------------------
// Paso 3 — bodega (geocoding SÍNCRONO, humano esperando)
// -----------------------------------------------------------------------------
export interface EntradaPasoBodega {
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso?: string;
  contactoNombre?: string;
  contactoTelefono?: string;
  /** Coordenada ya elegida por el buscador de direcciones, si el formulario la trae. */
  lat?: number;
  long?: number;
}

export interface ResultadoPasoBodega {
  /** `false` = se guardó igual, pero sin coordenada; el courier la puede corregir más adelante. */
  geoResuelta: boolean;
}

function coordenadaValida(lat: unknown, long: unknown): { lat: number; long: number } | null {
  if (typeof lat !== "number" || typeof long !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(long)) return null;
  if (lat < -90 || lat > 90 || long < -180 || long > 180) return null;
  return { lat, long };
}

export async function guardarPasoBodegaAction(entrada: EntradaPasoBodega): Promise<Resultado<ResultadoPasoBodega>> {
  const g = await exigirWizardVigente();
  if (!g.ok) return g;

  const nombre = entrada.nombre?.trim() ?? "";
  const direccion = entrada.direccion?.trim() ?? "";
  const comuna = entrada.comuna?.trim() ?? "";
  if (!nombre) return { ok: false, mensaje: "Ponle un nombre a tu bodega." };
  if (!direccion) return { ok: false, mensaje: "Falta la dirección de tu bodega." };
  if (!comuna || !(COMUNAS_RM as readonly string[]).includes(comuna)) {
    return { ok: false, mensaje: "Elige una comuna de la Región Metropolitana." };
  }

  let lat: number | undefined;
  let long: number | undefined;
  let geoEstado: "resuelto" | "no_resuelto" | "fuera_cobertura" = "no_resuelto";
  let geoConfianza: number | undefined;
  let geocodificadoEn: string | undefined;

  const coordenadaDirecta = coordenadaValida(entrada.lat, entrada.long);
  if (coordenadaDirecta) {
    lat = coordenadaDirecta.lat;
    long = coordenadaDirecta.long;
    geoEstado = "resuelto";
    // Confianza máxima: es el punto que el buscador ya mostró y la persona confirmó.
    geoConfianza = 1;
    geocodificadoEn = new Date().toISOString();
  } else {
    try {
      const r = await resolverCoordenadaConCache({ direccion, comuna, timeoutMs: TIMEOUT_GEOCODING_SINCRONO_MS });
      if (r?.lat != null && r?.long != null) {
        lat = r.lat;
        long = r.long;
        geoEstado = r.estado === "fuera_cobertura" ? "fuera_cobertura" : "resuelto";
        geoConfianza = r.confianza ?? undefined;
        geocodificadoEn = new Date().toISOString();
      } else if (r?.estado === "fuera_cobertura") {
        geoEstado = "fuera_cobertura";
      }
    } catch {
      // Se guarda igual sin coordenada — una bodega sin geocodificar sigue
      // siendo útil; el courier la corrige más adelante.
    }
  }

  await guardarBorradorWizard({
    ...g.estado,
    bodega: {
      nombre,
      direccion,
      comuna,
      instruccionesAcceso: entrada.instruccionesAcceso?.trim() || undefined,
      contactoNombre: entrada.contactoNombre?.trim() || undefined,
      contactoTelefono: entrada.contactoTelefono?.trim() || undefined,
      lat,
      long,
      geoEstado,
      geoConfianza,
      geocodificadoEn,
    },
  });

  return { ok: true, datos: { geoResuelta: geoEstado === "resuelto" } };
}

// -----------------------------------------------------------------------------
// Paso 4 — WhatsApp de retiro + consentimiento
// -----------------------------------------------------------------------------
export interface EntradaPasoWhatsapp {
  telefono: string;
  acepta: boolean;
}

export async function guardarPasoWhatsappAction(entrada: EntradaPasoWhatsapp): Promise<Resultado<null>> {
  const g = await exigirWizardVigente();
  if (!g.ok) return g;

  if (entrada.acepta !== true) {
    return { ok: false, mensaje: "Necesitamos tu autorización para avisarte por WhatsApp." };
  }
  const normalizado = normalizarTelefonoE164(entrada.telefono);
  if (!normalizado.valido) {
    return { ok: false, mensaje: "Ese WhatsApp no tiene un formato válido." };
  }

  await guardarBorradorWizard({ ...g.estado, whatsapp: { telefono: normalizado.telefonoE164, acepta: true } });
  return { ok: true, datos: null };
}

// -----------------------------------------------------------------------------
// Paso 5 — fuentes declaradas
// -----------------------------------------------------------------------------
export interface EntradaPasoFuentes {
  fuentes: FuenteWizardSeller[];
}

export async function guardarPasoFuentesAction(entrada: EntradaPasoFuentes): Promise<Resultado<null>> {
  const g = await exigirWizardVigente();
  if (!g.ok) return g;

  const fuentes = Array.from(new Set(entrada.fuentes ?? []));
  if (!fuentes.length) return { ok: false, mensaje: "Declara al menos una fuente de pedidos." };
  const invalidas = fuentes.filter((f) => !(FUENTES_DECLARABLES as readonly string[]).includes(f));
  if (invalidas.length) return { ok: false, mensaje: "Una de las fuentes elegidas no es válida." };

  await guardarBorradorWizard({ ...g.estado, fuentes });
  return { ok: true, datos: null };
}

// -----------------------------------------------------------------------------
// Finalizar — commit atómico
// -----------------------------------------------------------------------------
export interface AltaSellerFinalizada {
  tenantId: string;
  primeraMembresia: boolean;
}

export type ResultadoFinalizarAltaSeller =
  | { ok: true; datos: AltaSellerFinalizada }
  | { ok: false; tipo: "incompleto" | "permiso" | "conflicto" | "desconocido"; mensaje: string };

export async function finalizarAltaSellerAction(): Promise<ResultadoFinalizarAltaSeller> {
  const sesion = await obtenerSesionActual();
  if (!sesion) {
    return { ok: false, tipo: "permiso", mensaje: "Tu sesión venció. Vuelve a abrir el enlace de tu courier." };
  }
  const estado = await leerBorradorWizard();
  if (!estado) {
    return {
      ok: false,
      tipo: "incompleto",
      mensaje: "Tu sesión de registro venció. Vuelve a abrir el enlace de tu courier.",
    };
  }
  if (!estado.empresa || !estado.contacto || !estado.bodega || !estado.whatsapp || !estado.fuentes?.length) {
    return { ok: false, tipo: "incompleto", mensaje: "Completa todos los pasos antes de terminar." };
  }

  const admin = crearClienteServiceRole();

  // Re-chequeo defensivo: pudo pasar tiempo entre que arrancó el wizard y
  // ahora (p. ej. otra pestaña ya lo registró en este mismo courier).
  const barrera = await verificarBarreraAutoRegistroSeller(admin, sesion.usuarioId, estado.tenantId);
  if (!barrera.ok) {
    return { ok: false, tipo: "permiso", mensaje: mensajeBarreraAutoRegistroSeller(barrera) };
  }

  const input: DatosAltaSellerAutoservicio = {
    authUserId: sesion.usuarioId,
    email: sesion.email ?? "",
    tenantId: estado.tenantId,
    empresa: {
      razonSocial: estado.empresa.razonSocial,
      rut: estado.empresa.rut,
      aceptaConsentimientoDatos: estado.empresa.aceptaConsentimientoDatos,
      consentimientoDatosEn: estado.empresa.consentimientoDatosEn,
    },
    contacto: { nombreContacto: estado.contacto.nombreContacto, telefono: estado.contacto.telefono ?? null },
    bodega: {
      nombre: estado.bodega.nombre,
      direccion: estado.bodega.direccion,
      comuna: estado.bodega.comuna,
      instruccionesAcceso: estado.bodega.instruccionesAcceso ?? null,
      contactoNombre: estado.bodega.contactoNombre ?? null,
      contactoTelefono: estado.bodega.contactoTelefono ?? null,
      lat: estado.bodega.lat ?? null,
      long: estado.bodega.long ?? null,
      geoEstado: estado.bodega.geoEstado ?? "no_resuelto",
      geoConfianza: estado.bodega.geoConfianza ?? null,
      geocodificadoEn: estado.bodega.geocodificadoEn ?? null,
    },
    whatsapp: { telefono: estado.whatsapp.telefono, acepta: estado.whatsapp.acepta },
    fuentes: estado.fuentes,
  };

  try {
    const resultado = await commitAltaSellerAutoservicio(admin, input);
    await limpiarBorradorWizard();

    // Refrescar el JWT: recién se creó/reapuntó usuarios_perfil.
    const supabase = await createClient();
    await supabase.auth.refreshSession();

    revalidatePath("/portal");

    return { ok: true, datos: { tenantId: resultado.tenantId, primeraMembresia: resultado.esPrimeraMembresia } };
  } catch (err) {
    if (err instanceof ErrorConflicto) return { ok: false, tipo: "conflicto", mensaje: err.message };
    if (err instanceof ErrorValidacion) return { ok: false, tipo: "incompleto", mensaje: err.message };
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos completar tu registro por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }
}
