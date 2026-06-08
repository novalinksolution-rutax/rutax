/**
 * Operaciones sobre pedidos — obtener, listar, actualizar estado, crear same-day.
 *
 * Reglas de negocio implementadas:
 * 1. Optimistic locking en actualizarEstadoPedido: si el estado actual en BD
 *    difiere de estadoEsperado → ErrorConflicto (condición de carrera resuelta,
 *    el job termina sin reintento).
 * 2. validarTransicion se llama ANTES del UPDATE.
 * 3. Transición a 'fallido' o 'fallido_manual' abre incidencia automáticamente
 *    si no hay una abierta (via abrirIncidencia — idempotente).
 * 4. Correcciones manuales (ejecutor='interno'): verificar RBAC y registrar
 *    en bitácora con accion='pedido.estado_corregido_manual'.
 * 5. crearPedidoSameDay: busca la tarifa vigente para el seller y la fija en
 *    tarifa_aplicable_id. Si no hay tarifa → ErrorValidacion.
 *
 * Este módulo usa el cliente service_role directamente.
 * NUNCA importa de `dinero`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Pedido,
  FiltrosPedidos,
  PaginadoPedidos,
  ActualizarEstadoEntrada,
  CrearPedidoSameDayEntrada,
  EstadoPedido,
} from "./tipos";
import { ErrorPedidoNoEncontrado } from "./errores";
import { ErrorValidacion, ErrorConflicto } from "@/modules/identidad/errores";
import { puedeAjustarOperacionDiaria } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { validarTransicion } from "./maquina-estados";
import { abrirIncidencia } from "./incidencias";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

// =============================================================================
// Mapper de fila de BD → interfaz Pedido
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAPedido(fila: Record<string, any>): Pedido {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    sellerId: fila.seller_id,
    tipoPedido: fila.tipo_pedido,
    origen: fila.origen,
    mlOrderId: fila.ml_order_id ?? null,
    mlShipmentId: fila.ml_shipment_id ?? null,
    estado: fila.estado,
    estadoMl: fila.estado_ml ?? null,
    subestadoMl: fila.subestado_ml ?? null,
    ultimaSyncMlEn: fila.ultima_sync_ml_en ?? null,
    driverIdAsignado: fila.driver_id_asignado ?? null,
    destinatarioNombre: fila.destinatario_nombre,
    destinatarioDireccion: fila.destinatario_direccion,
    destinatarioComuna: fila.destinatario_comuna,
    destinatarioTelefono: fila.destinatario_telefono ?? null,
    instruccionesEntrega: fila.instrucciones_entrega ?? null,
    fechaCompromiso: fila.fecha_compromiso ?? null,
    tarifaAplicableId: fila.tarifa_aplicable_id ?? null,
    montoCobroClp: fila.monto_cobro_clp ?? null,
    montoLiquidacionClp: fila.monto_liquidacion_clp ?? null,
    cobroGenerado: fila.cobro_generado ?? false,
    liquidacionGenerada: fila.liquidacion_generada ?? false,
    notasInternas: fila.notas_internas ?? null,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

// =============================================================================
// obtenerPedido
// =============================================================================

/**
 * Obtiene un pedido por ID, dentro del tenant.
 * Devuelve null si no existe (no lanza — el llamador decide).
 */
export async function obtenerPedido(
  cliente: SupabaseClient,
  pedidoId: string,
  tenantId: string,
): Promise<Pedido | null> {
  const { data, error } = await cliente
    .from("pedidos")
    .select("*")
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener pedido: ${error.message}`);
  }

  return data ? filaAPedido(data) : null;
}

// =============================================================================
// listarPedidos
// =============================================================================

export async function listarPedidos(
  cliente: SupabaseClient,
  filtros: FiltrosPedidos,
): Promise<PaginadoPedidos> {
  const pagina = filtros.pagina ?? 1;
  const limite = filtros.limite ?? 50;
  const offset = (pagina - 1) * limite;

  let query = cliente
    .from("pedidos")
    .select("*", { count: "exact" })
    .eq("tenant_id", filtros.tenantId);

  if (filtros.sellerId) query = query.eq("seller_id", filtros.sellerId);
  if (filtros.conductorId) query = query.eq("driver_id_asignado", filtros.conductorId);
  if (filtros.estado) query = query.eq("estado", filtros.estado);
  if (filtros.fecha) query = query.eq("fecha_compromiso", filtros.fecha);

  query = query
    .order("creado_en", { ascending: false })
    .range(offset, offset + limite - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Error al listar pedidos: ${error.message}`);
  }

  return {
    datos: (data ?? []).map(filaAPedido),
    total: count ?? 0,
    pagina,
    limite,
  };
}

// =============================================================================
// actualizarEstadoPedido
// =============================================================================

/**
 * Actualiza el estado de un pedido aplicando:
 * - Optimistic locking (estadoEsperado).
 * - Validación de la máquina de estados.
 * - Apertura automática de incidencia al llegar a 'fallido' o 'fallido_manual'.
 * - Bitácora y RBAC para correcciones manuales.
 */
export async function actualizarEstadoPedido(
  cliente: SupabaseClient,
  entrada: ActualizarEstadoEntrada,
  actor?: UsuarioActual,
): Promise<Pedido> {
  // 1. Verificar RBAC para correcciones manuales.
  if (entrada.ejecutor === "interno") {
    if (!actor) {
      throw new ErrorValidacion(
        "Se requiere el actor para ejecutar una corrección manual de estado",
      );
    }
    if (!puedeAjustarOperacionDiaria(actor)) {
      throw new ErrorValidacion(
        "El usuario no tiene capacidad para ajustar el estado de pedidos manualmente",
      );
    }
    if (!entrada.motivo || entrada.motivo.trim().length === 0) {
      throw new ErrorValidacion(
        "Se requiere un motivo para correcciones manuales de estado (RF-029)",
      );
    }
  }

  // 2. Leer estado actual del pedido — con aislamiento de tenant.
  const { data: pedidoActual, error: errorLectura } = await cliente
    .from("pedidos")
    .select("id, estado, seller_id, tenant_id")
    .eq("id", entrada.pedidoId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (errorLectura) {
    throw new Error(`Error al leer el pedido: ${errorLectura.message}`);
  }

  if (!pedidoActual) {
    throw new ErrorPedidoNoEncontrado(entrada.pedidoId);
  }

  const estadoActual: EstadoPedido = pedidoActual.estado;

  // 3. Optimistic locking: el estado actual debe coincidir con el esperado.
  // Si difiere → condición de carrera resuelta. El job que llama debe capturar
  // ErrorConflicto y terminar sin reintento (no es un fallo real).
  if (estadoActual !== entrada.estadoEsperado) {
    throw new ErrorConflicto(
      `Conflicto de optimistic locking: estado actual '${estadoActual}' difiere del esperado '${entrada.estadoEsperado}'. ` +
        `Otra actualización llegó primero. Terminar sin reintento.`,
    );
  }

  // 4. Validar transición (función pura — lanza ErrorTransicionInvalida si no es válida).
  validarTransicion(estadoActual, entrada.estadoNuevo, entrada.ejecutor);

  // 5. Ejecutar el UPDATE.
  const { data: pedidoActualizado, error: errorUpdate } = await cliente
    .from("pedidos")
    .update({
      estado: entrada.estadoNuevo,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", entrada.pedidoId)
    .eq("tenant_id", entrada.tenantId)
    .eq("estado", entrada.estadoEsperado) // guarda adicional a nivel de BD
    .select()
    .single();

  if (errorUpdate) {
    throw new Error(`Error al actualizar estado del pedido: ${errorUpdate.message}`);
  }

  if (!pedidoActualizado) {
    // El UPDATE no afectó filas — otro proceso cambió el estado entre nuestro
    // SELECT y el UPDATE. Tratamos como condición de carrera resuelta.
    throw new ErrorConflicto(
      `No se pudo actualizar el pedido '${entrada.pedidoId}': el estado cambió antes del UPDATE (carrera).`,
    );
  }

  const pedido = filaAPedido(pedidoActualizado);

  // 6. Si el nuevo estado es 'fallido' o 'fallido_manual', abrir incidencia
  //    automáticamente si no hay una abierta (abrirIncidencia es idempotente).
  if (entrada.estadoNuevo === "fallido" || entrada.estadoNuevo === "fallido_manual") {
    await abrirIncidencia(cliente, {
      tenantId: entrada.tenantId,
      pedidoId: entrada.pedidoId,
      sellerId: pedidoActual.seller_id,
      tipo: "otro", // tipo genérico al abrir automáticamente — el supervisor la refina
      descripcion:
        entrada.estadoNuevo === "fallido_manual"
          ? `Fallo manual registrado. Motivo: ${entrada.motivo ?? "no especificado"}`
          : "Fallo de entrega reportado por ML",
      abiertaPorUsuarioId: entrada.actuadoPorUsuarioId ?? undefined,
      esAccionManual: false, // apertura automática — no requiere RBAC adicional
    });
  }

  // 7. Bitácora para correcciones manuales (ejecutor='interno').
  if (entrada.ejecutor === "interno" && actor) {
    await registrarEnBitacora(cliente, {
      tenantId: entrada.tenantId,
      actorUsuarioId: entrada.actuadoPorUsuarioId ?? null,
      actorTipo: "usuario",
      accion: "pedido.estado_corregido_manual",
      entidadTipo: "pedido",
      entidadId: entrada.pedidoId,
      detalle: {
        estado_anterior: estadoActual,
        estado_nuevo: entrada.estadoNuevo,
        motivo: entrada.motivo,
      },
    });
  }

  return pedido;
}

// =============================================================================
// crearPedidoSameDay
// =============================================================================

/**
 * Crea un pedido same-day ad-hoc.
 *
 * Busca la tarifa vigente para el seller (o la tarifa por defecto del tenant)
 * y la fija en tarifa_aplicable_id. Si no hay tarifa configurada, lanza
 * ErrorValidacion con mensaje orientativo.
 */
export async function crearPedidoSameDay(
  cliente: SupabaseClient,
  entrada: CrearPedidoSameDayEntrada,
): Promise<Pedido> {
  // Buscar tarifa vigente: primero específica del seller, luego por defecto del tenant.
  // Ordenar por vigente_desde desc, tomar la primera cuya vigente_desde <= today.
  const hoy = new Date().toISOString().split("T")[0]; // 'YYYY-MM-DD'

  const { data: tarifas, error: errorTarifa } = await cliente
    .from("tarifas")
    .select("id")
    .eq("tenant_id", entrada.tenantId)
    .eq("tipo_entrega", "same_day")
    .eq("estado", "activa")
    .lte("vigente_desde", hoy)
    .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoy}`)
    .or(`seller_id.eq.${entrada.sellerId},seller_id.is.null`)
    .order("seller_id", { ascending: false, nullsFirst: false }) // seller específico primero
    .order("vigente_desde", { ascending: false })
    .limit(1);

  if (errorTarifa) {
    throw new Error(`Error al buscar tarifa vigente: ${errorTarifa.message}`);
  }

  if (!tarifas || tarifas.length === 0) {
    throw new ErrorValidacion(
      "El seller no tiene una tarifa configurada para entregas same-day — " +
        "configúrala en /onboarding/tarifas antes de crear pedidos",
    );
  }

  const tarifaAplicableId: string = tarifas[0].id;

  // Crear el pedido.
  const { data: nuevo, error: errorInsert } = await cliente
    .from("pedidos")
    .insert({
      tenant_id: entrada.tenantId,
      seller_id: entrada.sellerId,
      tipo_pedido: "same_day",
      origen: "same_day_manual",
      estado: "pendiente_asignacion",
      destinatario_nombre: entrada.destinatarioNombre,
      destinatario_direccion: entrada.destinatarioDireccion,
      destinatario_comuna: entrada.destinatarioComuna,
      destinatario_telefono: entrada.destinatarioTelefono ?? null,
      instrucciones_entrega: entrada.instruccionesEntrega ?? null,
      fecha_compromiso: entrada.fechaCompromiso ?? null,
      notas_internas: entrada.notasInternas ?? null,
      tarifa_aplicable_id: tarifaAplicableId,
    })
    .select()
    .single();

  if (errorInsert || !nuevo) {
    throw new Error(`Error al crear el pedido same-day: ${errorInsert?.message ?? "sin datos"}`);
  }

  return filaAPedido(nuevo);
}
