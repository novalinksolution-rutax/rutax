/**
 * Commit atómico del alta de seller por autoservicio (RF-010 rediseño) — el
 * paso final del wizard, tras Google + `verificarBarreraAutoRegistroSeller`.
 * =============================================================================
 * TODA la escritura vive en UNA transacción SQL: la RPC
 * `identidad.alta_seller_autoservicio` (migración `20260917000003`). Este
 * módulo solo: (a) valida la entrada (`validarEntrada`, ANTES), (b) arma el
 * payload y llama la RPC, y (c) escribe la bitácora (DESPUÉS, con el
 * `es_primera_membresia` que la RPC devuelve).
 *
 * POR QUÉ UNA RPC Y NO INSERTS SUELTOS DESDE ACÁ
 * -----------------------------------------------------------------------------
 * Antes esto eran 7 `.insert()` de PostgREST —cada uno su propia transacción—
 * con una compensación best-effort que, al fallar, dejaba una fila `sellers`
 * HUÉRFANA: su `(tenant_id, rut)` ocupado pero sin perfil ni membresía. Esa fila
 * es invisible en el backstage (que lista `usuarios_perfil`/`auth.users`, no
 * `sellers`), así que no se podía borrar desde la UI y el re-intento chocaba para
 * siempre con `sellers_tenant_rut_uk` («Esa empresa ya tiene una cuenta con este
 * courier»). La RPC hace todo o nada: si algo falla, rollback completo — cero
 * huérfanos — y además RECLAMA un huérfano preexistente del mismo `(tenant,rut)`
 * si no tiene dueño (un re-intento se auto-cura). Ver la migración para el
 * detalle de reclamo vs. conflicto legítimo.
 *
 * La RPC computa `es_primera_membresia` (crea `usuarios_perfil` si no existe,
 * o reapunta la fila 1:1 a ESTE courier si la identidad ya era seller de otro) y
 * rechaza con `P0001` si el perfil existente no es de tipo seller (defensa en
 * profundidad — `verificarBarreraAutoRegistroSeller` ya debió bloquearlo antes).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteServicio } from "./onboarding";
import { registrarEnBitacora } from "./auditoria";
import { capturarMensaje } from "@/lib/observabilidad";
import { ErrorConflicto, ErrorValidacion } from "./errores";
import { normalizarYValidarRut } from "./rut";
import { normalizarTelefonoE164 } from "@/lib/telefono-cl";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";

/** ESPEJO de `identidad.fuente_declarada` (migración `20260916000001` §0). */
export const FUENTES_DECLARABLES = ["ml_flex", "rutax_manual", "shopify"] as const;
export type FuenteDeclarada = (typeof FUENTES_DECLARABLES)[number];

/**
 * Versión del texto de consentimiento Ley 21.719 que acompaña el alta. El
 * TEXTO lo define `copywriter`; acá solo se versiona para poder re-pedirlo si
 * cambia (mismo criterio que documenta la columna en la migración).
 */
export const VERSION_CONSENTIMIENTO_DATOS_SELLER = "2026-09-alta-seller-v1";

/**
 * La RPC del alta falló por algo que NO es de dominio (ni RUT ocupado ni perfil
 * inválido): un `PGRST202` porque PostgREST todavía no publica la función, una
 * FK, un CHECK. Lleva el `codigo` del motor para que la pantalla pueda mostrarlo
 * y podamos diagnosticar sin acceso a los logs — antes esto se perdía y el alta
 * era indepurable desde fuera.
 */
export class ErrorAltaSellerInfraestructura extends Error {
  constructor(readonly codigo: string) {
    super(`El alta de seller falló en la RPC (código ${codigo}).`);
    this.name = "ErrorAltaSellerInfraestructura";
  }
}

export interface DatosBodegaResuelta {
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso?: string | null;
  contactoNombre?: string | null;
  contactoTelefono?: string | null;
  /** Ya resuelto por la Server Action (síncrono, con `resolverCoordenadaConCache`). */
  lat: number | null;
  long: number | null;
  geoEstado: "resuelto" | "no_resuelto" | "fuera_cobertura" | "pendiente";
  geoConfianza: number | null;
  geocodificadoEn: string | null;
}

export interface DatosAltaSellerAutoservicio {
  authUserId: string;
  /** Correo de la identidad Google/Auth — se guarda como `sellers.email_contacto`. */
  email: string;
  tenantId: string;
  empresa: {
    razonSocial: string;
    rut: string;
    /** El consentimiento Ley 21.719 que la persona marcó en el wizard. */
    aceptaConsentimientoDatos: boolean;
    /** ISO de cuándo lo marcó (lo sella el commit tal cual). */
    consentimientoDatosEn: string;
  };
  contacto: { nombreContacto: string; telefono?: string | null };
  bodega: DatosBodegaResuelta;
  whatsapp: { telefono: string; acepta: boolean };
  fuentes: FuenteDeclarada[];
}

export interface ResultadoAltaSellerAutoservicio {
  sellerId: string;
  tenantId: string;
  esPrimeraMembresia: boolean;
}

interface EntradaValidada {
  rutNormalizado: string;
  telefonoContacto: string | null;
  whatsappE164: string;
}

function validarEntrada(input: DatosAltaSellerAutoservicio): EntradaValidada {
  if (!input.empresa.razonSocial.trim()) {
    throw new ErrorValidacion("La razón social de tu empresa es obligatoria.");
  }
  const rutNormalizado = normalizarYValidarRut(input.empresa.rut);
  if (!rutNormalizado) {
    throw new ErrorValidacion("El RUT de tu empresa no es válido (verifica el dígito verificador).");
  }
  // El consentimiento Ley 21.719 se RE-EXIGE aquí, no se asume del gate del
  // wizard: el commit es el que estampa la marca, así que es el que debe negarse
  // a certificar un consentimiento que no llegó. Sin esto, un refactor futuro que
  // dejara entrar `empresa` sin pasar por el gate sellaría un consentimiento falso.
  if (input.empresa.aceptaConsentimientoDatos !== true || !input.empresa.consentimientoDatosEn?.trim()) {
    throw new ErrorValidacion("Necesitamos tu consentimiento para el tratamiento de datos para continuar.");
  }
  if (!input.contacto.nombreContacto.trim()) {
    throw new ErrorValidacion("Tu nombre de contacto es obligatorio.");
  }

  let telefonoContacto: string | null = null;
  if (input.contacto.telefono && input.contacto.telefono.trim()) {
    const normalizado = normalizarTelefonoE164(input.contacto.telefono);
    if (!normalizado.valido) {
      throw new ErrorValidacion("El teléfono de contacto no tiene un formato válido.");
    }
    telefonoContacto = normalizado.telefonoE164;
  }

  if (!input.bodega.nombre.trim()) throw new ErrorValidacion("Ponle un nombre a tu bodega.");
  if (!input.bodega.direccion.trim()) throw new ErrorValidacion("Falta la dirección de tu bodega.");
  if (!input.bodega.comuna.trim() || !(COMUNAS_RM as readonly string[]).includes(input.bodega.comuna)) {
    throw new ErrorValidacion("Elige una comuna válida de la Región Metropolitana para tu bodega.");
  }

  if (!input.whatsapp || input.whatsapp.acepta !== true) {
    throw new ErrorValidacion("Necesitamos un WhatsApp de retiro y tu autorización para avisarte.");
  }
  const whatsappNormalizado = normalizarTelefonoE164(input.whatsapp.telefono);
  if (!whatsappNormalizado.valido) {
    throw new ErrorValidacion("El teléfono de WhatsApp no tiene un formato válido.");
  }

  if (!input.fuentes?.length) {
    throw new ErrorValidacion("Declara al menos una fuente de pedidos para continuar.");
  }
  const invalidas = input.fuentes.filter((f) => !(FUENTES_DECLARABLES as readonly string[]).includes(f));
  if (invalidas.length) {
    throw new ErrorValidacion(`Fuente declarada inválida: ${invalidas.join(", ")}.`);
  }

  return { rutNormalizado, telefonoContacto, whatsappE164: whatsappNormalizado.telefonoE164 };
}

/**
 * Enmascara un RUT normalizado (`NNNNNNNN-DV`) para la bitácora: conserva solo
 * los últimos 4 dígitos y el DV. Mismo criterio que el alta de conductor
 * (`operacion/conductores.ts`, Ley 21.431): en Chile el RUT de una empresa
 * seller es a menudo el de una persona natural (empresa individual), así que no
 * viaja en claro al asiento de auditoría, que el super-admin ve cross-tenant.
 * `"12345678-5"` → `"****5678-5"`.
 */
function enmascararRutBitacora(rutNormalizado: string): string {
  const [cuerpo, dv] = rutNormalizado.split("-");
  return `****${cuerpo.slice(-4)}-${dv}`;
}

function esErrorDeRutDuplicadoEnTenant(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "23505" || (error.message ?? "").toLowerCase().includes("sellers_tenant_rut_uk");
}

/**
 * Commit del alta de seller por autoservicio. La escritura entera la hace la RPC
 * atómica `identidad.alta_seller_autoservicio`; acá solo se valida (antes), se
 * arma el payload y se audita (después). Se asume que el llamador YA pasó
 * `verificarBarreraAutoRegistroSeller` — ver cabecera.
 */
export async function commitAltaSellerAutoservicio(
  cliente: ClienteServicio,
  input: DatosAltaSellerAutoservicio,
): Promise<ResultadoAltaSellerAutoservicio> {
  const { rutNormalizado, telefonoContacto, whatsappE164 } = validarEntrada(input);

  const payload = {
    auth_user_id: input.authUserId,
    tenant_id: input.tenantId,
    rut: rutNormalizado,
    razon_social: input.empresa.razonSocial.trim(),
    nombre_contacto: input.contacto.nombreContacto.trim(),
    email: input.email,
    telefono_contacto: telefonoContacto,
    // La marca temporal es CUÁNDO consintió (se selló en el wizard), no el
    // momento del commit — así el asiento de consentimiento no miente la hora.
    consentimiento_datos_en: input.empresa.consentimientoDatosEn,
    consentimiento_version: VERSION_CONSENTIMIENTO_DATOS_SELLER,
    whatsapp_e164: whatsappE164,
    bodega: {
      nombre: input.bodega.nombre.trim(),
      direccion: input.bodega.direccion.trim(),
      comuna: input.bodega.comuna,
      instrucciones_acceso: input.bodega.instruccionesAcceso?.trim() || null,
      contacto_nombre: input.bodega.contactoNombre?.trim() || null,
      contacto_telefono: input.bodega.contactoTelefono?.trim() || null,
      lat: input.bodega.lat,
      long: input.bodega.long,
      geo_estado: input.bodega.geoEstado,
      geo_confianza: input.bodega.geoConfianza,
      geocodificado_en: input.bodega.geocodificadoEn,
    },
    fuentes: input.fuentes,
  };

  const { data, error } = await cliente
    .schema("identidad")
    .rpc("alta_seller_autoservicio", { p_payload: payload });

  if (error) {
    if (esErrorDeRutDuplicadoEnTenant(error)) {
      throw new ErrorConflicto("Esa empresa ya tiene una cuenta con este courier.");
    }
    if (error.code === "P0001") {
      throw new ErrorValidacion("Esta cuenta no puede registrarse como seller.");
    }
    // Cualquier otro error (incluida la RPC fuera del caché de PostgREST,
    // PGRST202) se PROPAGA duro: el Server Action lo muestra como «intenta de
    // nuevo», nunca como un alta a medias. La RPC ya hizo rollback completo.
    //
    // ⚠️ Y se REGISTRA con su código. Tragarse este error fue lo que dejó el
    // alta indepurable: la pantalla decía «problema de nuestro sistema» y en el
    // servidor no quedaba rastro de la causa. Sin PII: solo código y el mensaje
    // del motor (nunca el payload, que lleva RUT, dirección y teléfono).
    await capturarMensaje("El alta de seller por autoservicio falló en la RPC atómica", "error", {
      origen: "identidad:alta-seller-autoservicio",
      extra: { codigo: error.code ?? null, motivo: error.message, detalle: error.details ?? null },
    });
    throw new ErrorAltaSellerInfraestructura(error.code ?? "desconocido");
  }

  const salida = (data ?? {}) as { seller_id?: string; es_primera_membresia?: boolean };
  if (!salida.seller_id) {
    throw new Error("El alta no devolvió un seller válido.");
  }
  const sellerId = salida.seller_id;
  const esPrimeraMembresia = salida.es_primera_membresia === true;

  // Bitácora — después del commit atómico (sin evento Inngest ni integración
  // externa que preceder, mismo criterio que `tenant.alta`).
  await registrarEnBitacora(cliente as unknown as SupabaseClient, {
    tenantId: input.tenantId,
    actorUsuarioId: input.authUserId,
    actorTipo: "usuario",
    accion: "seller.alta_autoservicio",
    entidadTipo: "seller",
    entidadId: sellerId,
    detalle: {
      razon_social: input.empresa.razonSocial.trim(),
      // RUT enmascarado: puede ser el de una persona natural (empresa individual).
      rut_mascara: enmascararRutBitacora(rutNormalizado),
      fuentes: input.fuentes,
      primera_membresia: esPrimeraMembresia,
    },
  });

  return { sellerId, tenantId: input.tenantId, esPrimeraMembresia };
}
