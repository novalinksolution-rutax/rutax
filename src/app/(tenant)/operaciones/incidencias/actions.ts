"use server";

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { actualizarIncidencia, obtenerIncidencia } from "@/modules/operacion/incidencias";
import { actualizarEstadoPedido, obtenerPedido } from "@/modules/operacion/pedidos";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { hoyEnSantiago, sumarDiasCalendario } from "@/lib/fecha-santiago";
import { puedeGestionarIncidencias } from "@/modules/identidad/capacidades";
import type { EstadoIncidencia } from "@/modules/operacion/tipos";

export async function actionActualizarIncidencia(formData: FormData) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { error: "Sin sesión." };

  if (!puedeGestionarIncidencias(sesion.usuario)) {
    return { error: "No tienes permiso para gestionar incidencias." };
  }

  const incidenciaId = formData.get("incidenciaId") as string;
  const estado = formData.get("estado") as EstadoIncidencia | null;
  const notasResolucion = formData.get("notasResolucion") as string | null;

  if (!incidenciaId) return { error: "Falta el ID de la incidencia." };

  // Validar que si se cambia a 'resuelta', las notas sean obligatorias
  if (estado === "resuelta" && !notasResolucion?.trim()) {
    return { error: "Las notas de resolución son obligatorias para marcar como resuelta." };
  }

  try {
    const cliente = crearClienteServiceRole();
    await actualizarIncidencia(
      cliente,
      {
        incidenciaId,
        tenantId: sesion.usuario.tenantId,
        estado: estado ?? undefined,
        notasResolucion: notasResolucion ?? undefined,
        resueltaPorUsuarioId: sesion.usuarioId,
      },
      sesion.usuario,
    );
    revalidatePath("/operaciones/incidencias");
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al actualizar." };
  }
}

// =============================================================================
// Las dos acciones de cierre del panel de caso
// =============================================================================

/**
 * Las dos cierran la incidencia **y** dejan el pedido en un estado coherente.
 *
 * Es la razón de que existan. CLAUDE.md tiene anotado el cabo suelto: «un pedido
 * que queda en `fallido` y nunca llega a `devuelto` deja viva su línea de cobro
 * (`dinero/integridad.ts` espera `devuelto` para anularla). La incidencia
 * resuelve lo operativo; el estado terminal contable hay que cerrarlo igual.»
 *
 * Resolver la incidencia sin tocar el pedido es exactamente cómo se produce ese
 * cabo suelto: el supervisor siente que cerró el caso y la línea de cobro sigue
 * ahí. Por eso las dos acciones hacen las dos cosas, en una sola pulsación, y la
 * nota de resolución dice cuál se hizo.
 */

/** Devuelve el pedido al seller y resuelve la incidencia. */
export async function actionDevolverAlSeller(incidenciaId: string, motivo: string) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { error: "Sin sesión." };
  if (!puedeGestionarIncidencias(sesion.usuario)) {
    return { error: "No tienes permiso para gestionar incidencias." };
  }
  const razon = motivo.trim();
  if (razon.length < 3) return { error: "Escribe el motivo de la devolución." };

  try {
    const cliente = crearClienteServiceRole();
    const incidencia = await obtenerIncidencia(cliente, sesion.usuario.tenantId, incidenciaId);
    if (!incidencia) return { error: "No encontramos la incidencia." };

    const pedido = await obtenerPedido(cliente, incidencia.pedidoId, sesion.usuario.tenantId);
    if (!pedido) return { error: "No encontramos el pedido de la incidencia." };

    // `estadoEsperado` es el bloqueo optimista de la máquina de estados: si el
    // pedido se movió mientras el panel estaba abierto, la transición se rechaza
    // en vez de pisar lo que hizo otra persona.
    await actualizarEstadoPedido(
      cliente,
      {
        pedidoId: pedido.id,
        tenantId: sesion.usuario.tenantId,
        estadoNuevo: "devuelto",
        estadoEsperado: pedido.estado,
        ejecutor: "interno",
        actuadoPorUsuarioId: sesion.usuarioId,
        motivo: razon,
      },
      sesion.usuario,
    );

    await actualizarIncidencia(
      cliente,
      {
        incidenciaId,
        tenantId: sesion.usuario.tenantId,
        estado: "resuelta",
        notasResolucion: `Devuelto al seller. ${razon}`,
        resueltaPorUsuarioId: sesion.usuarioId,
      },
      sesion.usuario,
    );

    revalidatePath("/operaciones/incidencias");
    revalidatePath("/operaciones");
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al devolver el pedido." };
  }
}

/** Mueve la entrega al día siguiente y resuelve la incidencia. */
export async function actionReagendarParaManana(incidenciaId: string, motivo: string) {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { error: "Sin sesión." };
  if (!puedeGestionarIncidencias(sesion.usuario)) {
    return { error: "No tienes permiso para gestionar incidencias." };
  }
  const razon = motivo.trim();
  if (razon.length < 3) return { error: "Escribe el motivo del reagendamiento." };

  try {
    const cliente = crearClienteServiceRole();
    const incidencia = await obtenerIncidencia(cliente, sesion.usuario.tenantId, incidenciaId);
    if (!incidencia) return { error: "No encontramos la incidencia." };

    const manana = sumarDiasCalendario(hoyEnSantiago(), 1);

    // Bitácora ANTES del efecto, con autor y motivo: mover la fecha de
    // compromiso mueve la fecha contra la que se mide el SLA de ese pedido, así
    // que tiene que quedar dicho quién lo hizo y por qué.
    await registrarEnBitacora(cliente, {
      tenantId: sesion.usuario.tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "pedido.reagendado_desde_incidencia",
      entidadTipo: "pedido",
      entidadId: incidencia.pedidoId,
      detalle: { incidencia_id: incidenciaId, fecha_nueva: manana, motivo: razon },
    });

    const { error } = await cliente
      .schema("operacion")
      .from("pedidos")
      .update({ fecha_compromiso: manana })
      .eq("id", incidencia.pedidoId)
      .eq("tenant_id", sesion.usuario.tenantId);
    if (error) throw new Error(error.message);

    await actualizarIncidencia(
      cliente,
      {
        incidenciaId,
        tenantId: sesion.usuario.tenantId,
        estado: "resuelta",
        notasResolucion: `Reagendado para el ${manana}. ${razon}`,
        resueltaPorUsuarioId: sesion.usuarioId,
      },
      sesion.usuario,
    );

    revalidatePath("/operaciones/incidencias");
    revalidatePath("/operaciones");
    return { exito: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al reagendar el pedido." };
  }
}
