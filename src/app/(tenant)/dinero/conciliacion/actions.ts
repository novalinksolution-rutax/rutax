"use server";

/**
 * Server Actions para eventos de conciliación — Pantalla D-4.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { resolverEventoConciliacion } from "@/modules/dinero/acciones";
import type { EstadoEventoConciliacion } from "@/modules/dinero/tipos";

type Resolucion = Extract<EstadoEventoConciliacion, "revisado" | "resuelto" | "ignorado">;

export async function accionResolverEvento(
  eventoId: string,
  resolucion: Resolucion,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }

  try {
    await resolverEventoConciliacion(
      sesion.usuario.tenantId,
      eventoId,
      resolucion,
      sesion.usuario,
    );
    return { ok: true };
  } catch (err) {
    const mensaje =
      err instanceof Error
        ? err.message
        : "Error al resolver el evento de conciliación.";
    return { ok: false, mensaje };
  }
}

// Restaurar a pendiente: llama a resolverEventoConciliacion con 'pendiente'
// (en acciones.ts no existe 'pendiente' como resolucion, por lo que manejamos
// el update directo desde aquí vía la función genérica)
export async function accionRestaurarEventoPendiente(
  eventoId: string,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No autenticado." };
  }

  // Usamos el cliente service_role directamente para este caso especial
  // (restaurar a pendiente no es una de las resoluciones del módulo dinero)
  const { crearClienteServiceRole } = await import("@/lib/supabase/service-role");
  const { puedeVerConciliacion } = await import("@/modules/identidad/capacidades");
  const { registrarEnBitacora } = await import("@/modules/identidad/auditoria");

  if (!puedeVerConciliacion(sesion.usuario)) {
    return { ok: false, mensaje: "Sin permisos para restaurar eventos de conciliación." };
  }

  const supabase = crearClienteServiceRole();
  const tenantId = sesion.usuario.tenantId;

  try {
    const { error } = await supabase
      .schema("dinero")
      .from("eventos_conciliacion")
      .update({ estado: "pendiente" })
      .eq("id", eventoId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: null,
      actorTipo: "usuario",
      accion: "dinero.evento_conciliacion_restaurado",
      entidadTipo: "evento_conciliacion",
      entidadId: eventoId,
      detalle: { resolucion: "pendiente" },
    });

    return { ok: true };
  } catch (err) {
    const mensaje =
      err instanceof Error ? err.message : "Error al restaurar el evento.";
    return { ok: false, mensaje };
  }
}
