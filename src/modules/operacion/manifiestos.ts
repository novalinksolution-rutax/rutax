/**
 * Módulo de manifiestos — creación, asignación, confirmación y consulta.
 *
 * Reglas de negocio implementadas:
 * 1. asignarPedidosAManifiesto: para cada pedido, desactiva la asignación activa
 *    en OTRO manifiesto antes de insertar la nueva. La reasignación al mismo
 *    manifiesto es idempotente (no crea duplicado).
 * 2. Verificación de tenant: el manifiesto y todos los pedidos deben pertenecer
 *    al mismo tenant_id — ErrorConflicto si no.
 * 3. RBAC: la asignación requiere puedeAsignarYReasignarPedidos.
 * 4. La confirmación del manifiesto registra en bitácora.
 *
 * Las escrituras vienen de jobs y server actions — usa service_role.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Manifiesto,
  CrearManifiestoEntrada,
  EstadoPedido,
} from "./tipos";
import { ErrorAsignacionConflicto } from "./errores";
import { ErrorValidacion, ErrorConflicto } from "@/modules/identidad/errores";
import { puedeAsignarYReasignarPedidos, puedeGenerarManifiestos } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";

// =============================================================================
// Mapper de fila de BD → interfaz Manifiesto
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAManifiesto(fila: Record<string, any>): Manifiesto {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    driverId: fila.driver_id,
    nombre: fila.nombre,
    fechaOperacion: fila.fecha_operacion,
    estado: fila.estado,
    notas: fila.notas ?? null,
    creadoPorUsuarioId: fila.creado_por_usuario_id ?? null,
    confirmadoEn: fila.confirmado_en ?? null,
    completadoEn: fila.completado_en ?? null,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

// =============================================================================
// crearManifiesto
// =============================================================================

/**
 * Crea un manifiesto en estado 'borrador'.
 * Requiere que el actor tenga capacidad de generar manifiestos.
 */
export async function crearManifiesto(
  cliente: SupabaseClient,
  entrada: CrearManifiestoEntrada,
  actor?: UsuarioActual,
): Promise<Manifiesto> {
  if (actor && !puedeGenerarManifiestos(actor)) {
    throw new ErrorValidacion(
      "El usuario no tiene capacidad para generar manifiestos (se requiere coordinador, supervisor o dueño)",
    );
  }

  const { data, error } = await cliente
    .from("manifiestos")
    .insert({
      tenant_id: entrada.tenantId,
      driver_id: entrada.driverId,
      nombre: entrada.nombre,
      fecha_operacion: entrada.fechaOperacion,
      estado: "borrador",
      notas: entrada.notas ?? null,
      creado_por_usuario_id: entrada.creadoPorUsuarioId ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Error al crear el manifiesto: ${error?.message ?? "sin datos"}`);
  }

  return filaAManifiesto(data);
}

// =============================================================================
// asignarPedidosAManifiesto
// =============================================================================

/**
 * Asigna una lista de pedidos a un manifiesto.
 *
 * Por cada pedido:
 * - Verifica que el pedido pertenece al mismo tenant que el manifiesto.
 * - Si ya está activo en el MISMO manifiesto: no hace nada (idempotente).
 * - Si está activo en OTRO manifiesto: desactiva la asignación anterior,
 *   luego inserta la nueva.
 * - Si no tiene asignación activa: inserta directamente.
 *
 * Requiere que el actor tenga puedeAsignarYReasignarPedidos.
 *
 * @param actorUsuarioId UUID de auth del usuario que dispara la acción (RNF-04).
 *   Pásalo siempre desde server actions (`sesion.usuarioId`). Si se llama desde
 *   un job sin sesión humana, pasa null explícitamente.
 */
export async function asignarPedidosAManifiesto(
  cliente: SupabaseClient,
  manifiestoId: string,
  pedidoIds: string[],
  actor?: UsuarioActual,
  actorUsuarioId?: string | null,
): Promise<void> {
  if (actor && !puedeAsignarYReasignarPedidos(actor)) {
    throw new ErrorValidacion(
      "El usuario no tiene capacidad para asignar y reasignar pedidos",
    );
  }

  if (pedidoIds.length === 0) return;

  // Leer el manifiesto para obtener tenant_id y driver_id.
  const { data: manifiesto, error: errorManifiesto } = await cliente
    .from("manifiestos")
    .select("id, tenant_id, driver_id, estado")
    .eq("id", manifiestoId)
    .maybeSingle();

  if (errorManifiesto) {
    throw new Error(`Error al leer el manifiesto: ${errorManifiesto.message}`);
  }

  if (!manifiesto) {
    throw new ErrorConflicto(`El manifiesto '${manifiestoId}' no existe`);
  }

  // Solo se puede asignar pedidos a un manifiesto en estado 'borrador'.
  // Un manifiesto confirmado o en ruta no acepta nuevas asignaciones.
  if (manifiesto.estado !== "borrador") {
    throw new ErrorConflicto(
      `No se pueden asignar pedidos al manifiesto '${manifiestoId}': ` +
        `estado actual '${manifiesto.estado}' (se requiere 'borrador')`,
    );
  }

  const { tenant_id: tenantId, driver_id: driverId } = manifiesto;

  // Verificar que todos los pedidos existen y pertenecen al mismo tenant.
  const { data: pedidos, error: errorPedidos } = await cliente
    .from("pedidos")
    .select("id, tenant_id, seller_id, estado")
    .in("id", pedidoIds)
    .eq("tenant_id", tenantId);

  if (errorPedidos) {
    throw new Error(`Error al verificar pedidos: ${errorPedidos.message}`);
  }

  const pedidosEncontrados = pedidos ?? [];
  const idsEncontrados = new Set(pedidosEncontrados.map((p: { id: string }) => p.id));

  for (const id of pedidoIds) {
    if (!idsEncontrados.has(id)) {
      throw new ErrorConflicto(
        `El pedido '${id}' no existe o no pertenece al tenant '${tenantId}'`,
      );
    }
  }

  // Leer asignaciones activas actuales de estos pedidos.
  const { data: asignacionesActivas, error: errorAsignaciones } = await cliente
    .from("asignaciones_pedido")
    .select("id, pedido_id, manifiesto_id, driver_id")
    .in("pedido_id", pedidoIds)
    .eq("activa", true)
    .eq("tenant_id", tenantId);

  if (errorAsignaciones) {
    throw new Error(`Error al leer asignaciones activas: ${errorAsignaciones.message}`);
  }

  // Mapa pedido_id → asignación activa actual.
  const asignacionPorPedido = new Map<
    string,
    { id: string; pedido_id: string; manifiesto_id: string; driver_id: string }
  >();
  for (const a of asignacionesActivas ?? []) {
    asignacionPorPedido.set(a.pedido_id, a);
  }

  // Mapa pedido_id → seller_id (para denormalización).
  const sellerPorPedido = new Map<string, string>();
  for (const p of pedidosEncontrados) {
    sellerPorPedido.set(p.id, p.seller_id);
  }

  const ahora = new Date().toISOString();

  for (const pedidoId of pedidoIds) {
    const asignacionActual = asignacionPorPedido.get(pedidoId);

    // Caso 1: ya está en este mismo manifiesto — idempotente, no hacer nada.
    if (asignacionActual && asignacionActual.manifiesto_id === manifiestoId) {
      continue;
    }

    // Caso 2: está activo en OTRO manifiesto — desactivar la asignación anterior.
    if (asignacionActual && asignacionActual.manifiesto_id !== manifiestoId) {
      const { error: errorDesactivar } = await cliente
        .from("asignaciones_pedido")
        .update({
          activa: false,
          desasignado_en: ahora,
        })
        .eq("id", asignacionActual.id)
        .eq("tenant_id", tenantId);

      if (errorDesactivar) {
        throw new ErrorAsignacionConflicto(
          `No se pudo desactivar la asignación anterior del pedido '${pedidoId}': ${errorDesactivar.message}`,
        );
      }
    }

    // Caso 3 (o continuación del 2): insertar nueva asignación activa.
    const sellerId = sellerPorPedido.get(pedidoId);
    if (!sellerId) {
      throw new ErrorConflicto(`No se encontró seller_id para el pedido '${pedidoId}'`);
    }

    const { error: errorInsert } = await cliente
      .from("asignaciones_pedido")
      .insert({
        tenant_id: tenantId,
        pedido_id: pedidoId,
        manifiesto_id: manifiestoId,
        driver_id: driverId,
        seller_id: sellerId,
        activa: true,
        asignado_en: ahora,
      });

    if (errorInsert) {
      throw new ErrorAsignacionConflicto(
        `No se pudo crear la asignación para el pedido '${pedidoId}': ${errorInsert.message}`,
      );
    }

    // Actualizar el estado del pedido a 'asignado' si está en 'pendiente_asignacion'.
    const pedido = pedidosEncontrados.find((p: { id: string }) => p.id === pedidoId);
    if (pedido && pedido.estado === "pendiente_asignacion") {
      await cliente
        .from("pedidos")
        .update({ estado: "asignado" as EstadoPedido })
        .eq("id", pedidoId)
        .eq("tenant_id", tenantId);
    }
  }

  // Bitácora de asignación si hay actor (RNF-04: siempre registra el "quién").
  if (actor) {
    await registrarEnBitacora(cliente, {
      tenantId,
      actorUsuarioId: actorUsuarioId ?? null,
      actorTipo: "usuario",
      accion: "manifiesto.pedidos_asignados",
      entidadTipo: "manifiesto",
      entidadId: manifiestoId,
      detalle: {
        pedidos_asignados: pedidoIds.length,
        driver_id: driverId,
      },
    });
  }
}

// =============================================================================
// confirmarManifiesto
// =============================================================================

/**
 * Confirma un manifiesto (pasa de 'borrador' a 'confirmado').
 * Registra en bitácora.
 *
 * @param actorUsuarioId UUID de auth del usuario que dispara la acción (RNF-04).
 *   Pásalo siempre desde server actions (`sesion.usuarioId`).
 */
export async function confirmarManifiesto(
  cliente: SupabaseClient,
  manifiestoId: string,
  tenantId: string,
  actor?: UsuarioActual,
  actorUsuarioId?: string | null,
): Promise<Manifiesto> {
  if (actor && !puedeAsignarYReasignarPedidos(actor)) {
    throw new ErrorValidacion(
      "El usuario no tiene capacidad para confirmar manifiestos",
    );
  }

  const { data: actual, error: errorLeer } = await cliente
    .from("manifiestos")
    .select("*")
    .eq("id", manifiestoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (errorLeer) {
    throw new Error(`Error al leer el manifiesto: ${errorLeer.message}`);
  }

  if (!actual) {
    throw new ErrorConflicto(`El manifiesto '${manifiestoId}' no existe o no pertenece al tenant`);
  }

  if (actual.estado !== "borrador") {
    throw new ErrorConflicto(
      `No se puede confirmar el manifiesto: estado actual '${actual.estado}' (se requiere 'borrador')`,
    );
  }

  // Un manifiesto sin pedidos asignados no tiene sentido confirmar.
  const { count: cantidadAsignados, error: errorAsig } = await cliente
    .from("asignaciones_pedido")
    .select("*", { count: "exact", head: true })
    .eq("manifiesto_id", manifiestoId)
    .eq("tenant_id", tenantId)
    .eq("activa", true);

  if (errorAsig) {
    throw new Error(`Error al verificar pedidos del manifiesto: ${errorAsig.message}`);
  }

  if (!cantidadAsignados || cantidadAsignados === 0) {
    throw new ErrorConflicto(
      `No se puede confirmar el manifiesto '${manifiestoId}': no tiene pedidos asignados. ` +
        `Asigna al menos un pedido antes de confirmar.`,
    );
  }

  const ahora = new Date().toISOString();

  const { data: confirmado, error: errorUpdate } = await cliente
    .from("manifiestos")
    .update({
      estado: "confirmado",
      confirmado_en: ahora,
    })
    .eq("id", manifiestoId)
    .eq("tenant_id", tenantId)
    .select()
    .single();

  if (errorUpdate || !confirmado) {
    throw new Error(`Error al confirmar el manifiesto: ${errorUpdate?.message ?? "sin datos"}`);
  }

  if (actor) {
    await registrarEnBitacora(cliente, {
      tenantId,
      actorUsuarioId: actorUsuarioId ?? null,
      actorTipo: "usuario",
      accion: "manifiesto.confirmado",
      entidadTipo: "manifiesto",
      entidadId: manifiestoId,
      detalle: { driver_id: actual.driver_id, fecha_operacion: actual.fecha_operacion },
    });
  }

  return filaAManifiesto(confirmado);
}

// =============================================================================
// completarManifiesto
// =============================================================================

/**
 * Marca un manifiesto como 'completado' (desde 'en_ruta').
 *
 * Bitácora ANTES del UPDATE de estado (CLAUDE.md: "bitácora antes que efectos externos").
 *
 * Nota histórica (2026-08-14): esta función también borraba server-side la
 * ubicación GPS del conductor al cerrar la ruta (ALTO-1, Ley 21.431). Ese
 * borrado se retiró junto con todo el rastreo en vivo
 * (`operacion.ubicacion_conductor`) — ver
 * `docs/seguridad/punto-de-termino-conductor.md` §1: nada leía esa tabla, no
 * tenía purga y la última posición del día sobrevivía sin límite de tiempo.
 * Con la escritura cortada (`actualizarUbicacionConductor` ya no existe), no
 * queda nada que borrar aquí — no reintroducir esta llamada sin antes releer
 * ese documento.
 *
 * @param actorUsuarioId UUID de auth del usuario que dispara la acción (RNF-04).
 */
export async function completarManifiesto(
  cliente: SupabaseClient,
  manifiestoId: string,
  tenantId: string,
  driverId: string,
  actor?: UsuarioActual,
  actorUsuarioId?: string | null,
): Promise<Manifiesto> {
  const { data: actual, error: errorLeer } = await cliente
    .from("manifiestos")
    .select("*")
    .eq("id", manifiestoId)
    .eq("tenant_id", tenantId)
    // El manifiesto debe ser del conductor indicado. Sin este filtro aislaba por
    // tenant pero NO por conductor: cualquier conductor activo del mismo courier
    // podia cerrar la ruta en_ruta de un colega en pleno reparto con solo
    // conocer su id. Su hermana `manifiesto/iniciar` si lo filtraba.
    //
    // Corrige ademas el camino del courier, donde `driverId` llega del
    // formulario: con un id equivocado, esta funcion registraba en bitacora al
    // conductor equivocado en vez de al dueno real del manifiesto.
    .eq("driver_id", driverId)
    .maybeSingle();

  if (errorLeer) {
    throw new Error(`Error al leer el manifiesto: ${errorLeer.message}`);
  }

  if (!actual) {
    throw new ErrorConflicto(
      `El manifiesto '${manifiestoId}' no existe, no pertenece al tenant o no es del conductor indicado`,
    );
  }

  if (actual.estado !== "en_ruta") {
    throw new ErrorConflicto(
      `No se puede completar el manifiesto: estado actual '${actual.estado}' (se requiere 'en_ruta')`,
    );
  }

  // Bitácora ANTES del UPDATE (CLAUDE.md).
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId: actorUsuarioId ?? null,
    actorTipo: "usuario",
    accion: "manifiesto.completado",
    entidadTipo: "manifiesto",
    entidadId: manifiestoId,
    detalle: {
      driver_id: driverId,
      fecha_operacion: actual.fecha_operacion,
    },
  });

  const ahora = new Date().toISOString();

  const { data: completado, error: errorUpdate } = await cliente
    .from("manifiestos")
    .update({
      estado: "completado",
      completado_en: ahora,
    })
    .eq("id", manifiestoId)
    .eq("tenant_id", tenantId)
    .select()
    .single();

  if (errorUpdate || !completado) {
    throw new Error(`Error al completar el manifiesto: ${errorUpdate?.message ?? "sin datos"}`);
  }

  return filaAManifiesto(completado);
}

// =============================================================================
// obtenerManifiestoActivo
// =============================================================================

/**
 * Obtiene el manifiesto activo (estado 'confirmado' o 'en_ruta') de un conductor
 * para una fecha dada.
 * Devuelve null si no existe.
 */
export async function obtenerManifiestoActivo(
  cliente: SupabaseClient,
  tenantId: string,
  conductorId: string,
  fecha: Date,
): Promise<Manifiesto | null> {
  const fechaStr = fechaLocalEnSantiago(fecha);

  const { data, error } = await cliente
    .from("manifiestos")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("driver_id", conductorId)
    .eq("fecha_operacion", fechaStr)
    .in("estado", ["confirmado", "en_ruta"])
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener manifiesto activo: ${error.message}`);
  }

  return data ? filaAManifiesto(data) : null;
}
