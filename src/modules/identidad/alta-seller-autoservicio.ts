/**
 * Commit atómico del alta de seller por autoservicio (RF-010 rediseño) — el
 * paso final del wizard, tras Google + `verificarBarreraAutoRegistroSeller`.
 * =============================================================================
 * Orden de escritura (documentado en el handoff §8 de la migración
 * `20260916000001`), con compensación best-effort si un paso falla a medio
 * camino (no hay transacción cross-tabla entre `service_role` y varias
 * llamadas PostgREST — mismo criterio que `provisionarTenantParaAuthUser`):
 *
 *   1. `identidad.seller_identidades` — upsert por `auth_user_id` (empresa
 *      COMPARTIDA entre couriers).
 *   2. `identidad.sellers` — la fila de ESTE courier, `estado='activo'` (nace
 *      sin aprobación).
 *   3. `identidad.seller_bodegas` — la bodega del wizard. Geocoding YA
 *      resuelto por el LLAMADOR (Server Action): CLAUDE.md exige que el
 *      geocoding de bodegas sea síncrono en la Server Action, no aquí.
 *   4. `integraciones.whatsapp_contactos` — origen `perfil_seller`.
 *   5. `identidad.seller_fuentes_declaradas` — `rutax_manual` nace
 *      `conectada`; el resto, `pendiente`.
 *   6. `identidad.seller_membresias` — el vínculo identidad↔courier, nace
 *      `activa`.
 *   7. `usuarios_perfil` — 1:1. Primera membresía: se CREA. Si la identidad ya
 *      era seller de otro courier: se REAPUNTA la fila activa a ESTE courier
 *      (acaba de unirse, debe aterrizar acá — mismo criterio que el switcher
 *      de `seller-membresias.ts`).
 *   8. Bitácora — al final: no hay evento Inngest ni integración externa que
 *      preceder en este commit (a diferencia de `dinero/acciones.ts`), así
 *      que no aplica "bitácora antes del efecto externo"; se audita cuando
 *      todo quedó consistente, mismo criterio que `tenant.alta`.
 *
 * El LLAMADOR debe haber pasado `verificarBarreraAutoRegistroSeller` antes de
 * invocar esto — esta función repite el chequeo mínimo (perfil existente y no
 * es seller) como defensa en profundidad, pero no vuelve a consultar
 * `seller_membresias` (el `insert` de más abajo ya lo hace de facto: 23505 si
 * la barrera se saltó una carrera).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteServicio } from "./onboarding";
import { buscarPerfilPorAuthUserId } from "./onboarding";
import { registrarEnBitacora } from "./auditoria";
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
 * Best-effort: deshace lo insertado si un paso posterior falla. Nunca lanza —
 * si la compensación falla, queda una fila huérfana que requiere limpieza
 * manual, pero preferimos eso a enmascarar el error original.
 *
 * Orden: `seller_bodegas` tiene FK `on delete restrict` hacia `sellers` — hay
 * que borrarla ANTES de poder borrar la fila de `sellers`. Las demás
 * (`seller_membresias`, `seller_fuentes_declaradas`, `whatsapp_contactos`)
 * cascadean solas al borrar `sellers`, pero se borran explícitas igual, por
 * claridad y para no depender de que el `on delete cascade` siga vigente.
 */
async function deshacerAltaSeller(cliente: ClienteServicio, sellerId: string): Promise<void> {
  try {
    await cliente.schema("identidad").from("seller_membresias").delete().eq("seller_id", sellerId);
  } catch {
    /* best-effort */
  }
  try {
    await cliente.schema("identidad").from("seller_fuentes_declaradas").delete().eq("seller_id", sellerId);
  } catch {
    /* best-effort */
  }
  try {
    await cliente.schema("integraciones").from("whatsapp_contactos").delete().eq("seller_id", sellerId);
  } catch {
    /* best-effort */
  }
  try {
    await cliente.schema("identidad").from("seller_bodegas").delete().eq("seller_id", sellerId);
  } catch {
    /* best-effort */
  }
  try {
    await cliente.from("sellers").delete().eq("id", sellerId);
  } catch {
    /* best-effort */
  }
}

/**
 * Commit atómico del alta de seller por autoservicio. Se asume que el
 * llamador YA pasó `verificarBarreraAutoRegistroSeller` — ver cabecera.
 */
export async function commitAltaSellerAutoservicio(
  cliente: ClienteServicio,
  input: DatosAltaSellerAutoservicio,
): Promise<ResultadoAltaSellerAutoservicio> {
  const { rutNormalizado, telefonoContacto, whatsappE164 } = validarEntrada(input);

  // ¿Es su primera membresía? Se resuelve ANTES de escribir nada: decide si
  // el paso 7 crea `usuarios_perfil` o solo reapunta la fila activa existente.
  const perfilExistente = await buscarPerfilPorAuthUserId(cliente, input.authUserId);
  if (perfilExistente && perfilExistente.tipoUsuario !== "seller") {
    // Defensa en profundidad — `verificarBarreraAutoRegistroSeller` ya debió
    // bloquear esto antes de llegar aquí.
    throw new ErrorValidacion("Esta cuenta no puede registrarse como seller.");
  }
  const esPrimeraMembresia = perfilExistente === null;

  const ahora = new Date().toISOString();

  // 1) seller_identidades — upsert por auth_user_id (empresa COMPARTIDA).
  const { error: errorIdentidad } = await cliente
    .schema("identidad")
    .from("seller_identidades")
    .upsert(
      {
        auth_user_id: input.authUserId,
        razon_social: input.empresa.razonSocial.trim(),
        rut: rutNormalizado,
        nombre_contacto: input.contacto.nombreContacto.trim(),
        telefono: telefonoContacto,
        // La marca temporal es CUÁNDO consintió (se selló en el wizard), no el
        // momento del commit — así el asiento de consentimiento no miente la hora.
        consentimiento_datos_en: input.empresa.consentimientoDatosEn,
        consentimiento_version: VERSION_CONSENTIMIENTO_DATOS_SELLER,
      },
      { onConflict: "auth_user_id" },
    );

  if (errorIdentidad) {
    throw new Error(`No se pudo guardar los datos de tu empresa: ${errorIdentidad.message}`);
  }

  // 2) identidad.sellers — la fila de ESTE courier. estado='activo': nace
  //    sin aprobación (decisión de producto de este alcance).
  const { data: sellerCreado, error: errorSeller } = await cliente
    .from("sellers")
    .insert({
      tenant_id: input.tenantId,
      razon_social: input.empresa.razonSocial.trim(),
      rut: rutNormalizado,
      nombre_contacto: input.contacto.nombreContacto.trim(),
      email_contacto: input.email.trim().toLowerCase(),
      estado: "activo",
    })
    .select("id")
    .single();

  if (errorSeller || !sellerCreado) {
    if (esErrorDeRutDuplicadoEnTenant(errorSeller)) {
      throw new ErrorConflicto("Esa empresa ya tiene una cuenta con este courier.");
    }
    throw new Error(`No se pudo registrar tu empresa en este courier: ${errorSeller?.message ?? "desconocido"}`);
  }

  const sellerId = sellerCreado.id as string;

  // 3) seller_bodegas — geocoding YA resuelto por el llamador.
  const { error: errorBodega } = await cliente
    .schema("identidad")
    .from("seller_bodegas")
    .insert({
      tenant_id: input.tenantId,
      seller_id: sellerId,
      nombre: input.bodega.nombre.trim(),
      direccion: input.bodega.direccion.trim(),
      comuna: input.bodega.comuna,
      instrucciones_acceso: input.bodega.instruccionesAcceso?.trim() || null,
      contacto_nombre: input.bodega.contactoNombre?.trim() || null,
      contacto_telefono: input.bodega.contactoTelefono?.trim() || null,
      // Primera y única bodega de ESTE seller (fila nueva de `sellers`, no
      // comparte `seller_id` con otro courier): nace principal sin ambigüedad.
      es_principal: true,
      activa: true,
      lat: input.bodega.lat,
      long: input.bodega.long,
      geo_estado: input.bodega.geoEstado,
      geo_confianza: input.bodega.geoConfianza,
      geocodificado_en: input.bodega.geocodificadoEn,
    });

  if (errorBodega) {
    await deshacerAltaSeller(cliente, sellerId);
    throw new Error(`No se pudo registrar tu bodega: ${errorBodega.message}`);
  }

  // 4) whatsapp_contactos — origen 'perfil_seller'. `whatsappE164`/`acepta` ya
  //    están validados (`validarEntrada` exige el opt-in explícito).
  const { error: errorWhatsapp } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .insert({
      tenant_id: input.tenantId,
      seller_id: sellerId,
      telefono_e164: whatsappE164,
      origen: "perfil_seller",
      opt_in_estado: "otorgado",
      opt_in_en: ahora,
    });

  if (errorWhatsapp) {
    await deshacerAltaSeller(cliente, sellerId);
    throw new Error(`No se pudo registrar tu WhatsApp de retiro: ${errorWhatsapp.message}`);
  }

  // 5) seller_fuentes_declaradas — rutax_manual nace 'conectada'; el resto, 'pendiente'.
  const { error: errorFuentes } = await cliente
    .schema("identidad")
    .from("seller_fuentes_declaradas")
    .insert(
      input.fuentes.map((fuente) => ({
        tenant_id: input.tenantId,
        seller_id: sellerId,
        fuente,
        estado: fuente === "rutax_manual" ? "conectada" : "pendiente",
      })),
    );

  if (errorFuentes) {
    await deshacerAltaSeller(cliente, sellerId);
    throw new Error(`No se pudieron guardar tus fuentes de pedidos: ${errorFuentes.message}`);
  }

  // 6) seller_membresias — el vínculo identidad↔courier, nace 'activa'.
  const { error: errorMembresia } = await cliente
    .schema("identidad")
    .from("seller_membresias")
    .insert({
      auth_user_id: input.authUserId,
      tenant_id: input.tenantId,
      seller_id: sellerId,
      estado: "activa",
    });

  if (errorMembresia) {
    await deshacerAltaSeller(cliente, sellerId);
    if (errorMembresia.code === "23505") {
      throw new ErrorConflicto("Ya tienes una cuenta de seller con este courier.");
    }
    throw new Error(`No se pudo activar tu membresía: ${errorMembresia.message}`);
  }

  // 7) usuarios_perfil — 1:1. Primera membresía: se crea. Si ya existía (era
  //    seller de otro courier), se reapunta la fila activa a ESTE courier —
  //    el seller acaba de unirse y debe aterrizar acá (mismo criterio que
  //    `cambiarCourierActivo` en `seller-membresias.ts`).
  if (esPrimeraMembresia) {
    const { error: errorPerfil } = await cliente.from("usuarios_perfil").insert({
      id: input.authUserId,
      tenant_id: input.tenantId,
      nombre_completo: input.contacto.nombreContacto.trim(),
      tipo_usuario: "seller",
      seller_id: sellerId,
      rol: "seller",
      estado: "activo",
    });
    if (errorPerfil) {
      await deshacerAltaSeller(cliente, sellerId);
      throw new Error(`No se pudo crear tu perfil de acceso: ${errorPerfil.message}`);
    }
  } else {
    const { error: errorPerfil } = await cliente
      .from("usuarios_perfil")
      .update({ tenant_id: input.tenantId, seller_id: sellerId })
      .eq("id", input.authUserId);
    if (errorPerfil) {
      await deshacerAltaSeller(cliente, sellerId);
      throw new Error(`No se pudo cambiar tu courier activo: ${errorPerfil.message}`);
    }
  }

  // 8) Bitácora — después de escribir todo (ver cabecera: sin evento Inngest
  //    ni integración externa que preceder en este commit).
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
