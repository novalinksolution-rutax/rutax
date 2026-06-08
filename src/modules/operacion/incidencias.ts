/**
 * Módulo de incidencias — apertura, actualización y consulta.
 *
 * Reglas de negocio implementadas:
 * 1. Idempotencia de apertura: si ya existe una incidencia abierta (estado IN
 *    'abierta' | 'en_gestion') para el mismo pedido_id, se devuelve la existente
 *    sin crear una nueva. Los jobs pueden llamar abrirIncidencia varias veces.
 * 2. afecta_cobro / afecta_liquidacion se fijan según el tipo al abrir.
 * 3. Para aperturas manuales (esAccionManual=true): se valida RBAC y se registra
 *    en bitácora.
 * 4. El módulo usa el cliente service_role — escrituras desde jobs y server
 *    actions autorizadas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Incidencia, AbrirIncidenciaEntrada, ActualizarIncidenciaEntrada, TipoIncidencia } from "./tipos";
import { ErrorPedidoNoEncontrado } from "./errores";
import { ErrorValidacion, ErrorConflicto } from "@/modules/identidad/errores";
import { puedeGestionarIncidencias } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

// =============================================================================
// Reglas de afectación por tipo de incidencia
// =============================================================================
// Fuente: §2.5 nota de dominio + §3 invariante 4 del doc de arquitectura.

interface ReglaAfectacion {
  afectaCobro: boolean;
  afectaLiquidacion: boolean;
}

function resolverAfectacion(tipo: TipoIncidencia): ReglaAfectacion {
  switch (tipo) {
    case "reagendado":
      // El pedido se reagenda → afecta cobro (timing/descuento) pero NO la
      // liquidación del conductor (que igual salió a intentar la entrega).
      return { afectaCobro: true, afectaLiquidacion: false };

    case "destinatario_ausente":
    case "rechazo_destinatario":
      // No se completó la entrega por causas del destinatario → tanto cobro
      // como liquidación se ven afectados (puede aplicar tarifa reducida).
      return { afectaCobro: true, afectaLiquidacion: true };

    case "paquete_danado":
      // El paquete llegó dañado → afecta ambos (responsabilidad y costos).
      return { afectaCobro: true, afectaLiquidacion: true };

    // Todos los demás tipos (direccion_erronea, problema_acceso, otro):
    // por defecto ambos = true (el caso más conservador, Fase C puede
    // refinar si necesita excepciones).
    default:
      return { afectaCobro: true, afectaLiquidacion: true };
  }
}

// =============================================================================
// Mapper de fila de BD → interfaz Incidencia
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAIncidencia(fila: Record<string, any>): Incidencia {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    pedidoId: fila.pedido_id,
    sellerId: fila.seller_id,
    tipo: fila.tipo,
    estado: fila.estado,
    descripcion: fila.descripcion ?? null,
    notasResolucion: fila.notas_resolucion ?? null,
    afectaCobro: fila.afecta_cobro,
    afectaLiquidacion: fila.afecta_liquidacion,
    abiertaPorUsuarioId: fila.abierta_por_usuario_id ?? null,
    resueltaPorUsuarioId: fila.resuelta_por_usuario_id ?? null,
    abiertaEn: fila.abierta_en,
    resueltaEn: fila.resuelta_en ?? null,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

// =============================================================================
// Operaciones públicas
// =============================================================================

/**
 * Abre una incidencia para un pedido.
 *
 * Idempotente: si ya existe una con estado 'abierta' o 'en_gestion' para el
 * mismo pedido_id, devuelve la existente sin abrir una nueva.
 *
 * Para aperturas manuales (esAccionManual=true): verifica RBAC del actor y
 * registra en bitácora.
 */
export async function abrirIncidencia(
  cliente: SupabaseClient,
  entrada: AbrirIncidenciaEntrada,
  actor?: UsuarioActual,
): Promise<Incidencia> {
  // Validación RBAC para acciones manuales.
  if (entrada.esAccionManual) {
    if (!actor) {
      throw new ErrorValidacion(
        "Se requiere el actor para abrir una incidencia manualmente",
      );
    }
    if (!puedeGestionarIncidencias(actor)) {
      throw new ErrorValidacion(
        "El usuario no tiene capacidad para gestionar incidencias (se requiere supervisor o dueño)",
      );
    }
  }

  // Idempotencia: buscar incidencia abierta existente para el mismo pedido.
  const { data: existentes, error: errorBusqueda } = await cliente
    .from("incidencias")
    .select("*")
    .eq("pedido_id", entrada.pedidoId)
    .eq("tenant_id", entrada.tenantId)
    .in("estado", ["abierta", "en_gestion"])
    .limit(1);

  if (errorBusqueda) {
    throw new Error(`Error al buscar incidencias existentes: ${errorBusqueda.message}`);
  }

  if (existentes && existentes.length > 0) {
    // Incidencia abierta existente — devolver sin duplicar.
    return filaAIncidencia(existentes[0]);
  }

  // Verificar que el pedido existe y pertenece al tenant.
  const { data: pedido, error: errorPedido } = await cliente
    .from("pedidos")
    .select("id, seller_id")
    .eq("id", entrada.pedidoId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (errorPedido) {
    throw new Error(`Error al verificar el pedido: ${errorPedido.message}`);
  }

  if (!pedido) {
    throw new ErrorPedidoNoEncontrado(entrada.pedidoId);
  }

  const { afectaCobro, afectaLiquidacion } = resolverAfectacion(entrada.tipo);

  const { data: nueva, error: errorInsert } = await cliente
    .from("incidencias")
    .insert({
      tenant_id: entrada.tenantId,
      pedido_id: entrada.pedidoId,
      seller_id: pedido.seller_id,
      tipo: entrada.tipo,
      estado: "abierta",
      descripcion: entrada.descripcion ?? null,
      afecta_cobro: afectaCobro,
      afecta_liquidacion: afectaLiquidacion,
      abierta_por_usuario_id: entrada.abiertaPorUsuarioId ?? null,
    })
    .select()
    .single();

  if (errorInsert || !nueva) {
    throw new Error(`Error al abrir la incidencia: ${errorInsert?.message ?? "sin datos"}`);
  }

  const incidencia = filaAIncidencia(nueva);

  // Bitácora para acciones manuales.
  if (entrada.esAccionManual && actor) {
    await registrarEnBitacora(cliente, {
      tenantId: entrada.tenantId,
      actorUsuarioId: entrada.abiertaPorUsuarioId ?? null,
      actorTipo: "usuario",
      accion: "incidencia.abierta_manual",
      entidadTipo: "incidencia",
      entidadId: incidencia.id,
      detalle: {
        pedido_id: entrada.pedidoId,
        tipo: entrada.tipo,
        afecta_cobro: afectaCobro,
        afecta_liquidacion: afectaLiquidacion,
      },
    });
  }

  return incidencia;
}

/**
 * Actualiza el estado o las notas de resolución de una incidencia.
 * Solo puede ejecutarse con actores internos o service_role.
 */
export async function actualizarIncidencia(
  cliente: SupabaseClient,
  entrada: ActualizarIncidenciaEntrada,
  actor?: UsuarioActual,
): Promise<Incidencia> {
  if (actor && !puedeGestionarIncidencias(actor)) {
    throw new ErrorValidacion(
      "El usuario no tiene capacidad para gestionar incidencias",
    );
  }

  // Verificar que la incidencia pertenece al tenant.
  const { data: actual, error: errorBusqueda } = await cliente
    .from("incidencias")
    .select("*")
    .eq("id", entrada.incidenciaId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (errorBusqueda) {
    throw new Error(`Error al obtener la incidencia: ${errorBusqueda.message}`);
  }

  if (!actual) {
    throw new ErrorConflicto(
      `La incidencia '${entrada.incidenciaId}' no existe o no pertenece al tenant`,
    );
  }

  const cambios: Record<string, unknown> = {};
  if (entrada.estado !== undefined) cambios.estado = entrada.estado;
  if (entrada.notasResolucion !== undefined) cambios.notas_resolucion = entrada.notasResolucion;
  if (entrada.resueltaPorUsuarioId !== undefined) {
    cambios.resuelta_por_usuario_id = entrada.resueltaPorUsuarioId;
  }
  if (entrada.estado === "resuelta" || entrada.estado === "cerrada") {
    cambios.resuelta_en = new Date().toISOString();
  }

  const { data: actualizada, error: errorUpdate } = await cliente
    .from("incidencias")
    .update(cambios)
    .eq("id", entrada.incidenciaId)
    .eq("tenant_id", entrada.tenantId)
    .select()
    .single();

  if (errorUpdate || !actualizada) {
    throw new Error(`Error al actualizar la incidencia: ${errorUpdate?.message ?? "sin datos"}`);
  }

  return filaAIncidencia(actualizada);
}

/**
 * Lista todas las incidencias de un pedido, ordenadas por fecha de apertura desc.
 */
export async function listarIncidenciasDePedido(
  cliente: SupabaseClient,
  pedidoId: string,
  tenantId: string,
): Promise<Incidencia[]> {
  const { data, error } = await cliente
    .from("incidencias")
    .select("*")
    .eq("pedido_id", pedidoId)
    .eq("tenant_id", tenantId)
    .order("abierta_en", { ascending: false });

  if (error) {
    throw new Error(`Error al listar incidencias: ${error.message}`);
  }

  return (data ?? []).map(filaAIncidencia);
}
