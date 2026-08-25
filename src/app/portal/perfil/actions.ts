"use server";

/**
 * Server Actions — El perfil del seller, en su propio portal.
 * =============================================================================
 * Hoy administra una sola cosa: **su WhatsApp y el consentimiento para
 * recibir avisos**. La pantalla existe por dos motivos que conviene no olvidar.
 *
 * 1. **Los sellers que ya existían.** El campo se pide al activar la cuenta,
 *    pero quien la activó antes del 2026-08-25 no vuelve a pasar por ahí. Sin
 *    esta pantalla se quedaban sin número para siempre.
 * 2. **El número cambia.** Un consentimiento que no se puede retirar desde
 *    donde se dio no es un consentimiento; es una trampa.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESCRIBE CON `service_role` Y NO CON LA SESIÓN DEL SELLER
 * -----------------------------------------------------------------------------
 * `integraciones.whatsapp_contactos` es deny-all: nadie llega por PostgREST.
 * El aislamiento lo impone ESTA función, filtrando por el `sellerId` de la
 * sesión — nunca por uno que venga en los parámetros. Es el mismo patrón que
 * los endpoints del conductor.
 *
 * ⚠️ **El seller solo puede tocar SU PROPIA fila**, la de `origen =
 * 'perfil_seller'`. Los números que Rutax le sumó (su pareja, su jefe de
 * bodega) no aparecen acá ni se pueden borrar desde acá: los administra quien
 * los puso, y esa asimetría es deliberada.
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import {
  normalizarTelefonoE164,
  MENSAJE_TELEFONO_INVALIDO,
} from "@/modules/integraciones/notificaciones/whatsapp";

const RUTA = "/portal/perfil";

export interface WhatsAppDelSeller {
  /** El número tal cual, para que pueda corregirlo. Es SUYO: no se enmascara. */
  telefono: string | null;
  consentimiento: "pendiente" | "otorgado" | "revocado" | null;
  /** Cuántos números adicionales le puso Rutax. Solo el conteo, sin los números. */
  adicionalesDeRutax: number;
}

type Resultado = { ok: true } | { ok: false; mensaje: string };

async function exigirSeller(): Promise<
  { ok: true; tenantId: string; sellerId: string; usuarioId: string } | { ok: false; mensaje: string }
> {
  const sesion = await exigirSesionActual();
  const u = sesion.usuario;
  if (u.tipoUsuario !== "seller" || !u.sellerId || !u.tenantId) {
    return { ok: false, mensaje: "Esta pantalla es del portal del seller." };
  }
  return { ok: true, tenantId: u.tenantId, sellerId: u.sellerId, usuarioId: sesion.usuarioId };
}

export async function obtenerWhatsAppDelSeller(): Promise<WhatsAppDelSeller | null> {
  const permiso = await exigirSeller();
  if (!permiso.ok) return null;

  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .select("telefono_e164, opt_in_estado, origen")
    .eq("tenant_id", permiso.tenantId)
    .eq("seller_id", permiso.sellerId);

  const filas = (data ?? []) as Array<{
    telefono_e164: string;
    opt_in_estado: WhatsAppDelSeller["consentimiento"];
    origen: string;
  }>;

  const propio = filas.find((f) => f.origen === "perfil_seller");
  return {
    telefono: propio?.telefono_e164 ?? null,
    consentimiento: propio?.opt_in_estado ?? null,
    // Se le dice CUÁNTOS hay, no cuáles. Que sepa que su courier avisa a más
    // gente es información suya; los números de terceros no son cosa de esta
    // pantalla.
    adicionalesDeRutax: filas.filter((f) => f.origen === "agregado_por_rutax").length,
  };
}

/**
 * Guarda o corrige el número del seller, con su consentimiento.
 *
 * Es un upsert sobre su única fila `perfil_seller` — el índice único parcial
 * de la base garantiza que no pueda haber dos.
 */
export async function guardarWhatsAppDelSeller(entrada: {
  telefono: string;
}): Promise<Resultado> {
  const permiso = await exigirSeller();
  if (!permiso.ok) return permiso;

  const normalizado = normalizarTelefonoE164(entrada.telefono);
  if (!normalizado.valido) {
    return { ok: false, mensaje: MENSAJE_TELEFONO_INVALIDO[normalizado.motivo] };
  }

  const cliente = crearClienteServiceRole();
  const ahora = new Date().toISOString();

  // ¿Ya tenía uno? Se corrige; si no, se crea. Va en dos pasos y no en un
  // `upsert` de PostgREST porque la llave de conflicto es un índice PARCIAL
  // (`where origen = 'perfil_seller'`) y `on_conflict` no lo puede nombrar.
  const { data: existente } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .select("id")
    .eq("tenant_id", permiso.tenantId)
    .eq("seller_id", permiso.sellerId)
    .eq("origen", "perfil_seller")
    .maybeSingle();

  const { error } = existente
    ? await cliente
        .schema("integraciones")
        .from("whatsapp_contactos")
        .update({
          telefono_e164: normalizado.telefonoE164,
          opt_in_estado: "otorgado",
          opt_in_en: ahora,
        })
        .eq("id", existente.id as string)
    : await cliente
        .schema("integraciones")
        .from("whatsapp_contactos")
        .insert({
          tenant_id: permiso.tenantId,
          seller_id: permiso.sellerId,
          telefono_e164: normalizado.telefonoE164,
          origen: "perfil_seller",
          opt_in_estado: "otorgado",
          opt_in_en: ahora,
        });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, mensaje: "Ese número ya está registrado para tu cuenta." };
    }
    return { ok: false, mensaje: "No pudimos guardar tu número. Intenta de nuevo." };
  }

  await registrarEnBitacora(cliente, {
    tenantId: permiso.tenantId,
    actorUsuarioId: permiso.usuarioId,
    actorTipo: "usuario",
    accion: "whatsapp.consentimiento_otorgado",
    entidadTipo: "seller",
    entidadId: permiso.sellerId,
    detalle: { origen: "perfil_seller", via: "portal_del_seller" },
  });

  revalidatePath(RUTA);
  return { ok: true };
}

/**
 * El seller se da de baja de los avisos.
 *
 * Revoca, no borra: la fila queda como evidencia de que hubo un consentimiento
 * y de cuándo se retiró. Meta puede preguntar por ambas cosas.
 */
export async function darseDeBajaDeWhatsApp(): Promise<Resultado> {
  const permiso = await exigirSeller();
  if (!permiso.ok) return permiso;

  const cliente = crearClienteServiceRole();
  const { error } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .update({ opt_in_estado: "revocado" })
    .eq("tenant_id", permiso.tenantId)
    .eq("seller_id", permiso.sellerId)
    .eq("origen", "perfil_seller");

  if (error) return { ok: false, mensaje: "No pudimos darte de baja. Intenta de nuevo." };

  await registrarEnBitacora(cliente, {
    tenantId: permiso.tenantId,
    actorUsuarioId: permiso.usuarioId,
    actorTipo: "usuario",
    accion: "whatsapp.consentimiento_revocado",
    entidadTipo: "seller",
    entidadId: permiso.sellerId,
    detalle: { origen: "perfil_seller", via: "portal_del_seller" },
  });

  revalidatePath(RUTA);
  return { ok: true };
}
