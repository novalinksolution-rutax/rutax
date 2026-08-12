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
  ResultadoCrearPedidoSameDay,
  EstadoPedido,
  EstadoGeocoding,
  CoberturaEstado,
  SituacionRetiro,
} from "./tipos";
import { resolverComunaCanonica } from "@/modules/integraciones/geocoding/normalizacion";
import { ahoraEnSantiago, combinarFechaHoraSantiago, horaAMinutos } from "@/lib/fecha-santiago";
import { resolverZona } from "./zonas";
import { resolverVentanaCorte } from "./ventanas-corte";
import { ErrorPedidoNoEncontrado } from "./errores";
import { ErrorValidacion, ErrorConflicto } from "@/modules/identidad/errores";
import { puedeAjustarOperacionDiaria, puedeMarcarEvidenciasPropias } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { validarTransicion } from "./maquina-estados";
import { abrirIncidencia, actualizarIncidencia } from "./incidencias";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import { inngest } from "@/lib/inngest/cliente";
import { generarCodigoInterno } from "./codigo-interno";

/** Máximo de intentos al generar `codigo_interno` ante colisión (unique_violation, 23505). */
const MAX_INTENTOS_CODIGO_INTERNO = 5;

/**
 * Estados de pedido financieramente relevantes: al transicionar a cualquiera
 * de estos estados, `actualizarEstadoPedido` publica el evento
 * `dinero/pedido.estado_financiero_relevante` post-commit (best-effort).
 */
const ESTADOS_FINANCIEROS = new Set<EstadoPedido>([
  'entregado',
  'entregado_manual',
  'fallido',
  'fallido_manual',
  'devuelto',
  'cancelado',
]);

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
    // Columnas de geocoding (migración 0013 — F4, ítem 1.1)
    lat: fila.lat ?? null,
    long: fila.long ?? null,
    geoEstado: (fila.geo_estado ?? 'pendiente') as EstadoGeocoding,
    geoConfianza: fila.geo_confianza ?? null,
    geocodificadoEn: fila.geocodificado_en ?? null,
    coberturaEstado: (fila.cobertura_estado ?? 'pendiente') as CoberturaEstado,
    // Columnas de SLA/corte (migración 0014 — F7, ítem 1.2)
    fechaCompromisoHora: fila.fecha_compromiso_hora ?? null,
    corteRiesgo: fila.corte_riesgo ?? false,
    slaCumplido: fila.sla_cumplido ?? null,
    // Columnas de tracking same-day (migración 0016 — Bloque 2)
    trackingToken: fila.tracking_token ?? null,
    // Código interno operativo para etiqueta con QR (same-day).
    codigoInterno: fila.codigo_interno ?? null,
    // Situación de retiro (migración 20260812000002). El fallback a 'pendiente'
    // cuando la columna no viene en el SELECT es deliberado y falla CERRADO: un
    // pedido cuya tenencia se desconoce NO se ofrece para asignar. Caer a
    // 'retirado' abriría la compuerta que este campo existe para cerrar.
    situacionRetiro: (fila.situacion_retiro ?? 'pendiente') as SituacionRetiro,
    retiradoEn: fila.retirado_en ?? null,
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
  if (filtros.comuna) {
    // `ilike` y no `eq`: `destinatario_comuna` guarda el texto tal como llegó de
    // la fuente, y el mismo lugar aparece como «Ñuñoa» o «ÑUÑOA» según venga de
    // ML o de una carga manual. La forma canónica se resuelve al ingestar, pero
    // el histórico no se reescribe.
    //
    // ⚠️ Lo que `ilike` NO resuelve son los acentos: «Nunoa» sin tilde no
    // empareja con «Ñuñoa». Es una limitación conocida y acotada — el enlace de
    // la Torre siempre manda el nombre canónico, así que solo afecta a filas con
    // comuna mal escrita en origen, que es un problema de calidad de dato y no
    // de este filtro.
    query = query.ilike("destinatario_comuna", filtros.comuna);
  }

  if (filtros.porRevisar) {
    // Bandeja de revisión geocoding: geo_estado problemático OR cobertura sin tarifa/revisión.
    // Usamos .or() con la sintaxis de PostgREST (comas para AND dentro del grupo).
    query = query.or(
      "geo_estado.in.(no_resuelto,fuera_cobertura),cobertura_estado.in.(requiere_revision,sin_tarifa_zona)",
    );
  } else {
    if (filtros.estado) query = query.eq("estado", filtros.estado);
    if (filtros.fecha) query = query.eq("fecha_compromiso", filtros.fecha);
  }

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
  // 1. Verificar RBAC según el tipo de ejecutor.
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

  if (entrada.ejecutor === "conductor") {
    if (!actor) {
      throw new ErrorValidacion(
        "Se requiere el actor (conductor autenticado) para ejecutar esta transición",
      );
    }
    if (!puedeMarcarEvidenciasPropias(actor)) {
      throw new ErrorValidacion(
        "El usuario no tiene capacidad de conductor para marcar evidencias propias",
      );
    }
    // La barrera same-day y la verificación de asignación se aplican DESPUÉS de
    // leer el pedido (paso 2), ya que necesitamos tipo_pedido y driver_id_asignado.
  }

  // 2. Leer estado actual del pedido — con aislamiento de tenant.
  // Se incluyen las columnas necesarias para el evento financiero post-commit
  // y para la proyección de sla_cumplido (fecha_compromiso_hora).
  const { data: pedidoActual, error: errorLectura } = await cliente
    .from("pedidos")
    .select("id, estado, seller_id, tenant_id, driver_id_asignado, tipo_pedido, tarifa_aplicable_id, fecha_compromiso_hora, fecha_compromiso")
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

  // 2b. FRONTERA DURA: si el ejecutor es 'conductor', aplicar las restricciones
  //     same-day ANTES de validarTransicion. El conductor NUNCA actúa sobre Flex.
  if (entrada.ejecutor === "conductor") {
    // Solo pedidos same-day: los Flex los gobierna la app de Mercado Envíos Flex.
    if (pedidoActual.tipo_pedido !== "same_day") {
      throw new ErrorValidacion(
        "El conductor solo opera pedidos same-day; los Flex los reporta Mercado Libre.",
      );
    }
    // Solo pedidos asignados al propio conductor.
    if (pedidoActual.driver_id_asignado !== actor!.driverId) {
      throw new ErrorValidacion(
        "El conductor solo puede actuar sobre pedidos asignados a él.",
      );
    }
    // Si el nuevo estado es 'entregado', debe existir un POD válido (es_valido=true).
    if (entrada.estadoNuevo === "entregado") {
      const { data: podValido } = await cliente
        .from("pruebas_entrega")
        .select("id")
        .eq("pedido_id", entrada.pedidoId)
        .eq("tenant_id", entrada.tenantId)
        .eq("tipo_resultado", "entregado")
        .eq("es_valido", true)
        .limit(1)
        .maybeSingle();

      if (!podValido) {
        throw new ErrorValidacion(
          "No se puede cerrar la entrega sin prueba de entrega válida: falta foto o la ubicación no coincide con el destino.",
        );
      }
    }
    // Si el nuevo estado es 'fallido', exigir tipo_incidencia en la entrada.
    if (entrada.estadoNuevo === "fallido") {
      if (!entrada.tipoIncidenciaConductor) {
        throw new ErrorValidacion(
          "Se requiere el tipo de incidencia para registrar un fallo de entrega.",
        );
      }
    }
  }

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

  // 4b. Proyección de sla_cumplido (F7, ítem 1.2).
  // Al transicionar a un estado terminal se evalúa el SLA:
  //   - entregado / entregado_manual + fecha_compromiso_hora existe + entrega a tiempo
  //     → sla_cumplido = true
  //   - cualquier terminal exitoso pero tardío, o estado fallido/devuelto/cancelado
  //     → sla_cumplido = false
  //   - sin fecha_compromiso_hora ni fecha_compromiso → null (no evaluable)
  // La proyección es barata: un campo en el mismo UPDATE — sin job nuevo.
  const ahora = new Date();
  let slaCumplido: boolean | null = null;

  const ESTADOS_EXITOSOS_TERMINALES = new Set<EstadoPedido>(['entregado', 'entregado_manual']);
  const ESTADOS_NO_EXITOSOS_TERMINALES = new Set<EstadoPedido>(['fallido', 'fallido_manual', 'devuelto', 'cancelado']);

  if (ESTADOS_EXITOSOS_TERMINALES.has(entrada.estadoNuevo)) {
    const fechaCompromisoHora = pedidoActual.fecha_compromiso_hora as string | null;
    if (fechaCompromisoHora) {
      slaCumplido = ahora <= new Date(fechaCompromisoHora);
    } else if (pedidoActual.fecha_compromiso as string | null) {
      // Fallback: si hay fecha_compromiso (date) pero no timestamptz, comparar al final del día.
      // Usamos la medianoche del día de compromiso (fin del día = 23:59:59 Santiago).
      // Conservador: no se puede evaluar hora exacta → null.
      slaCumplido = null;
    }
    // else: sin ninguna referencia → null
  } else if (ESTADOS_NO_EXITOSOS_TERMINALES.has(entrada.estadoNuevo)) {
    // Estado no exitoso: SLA incumplido si había compromiso horario configurado.
    const fechaCompromisoHora = pedidoActual.fecha_compromiso_hora as string | null;
    slaCumplido = fechaCompromisoHora ? false : null;
  }

  // 5. Bitácora ANTES del UPDATE (CLAUDE.md: "bitácora antes que efectos externos").
  // Cualquier acción de usuario queda registrada incluso si el UPDATE posterior falla.
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

  if (entrada.ejecutor === "conductor" && actor) {
    await registrarEnBitacora(cliente, {
      tenantId: entrada.tenantId,
      actorUsuarioId: entrada.actuadoPorUsuarioId ?? null,
      actorTipo: "usuario",
      accion: "pedido.estado_actualizado_conductor",
      entidadTipo: "pedido",
      entidadId: entrada.pedidoId,
      detalle: {
        estado_anterior: estadoActual,
        estado_nuevo: entrada.estadoNuevo,
        // No incluir foto_path, lat/long ni datos personales en bitácora.
        tipo_incidencia: entrada.tipoIncidenciaConductor ?? null,
      },
    });
  }

  // 6. Ejecutar el UPDATE.
  const updatePayload: Record<string, unknown> = {
    estado: entrada.estadoNuevo,
    actualizado_en: ahora.toISOString(),
  };

  // Solo escribir sla_cumplido si se pudo evaluar (no dejar null sobre un valor ya evaluado).
  if (slaCumplido !== null) {
    updatePayload.sla_cumplido = slaCumplido;
  }

  const { data: pedidoActualizado, error: errorUpdate } = await cliente
    .from("pedidos")
    .update(updatePayload)
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

  // 7a. Si el nuevo estado es 'fallido' o 'fallido_manual', abrir incidencia
  //     automáticamente si no hay una abierta (abrirIncidencia es idempotente).
  if (entrada.estadoNuevo === "fallido" || entrada.estadoNuevo === "fallido_manual") {
    // El conductor puede declarar el tipo de incidencia al registrar su fallo.
    const tipoIncidencia =
      entrada.ejecutor === "conductor" && entrada.tipoIncidenciaConductor
        ? entrada.tipoIncidenciaConductor
        : "otro"; // tipo genérico al abrir automáticamente — el supervisor la refina

    const descripcionIncidencia =
      entrada.estadoNuevo === "fallido_manual"
        ? `Fallo manual registrado. Motivo: ${entrada.motivo ?? "no especificado"}`
        : entrada.ejecutor === "conductor"
          ? `Fallo de entrega reportado por el conductor. Tipo: ${tipoIncidencia}`
          : "Fallo de entrega reportado por ML";

    await abrirIncidencia(cliente, {
      tenantId: entrada.tenantId,
      pedidoId: entrada.pedidoId,
      sellerId: pedidoActual.seller_id,
      tipo: tipoIncidencia,
      descripcion: descripcionIncidencia,
      abiertaPorUsuarioId: entrada.actuadoPorUsuarioId ?? undefined,
      esAccionManual: false, // apertura automática — no requiere RBAC adicional
    });
  }

  // 7b. Al transicionar a 'devuelto' DESDE 'fallido'/'fallido_manual', la incidencia
  //     abierta por el fallo ya no aplica — el paquete fue devuelto al origen.
  //     Se resuelve la incidencia abierta (idempotente: actualizarIncidencia lanza
  //     ErrorConflicto si ya está resuelta/cerrada → la capturamos como no-op).
  if (
    entrada.estadoNuevo === "devuelto" &&
    (estadoActual === "fallido" || estadoActual === "fallido_manual")
  ) {
    // Bitácora de la resolución de incidencia ANTES del efecto (CLAUDE.md).
    await registrarEnBitacora(cliente, {
      tenantId: entrada.tenantId,
      actorUsuarioId: entrada.actuadoPorUsuarioId ?? null,
      actorTipo: entrada.ejecutor === "interno" ? "usuario" : "sistema",
      accion: "incidencia.resuelta_por_devolucion",
      entidadTipo: "pedido",
      entidadId: entrada.pedidoId,
      detalle: {
        estado_anterior: estadoActual,
        motivo: "Paquete devuelto al origen",
      },
    });

    // Buscar la incidencia abierta del pedido para resolverla.
    const { data: incidenciasAbiertas } = await cliente
      .from("incidencias")
      .select("id, estado")
      .eq("pedido_id", entrada.pedidoId)
      .eq("tenant_id", entrada.tenantId)
      .in("estado", ["abierta", "en_gestion"])
      .limit(1);

    if (incidenciasAbiertas && incidenciasAbiertas.length > 0) {
      const incidencia = incidenciasAbiertas[0];
      try {
        await actualizarIncidencia(cliente, {
          incidenciaId: incidencia.id as string,
          tenantId: entrada.tenantId,
          estado: "resuelta",
          notasResolucion: "Paquete devuelto al origen",
          resueltaPorUsuarioId: entrada.actuadoPorUsuarioId ?? undefined,
        });
      } catch {
        // Si ya estaba resuelta/cerrada (inmutable) — no-op.
        // La bitácora ya quedó registrada arriba.
      }
    }
  }

  // 8. Post-commit: publicar evento financiero si el nuevo estado es relevante.
  // Es best-effort — un fallo de Inngest NO debe bloquear la transición de estado.
  // El pedido ya está en el nuevo estado en BD independientemente del motor de dinero.
  // Si el evento no llega, el job C6 (conciliación) lo detectará y generará un
  // evento de conciliación para resolución manual.
  if (ESTADOS_FINANCIEROS.has(entrada.estadoNuevo)) {
    try {
      await inngest.send({
        name: 'dinero/pedido.estado_financiero_relevante',
        // Incluir estadoNuevo en el id para que cada transición financiera sea
        // un evento distinto. Sin el estado, el segundo evento del mismo pedido
        // (devuelto tras fallido) sería deduplicado por Inngest y el motor nunca
        // ejecutaría la anulación de líneas. La idempotencia real (no duplicar
        // líneas) la sigue garantizando el UNIQUE(pedido_id) en BD.
        id: `pedido-financiero-${entrada.pedidoId}-${entrada.estadoNuevo}`,
        data: {
          pedidoId: entrada.pedidoId,
          tenantId: entrada.tenantId,
          sellerId: pedidoActual.seller_id as string,
          driverIdAsignado: (pedidoActual.driver_id_asignado as string | null) ?? null,
          estadoNuevo: entrada.estadoNuevo as 'entregado' | 'entregado_manual' | 'fallido' | 'fallido_manual' | 'devuelto' | 'cancelado',
          estadoAnterior: estadoActual,
          fechaTransicion: new Date().toISOString(),
          tipoPedido: pedidoActual.tipo_pedido as 'flex' | 'same_day',
          tarifaAplicableId: (pedidoActual.tarifa_aplicable_id as string | null) ?? null,
        },
      });
    } catch {
      // El evento es best-effort post-commit. Si falla, el job C6 lo detectará
      // por conciliación. NUNCA relanzar — el pedido ya está en su nuevo estado.
    }
  }

  return pedido;
}

// =============================================================================
// crearPedidoSameDay
// =============================================================================

/**
 * Crea un pedido same-day ad-hoc.
 *
 * Regla dura de corte (F7, ítem 1.2):
 * - Resuelve la zona de la comuna y la ventana de corte aplicable.
 * - Si hay ventana configurada y la hora actual (local Santiago) supera la
 *   hora_corte → crea el pedido con `corte_riesgo=true` y devuelve un
 *   `avisoCorte` en el retorno (NO rechaza la creación).
 * - Si está dentro del corte → `corte_riesgo=false` y calcula
 *   `fecha_compromiso_hora = hora_corte + minutos_preparacion + minutos_ruta_estimado`
 *   interpretada en la zona horaria de Santiago.
 * - Si NO hay ventana → crea normal, `corte_riesgo=false`, `fecha_compromiso_hora=null`.
 *
 * Busca la tarifa vigente para el seller (o la tarifa por defecto del tenant)
 * y la fija en tarifa_aplicable_id. Si no hay tarifa configurada, lanza
 * ErrorValidacion con mensaje orientativo.
 */
export async function crearPedidoSameDay(
  cliente: SupabaseClient,
  entrada: CrearPedidoSameDayEntrada,
): Promise<ResultadoCrearPedidoSameDay> {
  // --- 1. Tarifa vigente -------------------------------------------------------
  const { fecha: fechaHoy } = ahoraEnSantiago(); // 'YYYY-MM-DD' en Santiago

  const { data: tarifas, error: errorTarifa } = await cliente
    .from("tarifas")
    .select("id")
    .eq("tenant_id", entrada.tenantId)
    .eq("tipo_entrega", "same_day")
    .eq("estado", "activa")
    .lte("vigente_desde", fechaHoy)
    .or(`vigente_hasta.is.null,vigente_hasta.gte.${fechaHoy}`)
    .or(`seller_id.eq.${entrada.sellerId},seller_id.is.null`)
    .order("seller_id", { ascending: false, nullsFirst: false })
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

  // --- 2. Resolver zona de la comuna -----------------------------------------
  // Normalizar la comuna antes de llamar a resolver_zona (la función SQL compara
  // por igualdad exacta y espera la forma canónica del catálogo).
  const comunaCanonica = resolverComunaCanonica(entrada.destinatarioComuna);
  const zonaId = comunaCanonica
    ? await resolverZona(cliente, entrada.tenantId, comunaCanonica)
    : null;

  // --- 3. Resolver ventana de corte ------------------------------------------
  const ventana = await resolverVentanaCorte(
    cliente,
    entrada.tenantId,
    entrada.sellerId,
    zonaId,
    'same_day',
  );

  // --- 4. Evaluar hora de corte en TZ Santiago --------------------------------
  const ahora = ahoraEnSantiago();
  let fechaCompromisoHora: string | null = null;
  let corteRiesgo = false;
  let avisoCorte: ResultadoCrearPedidoSameDay['avisoCorte'] | undefined;

  if (ventana) {
    const minutosAhora = horaAMinutos(ahora.hora);
    const minutosCorte = horaAMinutos(ventana.horaCorte);

    if (minutosAhora > minutosCorte) {
      // Fuera de corte: crear con aviso, no rechazar.
      corteRiesgo = true;

      // Bitácora de creación fuera de corte (CLAUDE.md: bitácora ANTES de efectos).
      if (entrada.actorUsuarioId) {
        await registrarEnBitacora(cliente, {
          tenantId: entrada.tenantId,
          actorUsuarioId: entrada.actorUsuarioId,
          actorTipo: 'usuario',
          accion: 'pedido.creado_fuera_corte',
          entidadTipo: 'pedido',
          entidadId: null,
          detalle: {
            seller_id: entrada.sellerId,
            hora_corte: ventana.horaCorte,
            hora_actual: ahora.hora,
            zona_id: zonaId,
          },
        });
      }

      avisoCorte = {
        tipo: 'fuera_corte',
        mensaje: `Pasó la hora de corte (${ventana.horaCorte}). El pedido se registró, pero la entrega para hoy está en riesgo.`,
        horaCorte: ventana.horaCorte,
        sugerencia: 'Avisa al destinatario sobre el posible retraso o reactiva el pedido para mañana.',
      };
    } else {
      // Dentro de corte: calcular fecha_compromiso_hora.
      const minutosCompromiso = minutosCorte + ventana.minutosPreparacion + ventana.minutosRutaEstimado;
      const horasCompromiso = Math.floor(minutosCompromiso / 60) % 24;
      const minsCompromiso = minutosCompromiso % 60;
      const horaCompromiso = `${String(horasCompromiso).padStart(2, '0')}:${String(minsCompromiso).padStart(2, '0')}`;

      // El instante de compromiso se refiere al DÍA de hoy en Santiago.
      const instante = combinarFechaHoraSantiago(ahora.fecha, horaCompromiso);
      fechaCompromisoHora = instante.toISOString();
    }
  }

  // --- 5. Crear el pedido -----------------------------------------------------
  // Generar tracking_token opaco para same-day (UUID v4 estándar — no es un secreto
  // cifrado, es un identificador no adivinable para el enlace de tracking público).
  const trackingToken = crypto.randomUUID();

  // codigo_interno: identificador operativo corto para la etiqueta con QR.
  // Único por tenant (índice parcial) — reintento ante unique_violation (23505).
  let nuevo: Record<string, unknown> | null = null;
  let errorInsert: { code?: string; message: string } | null = null;

  for (let intento = 1; intento <= MAX_INTENTOS_CODIGO_INTERNO; intento++) {
    const codigoInterno = generarCodigoInterno();

    const resultado = await cliente
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
        fecha_compromiso_hora: fechaCompromisoHora,
        corte_riesgo: corteRiesgo,
        sla_cumplido: null,
        tracking_token: trackingToken,
        codigo_interno: codigoInterno,
      })
      .select()
      .single();

    nuevo = resultado.data as Record<string, unknown> | null;
    errorInsert = resultado.error as { code?: string; message: string } | null;

    if (!errorInsert) break;

    // Solo reintentar ante colisión de codigo_interno (unique_violation). Cualquier
    // otro error es definitivo — no tiene sentido regenerar el código para él.
    if (errorInsert.code !== "23505") break;
  }

  if (errorInsert || !nuevo) {
    throw new Error(`Error al crear el pedido same-day: ${errorInsert?.message ?? "sin datos"}`);
  }

  const pedido = filaAPedido(nuevo);

  // --- 6. Evento geocodificación (best-effort post-commit) --------------------
  try {
    await inngest.send({
      name: 'operacion/pedido.ingestado',
      id: `pedido-ingestado-${pedido.id}`,
      data: {
        pedidoId: pedido.id,
        tenantId: pedido.tenantId,
        sellerId: pedido.sellerId,
        direccion: pedido.destinatarioDireccion,
        comuna: pedido.destinatarioComuna,
        tipoPedido: 'same_day',
      },
    });
  } catch {
    // Evento best-effort post-commit. Si falla, el pedido ya fue creado con
    // geo_estado = 'pendiente' y el job de geocoding lo procesará por barrido.
    // NUNCA relanzar — no debe bloquear la creación del pedido.
  }

  return { pedido, avisoCorte };
}

// =============================================================================
// asegurarCodigoInterno — backfill perezoso
// =============================================================================

/**
 * Devuelve el `codigo_interno` de un pedido same-day, generándolo y
 * persistiéndolo si aún no lo tiene (pedidos creados antes de esta feature).
 *
 * Reintenta ante colisión (unique_violation, 23505) igual que en la creación.
 * Se usa desde los endpoints de etiqueta — nunca desde el request de creación
 * del pedido (ese camino ya genera el código directamente en el INSERT).
 *
 * Nota de concurrencia: si dos requests concurrentes hacen backfill sobre el
 * mismo pedido, ambos UPDATE competirían por el mismo índice único — el
 * perdedor recibe 23505 y reintenta con un código nuevo, generando dos códigos
 * distintos persistidos en carrera (el último UPDATE gana). Esto es aceptable
 * para un caso de backfill perezoso de baja frecuencia; no es una operación
 * financiera y no requiere lock explícito.
 */
export async function asegurarCodigoInterno(
  cliente: SupabaseClient,
  pedido: Pick<Pedido, "id" | "tenantId" | "codigoInterno">,
): Promise<string> {
  if (pedido.codigoInterno) return pedido.codigoInterno;

  let errorUpdate: { code?: string; message: string } | null = null;

  for (let intento = 1; intento <= MAX_INTENTOS_CODIGO_INTERNO; intento++) {
    const codigoInterno = generarCodigoInterno();

    const { data, error } = await cliente
      .from("pedidos")
      .update({ codigo_interno: codigoInterno })
      .eq("id", pedido.id)
      .eq("tenant_id", pedido.tenantId)
      .select("codigo_interno")
      .single();

    errorUpdate = error as { code?: string; message: string } | null;

    if (!errorUpdate && data) {
      return (data as { codigo_interno: string }).codigo_interno;
    }

    if (errorUpdate?.code !== "23505") break;
  }

  throw new Error(
    `No se pudo generar codigo_interno para el pedido ${pedido.id}: ${errorUpdate?.message ?? "sin datos"}`,
  );
}

