"use server";

/**
 * Bodegas del seller — administradas POR EL SELLER, desde su portal.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 ESTO SE APARTA DEL TABLERO, Y ES DECISIÓN DEL USUARIO (25-08-2026)
 * -----------------------------------------------------------------------------
 * `B4 · Portal del seller` dice de esta pantalla: *«listado de solo lectura: las
 * que el courier registró para retirar. Ninguna acción: no es su
 * configuración»*. Se revierte a propósito.
 *
 * El motivo es operativo: la bodega es del seller, y con la pantalla en solo
 * lectura estrenar una dirección nueva exigía pedírselo al courier por WhatsApp
 * y esperar. El seller queda dependiendo de otro para algo que solo él sabe.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ LO QUE EL SELLER **NO** TOCA: `monto_visita_clp`
 * -----------------------------------------------------------------------------
 * Esa columna es **lo que el courier le paga al conductor por visitar esta
 * bodega**. No se lee ni se escribe desde acá, y no aparece en el formulario:
 * una bodega nueva hereda el monto general del courier (columna en `null`).
 *
 * Que el seller cree una bodega significa que el courier va a pagar visitas a
 * una dirección que no aprobó — decisión del usuario, asumida. Lo que sí se
 * hace es que **no se entere por la liquidación**: la bitácora deja el autor, y
 * la pantalla del courier marca cuáles vinieron del seller.
 *
 * -----------------------------------------------------------------------------
 * EL `seller_id` SALE DE LA SESIÓN, NUNCA DEL FORMULARIO
 * -----------------------------------------------------------------------------
 * Es la barrera de aislamiento de este archivo. Aceptarlo del cuerpo de la
 * petición —como hacen las acciones del courier, que legítimamente administran
 * a varios— dejaría a un seller creando bodegas a nombre de otro con solo
 * cambiar un campo. Ya mordió en este repo con el `tenant_id` del webhook de
 * WhatsApp.
 */

import { revalidatePath } from "next/cache";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { puedeGestionarPedidosPropios } from "@/modules/identidad/capacidades";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { resolverCoordenadaConCache } from "@/modules/integraciones/geocoding";

export type ResultadoBodega = { ok: true } | { ok: false; mensaje: string };

interface Guardia {
  ok: true;
  tenantId: string;
  sellerId: string;
  usuarioId: string;
}

/**
 * Quién puede administrar bodegas del seller: el propio seller, y solo las
 * suyas.
 *
 * `puedeGestionarPedidosPropios` es la capacidad que ya define «este usuario
 * opera lo suyo en el portal». No se inventa una capacidad nueva para esto: la
 * bodega es parte de operar sus pedidos, y un eje más de permisos que nadie
 * administra es un eje que se desincroniza.
 */
async function exigirSeller(): Promise<Guardia | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No hay sesión activa." };
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "Esta acción es del portal del seller." };
  }
  if (!puedeGestionarPedidosPropios(sesion.usuario)) {
    return { ok: false, mensaje: "Tu cuenta no puede administrar bodegas." };
  }
  return {
    ok: true,
    tenantId: sesion.usuario.tenantId,
    sellerId: sesion.usuario.sellerId,
    usuarioId: sesion.usuarioId,
  };
}

interface CamposBodega {
  nombre: string;
  direccion: string;
  comuna: string;
  instruccionesAcceso: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
}

function leerCampos(fd: FormData): { ok: true; v: CamposBodega } | { ok: false; mensaje: string } {
  const nombre = String(fd.get("nombre") ?? "").trim();
  const direccion = String(fd.get("direccion") ?? "").trim();
  const comuna = String(fd.get("comuna") ?? "").trim();

  if (!nombre) return { ok: false, mensaje: "Ponle un nombre a la bodega." };
  if (!direccion) return { ok: false, mensaje: "Falta la dirección." };
  if (!comuna) return { ok: false, mensaje: "Elige una comuna." };
  if (!(COMUNAS_RM as readonly string[]).includes(comuna)) {
    return { ok: false, mensaje: "Esa comuna no está en la Región Metropolitana." };
  }

  return {
    ok: true,
    v: {
      nombre,
      direccion,
      comuna,
      instruccionesAcceso: String(fd.get("instrucciones_acceso") ?? "").trim() || null,
      contactoNombre: String(fd.get("contacto_nombre") ?? "").trim() || null,
      contactoTelefono: String(fd.get("contacto_telefono") ?? "").trim() || null,
    },
  };
}

/**
 * Geocoding SÍNCRONO, y nunca lanza.
 *
 * Síncrono porque son unas pocas filas por seller, hay una persona esperando, y
 * si la coordenada queda mal es la dirección adonde el conductor va a ir a
 * buscar los bultos. Que no lance porque una bodega sin coordenada sigue siendo
 * una bodega útil: se guarda igual y el courier la reintenta.
 */
async function ubicar(direccion: string, comuna: string) {
  const ahora = new Date().toISOString();
  try {
    const r = await resolverCoordenadaConCache({ direccion, comuna });
    if (r?.lat != null && r?.long != null) {
      return {
        lat: r.lat,
        long: r.long,
        geo_estado: "resuelto",
        geo_confianza: r.confianza ?? null,
        geocodificado_en: ahora,
      };
    }
  } catch {
    // Cae al no_resuelto de abajo.
  }
  return { lat: null, long: null, geo_estado: "no_resuelto", geo_confianza: null, geocodificado_en: ahora };
}

export async function accionCrearMiBodega(fd: FormData): Promise<ResultadoBodega> {
  const g = await exigirSeller();
  if (!g.ok) return g;
  const campos = leerCampos(fd);
  if (!campos.ok) return campos;

  const cliente = crearClienteServiceRole();

  try {
    // ¿Es la primera? Cuenta TODA fila, activa o no: «primera» es ordinal.
    const { count } = await cliente
      .schema("identidad")
      .from("seller_bodegas")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", g.tenantId)
      .eq("seller_id", g.sellerId);
    const esPrimera = (count ?? 0) === 0;

    const geo = await ubicar(campos.v.direccion, campos.v.comuna);

    // Bitácora ANTES del efecto (invariante del proyecto).
    await registrarEnBitacora(cliente, {
      tenantId: g.tenantId,
      actorUsuarioId: g.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.bodega_seller_creada_por_seller",
      entidadTipo: "bodega_seller",
      entidadId: null,
      detalle: { seller_id: g.sellerId, nombre: campos.v.nombre, comuna: campos.v.comuna },
    });

    const { error } = await cliente
      .schema("identidad")
      .from("seller_bodegas")
      .insert({
        tenant_id: g.tenantId,
        seller_id: g.sellerId,
        nombre: campos.v.nombre,
        direccion: campos.v.direccion,
        comuna: campos.v.comuna,
        instrucciones_acceso: campos.v.instruccionesAcceso,
        contacto_nombre: campos.v.contactoNombre,
        contacto_telefono: campos.v.contactoTelefono,
        es_principal: esPrimera,
        activa: true,
        // ⚠️ `monto_visita_clp` NO se manda: queda en null y hereda el monto
        // general del courier. Es su plata, no la del seller.
        ...geo,
      });

    if (error) return { ok: false, mensaje: `No se pudo crear la bodega: ${error.message}` };

    revalidatePath("/portal/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "No se pudo crear la bodega." };
  }
}

export async function accionEditarMiBodega(id: string, fd: FormData): Promise<ResultadoBodega> {
  const g = await exigirSeller();
  if (!g.ok) return g;
  const campos = leerCampos(fd);
  if (!campos.ok) return campos;

  const cliente = crearClienteServiceRole();

  try {
    // ⚠️ La dirección se re-ubica SOLO si cambió. Volver a geocodificar en cada
    // edición gasta una llamada facturable por corregir un teléfono, y pisa una
    // coordenada que el courier pudo haber corregido a mano.
    const { data: actual } = await cliente
      .schema("identidad")
      .from("seller_bodegas")
      .select("direccion, comuna")
      .eq("id", id)
      .eq("tenant_id", g.tenantId)
      .eq("seller_id", g.sellerId)
      .maybeSingle();

    if (!actual) return { ok: false, mensaje: "Esa bodega no es tuya." };

    const cambioLaDireccion =
      actual.direccion !== campos.v.direccion || actual.comuna !== campos.v.comuna;
    const geo = cambioLaDireccion ? await ubicar(campos.v.direccion, campos.v.comuna) : {};

    await registrarEnBitacora(cliente, {
      tenantId: g.tenantId,
      actorUsuarioId: g.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.bodega_seller_editada_por_seller",
      entidadTipo: "bodega_seller",
      entidadId: id,
      detalle: { nombre: campos.v.nombre, comuna: campos.v.comuna, reubicada: cambioLaDireccion },
    });

    const { error } = await cliente
      .schema("identidad")
      .from("seller_bodegas")
      .update({
        nombre: campos.v.nombre,
        direccion: campos.v.direccion,
        comuna: campos.v.comuna,
        instrucciones_acceso: campos.v.instruccionesAcceso,
        contacto_nombre: campos.v.contactoNombre,
        contacto_telefono: campos.v.contactoTelefono,
        ...geo,
      })
      // Las tres condiciones juntas son el aislamiento: tenant, seller y id.
      .eq("id", id)
      .eq("tenant_id", g.tenantId)
      .eq("seller_id", g.sellerId);

    if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };

    revalidatePath("/portal/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "No se pudo guardar la bodega." };
  }
}

/**
 * Baja y alta de una bodega. **Nunca borra.**
 *
 * Detrás de una bodega cuelgan actas de retiro que respaldan pagos a
 * conductores: borrarla dejaría esos pagos sin el sitio al que fueron.
 */
export async function accionCambiarEstadoMiBodega(
  id: string,
  activa: boolean,
): Promise<ResultadoBodega> {
  const g = await exigirSeller();
  if (!g.ok) return g;

  const cliente = crearClienteServiceRole();

  try {
    // 🔴 No se puede desactivar la principal si es la única activa: el courier
    // se quedaría sin ninguna dirección adonde ir a retirar, y el seller no
    // vería ningún error hasta que un retiro no ocurriera.
    if (!activa) {
      const { data: activas } = await cliente
        .schema("identidad")
        .from("seller_bodegas")
        .select("id")
        .eq("tenant_id", g.tenantId)
        .eq("seller_id", g.sellerId)
        .eq("activa", true);
      if ((activas ?? []).length <= 1) {
        return {
          ok: false,
          mensaje:
            "Es tu única bodega activa. Si la desactivas, tu courier no tiene dónde retirar: agrega otra primero.",
        };
      }
    }

    await registrarEnBitacora(cliente, {
      tenantId: g.tenantId,
      actorUsuarioId: g.usuarioId,
      actorTipo: "usuario",
      accion: activa
        ? "identidad.bodega_seller_reactivada_por_seller"
        : "identidad.bodega_seller_desactivada_por_seller",
      entidadTipo: "bodega_seller",
      entidadId: id,
      detalle: {},
    });

    const { error } = await cliente
      .schema("identidad")
      .from("seller_bodegas")
      .update({ activa })
      .eq("id", id)
      .eq("tenant_id", g.tenantId)
      .eq("seller_id", g.sellerId);

    if (error) return { ok: false, mensaje: `No se pudo cambiar el estado: ${error.message}` };

    revalidatePath("/portal/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "No se pudo cambiar el estado." };
  }
}

/** Cuál es la bodega principal: la que el courier toma por defecto. */
export async function accionMarcarMiBodegaPrincipal(id: string): Promise<ResultadoBodega> {
  const g = await exigirSeller();
  if (!g.ok) return g;

  const cliente = crearClienteServiceRole();

  try {
    await registrarEnBitacora(cliente, {
      tenantId: g.tenantId,
      actorUsuarioId: g.usuarioId,
      actorTipo: "usuario",
      accion: "identidad.bodega_seller_principal_cambiada_por_seller",
      entidadTipo: "bodega_seller",
      entidadId: id,
      detalle: {},
    });

    // Dos escrituras, y el orden importa: primero se apaga la anterior. Al
    // revés, un índice único de «una principal por seller» rechazaría la
    // segunda y quedaríamos sin ninguna.
    const base = () =>
      cliente
        .schema("identidad")
        .from("seller_bodegas")
        .update({ es_principal: false })
        .eq("tenant_id", g.tenantId)
        .eq("seller_id", g.sellerId);

    const { error: e1 } = await base();
    if (e1) return { ok: false, mensaje: `No se pudo cambiar la principal: ${e1.message}` };

    const { error: e2 } = await cliente
      .schema("identidad")
      .from("seller_bodegas")
      .update({ es_principal: true })
      .eq("id", id)
      .eq("tenant_id", g.tenantId)
      .eq("seller_id", g.sellerId);

    if (e2) return { ok: false, mensaje: `No se pudo cambiar la principal: ${e2.message}` };

    revalidatePath("/portal/bodegas");
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "No se pudo cambiar la principal." };
  }
}
