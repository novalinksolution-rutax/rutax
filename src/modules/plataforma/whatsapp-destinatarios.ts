/**
 * Backstage — los destinatarios de WhatsApp de TODOS los couriers.
 * =============================================================================
 * Rutax administra WhatsApp; el courier no. Este módulo es la lectura y la
 * escritura cross-tenant que hace posible esa decisión (2026-08-25).
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ VIVE EN `plataforma` Y NO EN `integraciones`
 * -----------------------------------------------------------------------------
 * `integraciones/notificaciones/whatsapp` es el adaptador: sabe hablar con Meta
 * y no sabe nada de couriers. Esto es otra cosa — es el backstage de Rutax
 * mirando por encima de todos los tenants a la vez, que es la razón de ser del
 * módulo `plataforma`. Ponerlo en el adaptador metería lógica de super-admin
 * dentro de una pieza que se supone reutilizable y ciega al tenant.
 *
 * ⚠️ **TODA función de acá cruza tenants a propósito.** Es la única superficie
 * del sistema donde eso es legítimo, y por eso ninguna se puede llamar sin
 * haber comprobado antes la sesión de admin. El llamador lo hace; acá no hay
 * una segunda red, igual que en el resto de `plataforma`.
 *
 * -----------------------------------------------------------------------------
 * LO QUE RUTAX PUEDE Y LO QUE NO
 * -----------------------------------------------------------------------------
 * Puede sumar números (el caso que lo motivó: que el aviso le llegue también a
 * la pareja del seller), corregirlos y revocarlos. Cada cosa queda en bitácora
 * con el super-admin que la hizo.
 *
 * Lo que NO hace: **otorgar el consentimiento del número propio del seller.**
 * Esa fila es suya, la escribe él en su portal, y que Rutax pudiera activarla
 * por él reintroduciría justo el problema que este rediseño elimina — un
 * tercero afirmando el permiso de alguien.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import {
  normalizarTelefonoE164,
  MENSAJE_TELEFONO_INVALIDO,
} from "@/modules/integraciones/notificaciones/whatsapp";

export type OrigenContacto = "perfil_seller" | "agregado_por_rutax";
export type EstadoConsentimiento = "pendiente" | "otorgado" | "revocado";

export interface DestinatarioWhatsApp {
  id: string;
  telefono: string;
  etiqueta: string | null;
  origen: OrigenContacto;
  consentimiento: EstadoConsentimiento;
  consintioEn: string | null;
}

export interface SellerConDestinatarios {
  sellerId: string;
  sellerNombre: string;
  sellerEstado: string;
  tenantId: string;
  courierNombre: string;
  destinatarios: DestinatarioWhatsApp[];
}

export interface PanelDestinatarios {
  sellers: SellerConDestinatarios[];
  /**
   * ⚠️ El conteo que existe para que no sea un silencio. Un seller sin ningún
   * número con consentimiento **no recibe el aviso de retiro y nada falla**:
   * el envío termina en `sin_destinatarios` y el run de Inngest queda verde.
   * Es exactamente la clase de agujero que se descubre tres semanas después.
   */
  sellersSinDestinatario: number;
  /** Los que nunca entraron al portal: no tienen dónde poner su número. */
  sellersInvitadosSinNumero: number;
}

type Resultado = { ok: true } | { ok: false; mensaje: string };

/**
 * Todos los sellers de todos los couriers, con sus destinatarios.
 *
 * Va sin `embed` de PostgREST: la relación cruza de `integraciones` a
 * `identidad` y PostgREST solo busca claves foráneas DENTRO del esquema del
 * recurso (`PGRST200`). Compila perfecto y revienta al abrir la pantalla. Son
 * tres consultas y dos `Map`.
 */
export async function obtenerPanelDestinatarios(): Promise<PanelDestinatarios> {
  const cliente = crearClienteServiceRole();

  const [sellersRes, tenantsRes, contactosRes] = await Promise.all([
    cliente
      .schema("identidad")
      .from("sellers")
      .select("id, tenant_id, razon_social, estado")
      .order("razon_social"),
    cliente.schema("identidad").from("tenants").select("id, nombre_fantasia"),
    cliente
      .schema("integraciones")
      .from("whatsapp_contactos")
      .select("id, seller_id, telefono_e164, etiqueta, origen, opt_in_estado, opt_in_en")
      .order("origen"),
  ]);

  const nombresCouriers = new Map(
    ((tenantsRes.data ?? []) as Array<{ id: string; nombre_fantasia: string }>).map((t) => [
      t.id,
      t.nombre_fantasia,
    ]),
  );

  const porSeller = new Map<string, DestinatarioWhatsApp[]>();
  for (const c of (contactosRes.data ?? []) as Array<{
    id: string;
    seller_id: string;
    telefono_e164: string;
    etiqueta: string | null;
    origen: OrigenContacto;
    opt_in_estado: EstadoConsentimiento;
    opt_in_en: string | null;
  }>) {
    const lista = porSeller.get(c.seller_id) ?? [];
    lista.push({
      id: c.id,
      telefono: c.telefono_e164,
      etiqueta: c.etiqueta,
      origen: c.origen,
      consentimiento: c.opt_in_estado,
      consintioEn: c.opt_in_en,
    });
    porSeller.set(c.seller_id, lista);
  }

  const sellers = ((sellersRes.data ?? []) as Array<{
    id: string;
    tenant_id: string;
    razon_social: string;
    estado: string;
  }>).map((s) => ({
    sellerId: s.id,
    sellerNombre: s.razon_social,
    sellerEstado: s.estado,
    tenantId: s.tenant_id,
    courierNombre: nombresCouriers.get(s.tenant_id) ?? "Courier sin nombre",
    destinatarios: porSeller.get(s.id) ?? [],
  }));

  const alcanzable = (s: SellerConDestinatarios) =>
    s.destinatarios.some((d) => d.consentimiento === "otorgado");

  return {
    sellers,
    sellersSinDestinatario: sellers.filter((s) => !alcanzable(s)).length,
    sellersInvitadosSinNumero: sellers.filter(
      (s) => s.sellerEstado === "invitado" && s.destinatarios.length === 0,
    ).length,
  };
}

/**
 * Rutax suma un número adicional a un seller.
 *
 * El caso real: que el aviso de retiro le llegue también a la pareja del
 * seller, o a su jefe de bodega. Nace con el consentimiento **otorgado**
 * porque quien lo agrega está afirmando tenerlo — y por eso queda en bitácora
 * con su nombre. Es una declaración, no un ajuste.
 */
export async function agregarDestinatario(entrada: {
  tenantId: string;
  sellerId: string;
  telefono: string;
  etiqueta: string | null;
  actorUsuarioId: string;
}): Promise<Resultado> {
  const normalizado = normalizarTelefonoE164(entrada.telefono);
  if (!normalizado.valido) {
    return { ok: false, mensaje: MENSAJE_TELEFONO_INVALIDO[normalizado.motivo] };
  }

  const cliente = crearClienteServiceRole();
  const { data, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .insert({
      tenant_id: entrada.tenantId,
      seller_id: entrada.sellerId,
      telefono_e164: normalizado.telefonoE164,
      etiqueta: entrada.etiqueta?.trim() || null,
      origen: "agregado_por_rutax",
      opt_in_estado: "otorgado",
      opt_in_en: new Date().toISOString(),
      creado_por_usuario_id: entrada.actorUsuarioId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, mensaje: "Ese número ya está registrado para este seller." };
    }
    return { ok: false, mensaje: "No se pudo agregar el número." };
  }

  await registrarEnBitacora(cliente, {
    tenantId: entrada.tenantId,
    actorUsuarioId: entrada.actorUsuarioId,
    actorTipo: "usuario",
    accion: "whatsapp.destinatario_agregado_por_rutax",
    entidadTipo: "whatsapp_contacto",
    entidadId: data.id as string,
    // El teléfono NO va en el detalle: es dato personal y la entidad alcanza
    // para llegar a él cuando alguien con permiso lo necesite.
    detalle: { seller_id: entrada.sellerId, origen: "agregado_por_rutax" },
  });

  return { ok: true };
}

/**
 * Rutax revoca un destinatario.
 *
 * Funciona sobre CUALQUIER origen, incluido el número propio del seller: si
 * alguien reclama que no quiere más mensajes, Rutax tiene que poder detenerlo
 * sin depender de que el seller entre a su portal. Es la contraparte necesaria
 * de ser el emisor.
 *
 * Revoca, no borra: la fila es la evidencia de que hubo consentimiento y de
 * cuándo se retiró.
 */
export async function revocarDestinatario(entrada: {
  contactoId: string;
  actorUsuarioId: string;
}): Promise<Resultado> {
  const cliente = crearClienteServiceRole();

  const { data, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .update({ opt_in_estado: "revocado" })
    .eq("id", entrada.contactoId)
    .select("tenant_id, seller_id")
    .maybeSingle();

  if (error || !data) return { ok: false, mensaje: "No se pudo revocar el número." };

  await registrarEnBitacora(cliente, {
    tenantId: data.tenant_id as string,
    actorUsuarioId: entrada.actorUsuarioId,
    actorTipo: "usuario",
    accion: "whatsapp.consentimiento_revocado",
    entidadTipo: "whatsapp_contacto",
    entidadId: entrada.contactoId,
    detalle: { seller_id: data.seller_id, via: "backstage_rutax" },
  });

  return { ok: true };
}

/**
 * Rutax elimina un número que él mismo agregó.
 *
 * ⚠️ Solo los de `origen = 'agregado_por_rutax'`. El número propio del seller
 * NO se borra desde acá: es su dato, vive en su perfil, y borrárselo sin que se
 * entere lo dejaría sin avisos sin explicación. Para ese caso está revocar, que
 * deja rastro.
 */
export async function eliminarDestinatarioDeRutax(entrada: {
  contactoId: string;
  actorUsuarioId: string;
}): Promise<Resultado> {
  const cliente = crearClienteServiceRole();

  const { data: fila } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .select("tenant_id, seller_id, origen")
    .eq("id", entrada.contactoId)
    .maybeSingle();

  if (!fila) return { ok: false, mensaje: "Ese número ya no existe." };
  if (fila.origen !== "agregado_por_rutax") {
    return {
      ok: false,
      mensaje:
        "Ese es el número propio del seller: no se elimina desde acá. Si hay que detener los avisos, revócalo — así queda el rastro.",
    };
  }

  // Bitácora ANTES del efecto (invariante del proyecto): si el DELETE falla,
  // sobra una entrada; al revés, faltaría la evidencia de un borrado que sí
  // ocurrió.
  await registrarEnBitacora(cliente, {
    tenantId: fila.tenant_id as string,
    actorUsuarioId: entrada.actorUsuarioId,
    actorTipo: "usuario",
    accion: "whatsapp.destinatario_eliminado_por_rutax",
    entidadTipo: "whatsapp_contacto",
    entidadId: entrada.contactoId,
    detalle: { seller_id: fila.seller_id },
  });

  const { error } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .delete()
    .eq("id", entrada.contactoId)
    .eq("origen", "agregado_por_rutax");

  if (error) return { ok: false, mensaje: "No se pudo eliminar el número." };
  return { ok: true };
}
