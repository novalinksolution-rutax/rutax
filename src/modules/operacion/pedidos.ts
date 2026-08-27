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

import type { SupabaseClient, PostgrestFilterBuilder } from "@supabase/supabase-js";
import type {
  Pedido,
  FiltrosPedidos,
  ContadoresGrupoPedido,
  PaginadoPedidos,
  ActualizarEstadoEntrada,
  CancelarPedidoEntrada,
  CrearPedidoSameDayEntrada,
  ResultadoCrearPedidoSameDay,
  EstadoPedido,
  EstadoGeocoding,
  CoberturaEstado,
  SituacionRetiro,
} from "./tipos";
import { GRUPOS_ESTADO_PEDIDO } from "./tipos";
import { resolverComunaCanonica } from "@/modules/integraciones/geocoding/normalizacion";
import { ahoraEnSantiago, hoyEnSantiago } from "@/lib/fecha-santiago";
import { resolverZona } from "./zonas";
import { evaluarVentanaCorte } from "./ventanas-corte";
import { resolverTarifaVigente } from "./tarifas";
import { podEsAutoritativoEnRutax, podLoGobiernaLaFuente } from "./fuente";
import { ErrorPedidoNoEncontrado } from "./errores";
import { ErrorValidacion, ErrorConflicto } from "@/modules/identidad/errores";
import {
  puedeAjustarOperacionDiaria,
  puedeMarcarEvidenciasPropias,
  puedeGestionarPedidosPropios,
} from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { validarTransicion } from "./maquina-estados";
import { abrirIncidencia, actualizarIncidencia } from "./incidencias";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import { inngest } from "@/lib/inngest/cliente";
import { generarCodigoInterno } from "./codigo-interno";

/** Máximo de intentos al generar `codigo_interno` ante colisión (unique_violation, 23505). */
const MAX_INTENTOS_CODIGO_INTERNO = 5;

/**
 * Mínimo de caracteres del motivo de cancelación (docs/arquitectura/
 * edicion-y-cancelacion-de-pedidos.md §7.1). La BD NO lo impone a propósito —
 * ver comentario de la columna en la migración 20260811000003: la cancelación
 * que llega por sincronización de ML no trae motivo humano.
 */
const MOTIVO_CANCELACION_MIN = 10;

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

/**
 * Los 3 destinos que `maquina-estados.ts` habilitó para que 'sistema' refleje
 * la realidad de ML desde 'pendiente_asignacion' (bug de facturación, ago-2026:
 * un Flex que Rutax descubre tarde se quedaba congelado en 'pendiente_asignacion'
 * pese a que ML ya lo reportaba shipped/delivered/not_delivered). La función
 * pura es agnóstica de tipo_pedido; la barrera 'flex' se impone aquí, en el
 * llamador — mismo patrón que usa `cancelarPedido` para acotar sus transiciones
 * por tipo de pedido.
 */
const REFLEJO_ML_DESDE_PENDIENTE = new Set<EstadoPedido>(['en_ruta', 'entregado', 'fallido']);

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
    // Procedencia (migración 20260816000002). En base es NOT NULL; el fallback
    // solo cubre un SELECT que olvide la columna, y cae CERRADO a 'ml_flex' a
    // propósito: de las dos maneras de equivocarse, esta bloquea al conductor con
    // un error visible, y la otra dejaría aceptar un POD sobre un pedido cuya
    // prueba de entrega gobierna Mercado Envíos. Mismo criterio que
    // `situacionRetiro` más abajo.
    fuente: fila.fuente ?? 'ml_flex',
    origen: fila.origen,
    mlOrderId: fila.ml_order_id ?? null,
    mlShipmentId: fila.ml_shipment_id ?? null,
    idExterno: fila.id_externo ?? null,
    referenciaExterna: fila.referencia_externa ?? null,
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
    // Columnas de cancelación (migración 20260811000003).
    canceladoEn: fila.cancelado_en ?? null,
    canceladoPorUsuarioId: fila.cancelado_por_usuario_id ?? null,
    motivoCancelacion: fila.motivo_cancelacion ?? null,
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

  let query = aplicarFiltrosPedidos(
    cliente.from("pedidos").select(seleccionSegunFiltros("*", filtros), { count: "exact" }),
    filtros,
  );

  // ⚠️ **El desempate por `id` no es cosmético: sin él la lista se baraja sola.**
  // `creado_en` empata con facilidad —una ingesta escribe decenas de pedidos en
  // la misma transacción y todos comparten el instante— y con la clave empatada
  // Postgres **no garantiza ningún orden**: puede devolver las filas distinto en
  // cada ejecución de la misma consulta.
  //
  // Se veía como un fantasma: un pedido cambia de estado, la pantalla se refresca
  // y **otras siete filas se mueven de sitio** sin que nada les haya pasado. Con
  // el refresco en sitio del tablero —cuya regla entera es «la fila no se mueve»—
  // deja de ser un fantasma y pasa a ser el defecto principal.
  //
  // Y también rompe la paginación: dos filas empatadas pueden salir en la página
  // 1 y en la 2, o en ninguna.
  query = query
    .order("creado_en", { ascending: false })
    .order("id", { ascending: false })
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
// Filtros compartidos entre el listado y su barra de grupos
// =============================================================================

/**
 * Aplica a una consulta sobre `pedidos` TODOS los filtros de `FiltrosPedidos`
 * salvo orden y paginación.
 *
 * ⚠️ Existe para que `listarPedidos` y `contarPedidosPorGrupo` no puedan
 * divergir. Cuando cada uno tenía su copia, la barra de arriba contaba una cosa
 * y la tabla de abajo mostraba otra. Si agregas un filtro, agrégalo aquí y las
 * dos mitades lo heredan.
 */
// El builder se tipa con los genéricos abiertos de PostgREST. Un genérico
// estructural (`Q extends { eq(…): Q }`) parece más limpio pero hace que TS
// compare recursivamente el tipo completo del builder contra la restricción y
// aborte con TS2589 ("type instantiation is excessively deep"). Este cliente ya
// es un `SupabaseClient` sin tipos de esquema, así que no se pierde precisión.
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type ConsultaPedidos = PostgrestFilterBuilder<any, any, any, any>;

/**
 * El `select` que hace falta para poder filtrar por manifiesto.
 * =============================================================================
 *
 * PostgREST solo deja filtrar por un recurso embebido **si el recurso está en el
 * `select`**, así que el embed no lo puede poner `aplicarFiltrosPedidos`: tiene
 * que viajar en la cadena de columnas de cada llamador. Se centraliza acá para
 * que el listado y la barra de cajones no puedan divergir — que es el mismo
 * motivo por el que existe `aplicarFiltrosPedidos`.
 *
 * `!inner` es lo que convierte el embed en el filtro: sin él, un pedido sin
 * asignación saldría igual, con el array vacío. Y no duplica filas porque hay un
 * único parcial —`idx_asignaciones_pedido_activa_uk`— que impone una sola
 * asignación activa por pedido: el join trae 0 o 1, nunca 2.
 *
 * Verificado contra PostgREST real a través de las vistas de `public`
 * (2026-08-26): 9 de 29 pedidos, con `count` exacto y sin duplicados.
 */
function seleccionSegunFiltros(columnas: string, filtros: FiltrosPedidos): string {
  return filtros.enManifiesto
    ? `${columnas}, asignaciones_pedido!inner(manifiesto_id)`
    : columnas;
}

function aplicarFiltrosPedidos(
  consulta: ConsultaPedidos,
  filtros: FiltrosPedidos,
): ConsultaPedidos {
  let query = consulta.eq("tenant_id", filtros.tenantId);

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

  if (filtros.fuente) query = query.eq("fuente", filtros.fuente);

  // Solo lo que ya está en un manifiesto. El `!inner` lo pone
  // `seleccionSegunFiltros`; esto acota el embed a la asignación VIGENTE, y con
  // el inner join eso descarta al pedido que solo tuvo asignaciones viejas.
  if (filtros.enManifiesto) query = query.eq("asignaciones_pedido.activa", true);

  if (filtros.porRevisar) {
    // Cajón de revisión de dirección: geo_estado problemático OR cobertura sin
    // tarifa/revisión. `.or()` con sintaxis PostgREST (comas = AND dentro del
    // grupo). Es ORTOGONAL al estado operativo, así que no se combina con
    // `estados`/`estado` — pero sí con la fecha, ver más abajo.
    query = query.or(
      "geo_estado.in.(no_resuelto,fuera_cobertura),cobertura_estado.in.(requiere_revision,sin_tarifa_zona)",
    );
  } else if (filtros.estados && filtros.estados.length > 0) {
    // Grupo de estados (la barra de `/operaciones`). Manda sobre `estado`.
    query = query.in("estado", filtros.estados);
  } else if (filtros.estado) {
    query = query.eq("estado", filtros.estado);
  }

  // La fecha se aplica SIEMPRE, también en el cajón de revisión. Antes vivía
  // dentro del `else` y por eso la bandeja de direcciones ignoraba el día.
  // Día exacto (excluyente) o rango. `fecha` gana si vino: preserva el
  // comportamiento histórico y los deep-links de la Torre (`?fecha=…`).
  if (filtros.fecha) {
    query = query.eq("fecha_compromiso", filtros.fecha);
  } else {
    if (filtros.fechaDesde) query = query.gte("fecha_compromiso", filtros.fechaDesde);
    if (filtros.fechaHasta) query = query.lte("fecha_compromiso", filtros.fechaHasta);
  }

  return query;
}

// =============================================================================
// contarPedidosPorGrupo
// =============================================================================

/**
 * Cuenta los pedidos de cada grupo sobre el CONJUNTO filtrado.
 *
 * BUG que corrige (2026-08-16): la barra de `/operaciones` calculaba sus cifras
 * en memoria sobre `resultado.datos`, que es **una página de 25 filas**. Con los
 * ~16 pedidos de la demo cuadraba por casualidad; con el volumen real de un día
 * (~130 bultos) los cinco cajones sumaban 25 como mucho y cambiaban al pasar de
 * página. Ahora cada cajón es un `count` en base sobre todo el conjunto.
 *
 * Son siete consultas `head: true` en paralelo (devuelven cifra, no filas): no
 * hay tabla que traer, así que tampoco hay tope de 1000 filas de PostgREST que
 * esquivar ni RPC nueva que migrar.
 *
 * Los filtros de estado que traiga `filtros` se IGNORAN — si no, pulsar un cajón
 * dejaría los otros cinco en cero. El resto (seller, conductor, comuna, fuente,
 * fecha) sí se respeta: la barra cuenta lo mismo que la tabla muestra.
 */
export async function contarPedidosPorGrupo(
  cliente: SupabaseClient,
  filtros: FiltrosPedidos,
): Promise<ContadoresGrupoPedido> {
  const base: FiltrosPedidos = {
    ...filtros,
    estado: undefined,
    estados: undefined,
    porRevisar: undefined,
  };

  async function contar(extra: Partial<FiltrosPedidos>): Promise<number> {
    const conFiltros = { ...base, ...extra };
    const { count, error } = await aplicarFiltrosPedidos(
      cliente
        .from("pedidos")
        .select(seleccionSegunFiltros("id", conFiltros), { count: "exact", head: true }),
      conFiltros,
    );
    if (error) {
      throw new Error(`Error al contar pedidos: ${error.message}`);
    }
    return count ?? 0;
  }

  const claves = Object.keys(GRUPOS_ESTADO_PEDIDO) as (keyof typeof GRUPOS_ESTADO_PEDIDO)[];

  // `cancelado` se cuenta aunque NO sea un grupo de `GRUPOS_ESTADO_PEDIDO`: la
  // barra lo muestra como cajón excluido —fuera de la suma, tras el separador—
  // y sin su cifra no se puede declarar el total real («284 de 291»).
  const [porGrupo, porRevisar, cancelado] = await Promise.all([
    Promise.all(claves.map((clave) => contar({ estados: GRUPOS_ESTADO_PEDIDO[clave] }))),
    contar({ porRevisar: true }),
    contar({ estados: ["cancelado"] }),
  ]);

  const contadores = Object.fromEntries(
    claves.map((clave, i) => [clave, porGrupo[i]]),
  ) as ContadoresGrupoPedido;

  contadores.por_revisar = porRevisar;
  contadores.cancelado = cancelado;
  return contadores;
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

  // 1b. Ejecutor 'seller': SOLO alcanzable hoy vía `cancelarPedido` (docs/
  // arquitectura/edicion-y-cancelacion-de-pedidos.md §6.1) — la ventana, el
  // tipo_pedido='same_day' y el motivo >= 10 caracteres los valida esa
  // envoltura ANTES de llegar aquí. Esta capa es defensa en profundidad, no el
  // diseño: si alguien llamara a esta función directamente con ejecutor='seller'
  // sin pasar por cancelarPedido, sigue exigiendo capacidad y motivo.
  if (entrada.ejecutor === "seller") {
    if (!actor) {
      throw new ErrorValidacion(
        "Se requiere el actor (seller autenticado) para cancelar el pedido",
      );
    }
    if (!puedeGestionarPedidosPropios(actor)) {
      throw new ErrorValidacion(
        "El usuario no tiene capacidad para gestionar sus propios pedidos",
      );
    }
    if (!entrada.motivo || entrada.motivo.trim().length === 0) {
      throw new ErrorValidacion(
        "Se requiere un motivo para cancelar el pedido",
      );
    }
  }

  // 2. Leer estado actual del pedido — con aislamiento de tenant (y de seller,
  // vía `entrada.sellerId`, cuando el ejecutor es 'seller': guarda atómica
  // contra la carrera entre lectura y escritura — §4.2).
  // Se incluyen las columnas necesarias para el evento financiero post-commit
  // y para la proyección de sla_cumplido (fecha_compromiso_hora).
  let consultaLectura = cliente
    .from("pedidos")
    .select("id, estado, seller_id, tenant_id, driver_id_asignado, tipo_pedido, fuente, id_externo, tarifa_aplicable_id, fecha_compromiso_hora, fecha_compromiso")
    .eq("id", entrada.pedidoId)
    .eq("tenant_id", entrada.tenantId);
  if (entrada.sellerId) {
    consultaLectura = consultaLectura.eq("seller_id", entrada.sellerId);
  }
  const { data: pedidoActual, error: errorLectura } = await consultaLectura.maybeSingle();

  if (errorLectura) {
    throw new Error(`Error al leer el pedido: ${errorLectura.message}`);
  }

  if (!pedidoActual) {
    throw new ErrorPedidoNoEncontrado(entrada.pedidoId);
  }

  const estadoActual: EstadoPedido = pedidoActual.estado;

  // 2b. FRONTERA DURA: si el ejecutor es 'conductor', aplicar las restricciones
  //     de POD autoritativo ANTES de validarTransicion. El conductor NUNCA
  //     cierra un pedido cuya prueba de entrega la gobierna la fuente.
  if (entrada.ejecutor === "conductor") {
    // La pregunta es por la FUENTE, no por el tipo de servicio: Flex impone la
    // app de Mercado Envíos, el resto de las fuentes no imponen ninguna.
    if (podLoGobiernaLaFuente(pedidoActual.fuente)) {
      throw new ErrorValidacion(
        "El conductor no puede cerrar este pedido desde Rutax: su prueba de entrega la gobierna Mercado Libre.",
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

  // 2c. FRONTERA DURA: el 'sistema' solo puede reflejar en_ruta/entregado/fallido
  //     desde 'pendiente_asignacion' cuando la fuente es la dueña del POD (ver el
  //     comentario de `REFLEJO_ML_DESDE_PENDIENTE` y de la tabla en
  //     `maquina-estados.ts`). Si el POD autoritativo es el de Rutax no hay
  //     tercero que mande, y el conductor siempre pasa primero por 'asignado' —
  //     así que este camino no debería alcanzarse nunca; se cierra la puerta aquí
  //     de todos modos, mismo patrón que usa `cancelarPedido` de acotar en el
  //     llamador en vez de en la función pura.
  if (
    entrada.ejecutor === "sistema" &&
    estadoActual === "pendiente_asignacion" &&
    REFLEJO_ML_DESDE_PENDIENTE.has(entrada.estadoNuevo) &&
    podEsAutoritativoEnRutax(pedidoActual.fuente)
  ) {
    throw new ErrorValidacion(
      "Este pedido no puede reflejar un estado externo sin haber sido asignado — su prueba de entrega autoritativa es la que captura Rutax.",
    );
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
  //   - cualquier terminal exitoso pero tardío, o estado fallido/devuelto
  //     → sla_cumplido = false
  //   - cancelado → sla_cumplido = null SIEMPRE (no evaluable): un pedido cancelado
  //     no es un incumplimiento de SLA, es una entrega que nadie llegó a pedir.
  //     Contarlo como fallo hundiría el % de cumplimiento por decisiones ajenas
  //     al desempeño del courier. `slaGlobalPct` cuenta sobre
  //     `sla_cumplido IS NOT NULL`, así que null es justo lo que lo saca del
  //     denominador (ver §5 fila 5 de docs/arquitectura/edicion-y-cancelacion-de-pedidos.md).
  //   - sin fecha_compromiso_hora ni fecha_compromiso → null (no evaluable)
  // La proyección es barata: un campo en el mismo UPDATE — sin job nuevo.
  const ahora = new Date();
  let slaCumplido: boolean | null = null;
  // true cuando hay que forzar la escritura de `sla_cumplido = null` aunque la
  // columna ya tenga un valor de una transición anterior (p. ej. fallido→cancelado
  // dejó sla_cumplido=false y hay que limpiarlo). Sin este flag, el UPDATE de más
  // abajo omite el campo cuando slaCumplido es null y la columna conserva su
  // valor viejo.
  let forzarSlaNulo = false;

  const ESTADOS_EXITOSOS_TERMINALES = new Set<EstadoPedido>(['entregado', 'entregado_manual']);
  const ESTADOS_NO_EXITOSOS_TERMINALES = new Set<EstadoPedido>(['fallido', 'fallido_manual', 'devuelto']);

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
    // Estado no exitoso (fallido/fallido_manual/devuelto): SLA incumplido si
    // había compromiso horario configurado. `devuelto` siempre llega desde un
    // intento real de entrega (en_ruta/fallido/fallido_manual) que terminó
    // devuelta al origen — es un incumplimiento genuino, a diferencia de
    // `cancelado`.
    const fechaCompromisoHora = pedidoActual.fecha_compromiso_hora as string | null;
    slaCumplido = fechaCompromisoHora ? false : null;
  } else if (entrada.estadoNuevo === 'cancelado') {
    // No evaluable, siempre — y forzado: si el pedido venía de 'fallido' con
    // sla_cumplido=false ya escrito, cancelar debe limpiarlo a null.
    slaCumplido = null;
    forzarSlaNulo = true;
  }

  // 5. Bitácora ANTES del UPDATE (CLAUDE.md: "bitácora antes que efectos externos").
  // Cualquier acción de usuario queda registrada incluso si el UPDATE posterior falla.
  // Una entrada por acto (§6.1): cuando el destino es 'cancelado', la acción es
  // 'pedido.cancelado' en vez de 'pedido.estado_corregido_manual' — nunca las dos.
  if (entrada.ejecutor === "interno" && actor) {
    const esCancelacion = entrada.estadoNuevo === "cancelado";
    await registrarEnBitacora(cliente, {
      tenantId: entrada.tenantId,
      actorUsuarioId: entrada.actuadoPorUsuarioId ?? null,
      actorTipo: "usuario",
      accion: esCancelacion ? "pedido.cancelado" : "pedido.estado_corregido_manual",
      entidadTipo: "pedido",
      entidadId: entrada.pedidoId,
      detalle: {
        estado_anterior: estadoActual,
        estado_nuevo: entrada.estadoNuevo,
        motivo: entrada.motivo,
        ...(esCancelacion ? { ejecutor: "interno" as const } : {}),
      },
    });
  }

  // 5b. Ejecutor 'seller': hoy solo alcanzable vía cancelarPedido → siempre
  // 'pedido.cancelado'. Mismo invariante (bitácora ANTES del UPDATE, con autor).
  if (entrada.ejecutor === "seller" && actor) {
    await registrarEnBitacora(cliente, {
      tenantId: entrada.tenantId,
      actorUsuarioId: entrada.actuadoPorUsuarioId ?? null,
      actorTipo: "usuario",
      accion: "pedido.cancelado",
      entidadTipo: "pedido",
      entidadId: entrada.pedidoId,
      detalle: {
        estado_anterior: estadoActual,
        estado_nuevo: entrada.estadoNuevo,
        motivo: entrada.motivo,
        ejecutor: "seller" as const,
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

  // Solo escribir sla_cumplido si se pudo evaluar (no dejar null sobre un valor ya
  // evaluado) — salvo que forzarSlaNulo lo exija explícitamente (cancelado).
  if (slaCumplido !== null || forzarSlaNulo) {
    updatePayload.sla_cumplido = slaCumplido;
  }

  // Las 3 columnas de cancelación (migración 20260811000003) se escriben en el
  // MISMO UPDATE que mueve el estado — nunca en un UPDATE separado. `sistema`
  // (sincronización ML) también pasa por aquí y no siempre trae actor humano:
  // cancelado_por_usuario_id queda null en ese caso, a propósito.
  if (entrada.estadoNuevo === "cancelado") {
    updatePayload.cancelado_en = ahora.toISOString();
    updatePayload.cancelado_por_usuario_id = entrada.actuadoPorUsuarioId ?? null;
    updatePayload.motivo_cancelacion = entrada.motivo ?? null;
  }

  // Guarda atómica adicional contra la carrera entre lectura y escritura
  // (§4.2): cuando el ejecutor es 'seller', `entrada.sellerId` también entra
  // al WHERE del UPDATE, no solo del SELECT del paso 2.
  let consultaUpdate = cliente
    .from("pedidos")
    .update(updatePayload)
    .eq("id", entrada.pedidoId)
    .eq("tenant_id", entrada.tenantId)
    .eq("estado", entrada.estadoEsperado); // guarda adicional a nivel de BD
  if (entrada.sellerId) {
    consultaUpdate = consultaUpdate.eq("seller_id", entrada.sellerId);
  }
  const { data: pedidoActualizado, error: errorUpdate } = await consultaUpdate.select().single();

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

  // 7c. Al CANCELAR, cualquier incidencia abierta deja de aplicar — mismo patrón
  //     que la resolución por devolución (7b), pero sin restringir el estado
  //     anterior: un pedido puede llegar a 'cancelado' con una incidencia abierta
  //     desde 'fallido'/'fallido_manual' (apertura automática, 7a) o desde una
  //     apertura manual en cualquier otro estado no terminal. Se consulta PRIMERO
  //     si existe una incidencia abierta — a diferencia de 7b, no se escribe
  //     bitácora si no hay ninguna que resolver (la mayoría de las cancelaciones,
  //     p. ej. desde 'pendiente_asignacion', nunca tuvieron incidencia).
  if (entrada.estadoNuevo === "cancelado") {
    const { data: incidenciasAbiertasPorCancelacion } = await cliente
      .from("incidencias")
      .select("id, estado")
      .eq("pedido_id", entrada.pedidoId)
      .eq("tenant_id", entrada.tenantId)
      .in("estado", ["abierta", "en_gestion"])
      .limit(1);

    if (incidenciasAbiertasPorCancelacion && incidenciasAbiertasPorCancelacion.length > 0) {
      const incidencia = incidenciasAbiertasPorCancelacion[0];

      // Bitácora de la resolución de incidencia ANTES del efecto (CLAUDE.md).
      await registrarEnBitacora(cliente, {
        tenantId: entrada.tenantId,
        actorUsuarioId: entrada.actuadoPorUsuarioId ?? null,
        actorTipo: entrada.ejecutor === "interno" || entrada.ejecutor === "seller" ? "usuario" : "sistema",
        accion: "incidencia.resuelta_por_cancelacion",
        entidadTipo: "pedido",
        entidadId: entrada.pedidoId,
        detalle: {
          incidencia_id: incidencia.id,
          estado_anterior: estadoActual,
          motivo: "Pedido cancelado",
        },
      });

      try {
        await actualizarIncidencia(cliente, {
          incidenciaId: incidencia.id as string,
          tenantId: entrada.tenantId,
          estado: "resuelta",
          notasResolucion: "Pedido cancelado",
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
  //
  // EXCEPCIÓN (decisión del usuario, ago-2026): un pedido que llega a
  // 'entregado' sin haber sido asignado a un conductor DENTRO de Rutax no
  // dispara el cobro automático — pudo entregarlo el propio seller por su
  // cuenta, y facturarlo sería cobrar una operación que Rutax no hizo. El
  // ESTADO igual se refleja siempre (decisión #1: el estado real de ML manda);
  // lo único que no ocurre es publicar el evento que dispara C1
  // (`dinero/jobs/generar-lineas.ts`). La excepción queda visible SOLA, sin
  // detector nuevo: C6 (`dinero/jobs/conciliar-periodo.ts`, check 1) ya busca
  // "entregado sin línea de cobro" para todo pedido del período, sin filtrar
  // por conductor asignado, así que aparecerá en `dinero.eventos_conciliacion`
  // como `pedido_entregado_sin_linea_cobro` (acción sugerida
  // `generar_cobro_manual`) cuando el período que cubre esta fecha cierre.
  // Vale igual para 'fallido' (decisión del usuario, 2026-08-13): al abrir la
  // puerta 'pendiente_asignacion'→'fallido' apareció la misma grieta por otro
  // lado. Un pedido que llega a 'fallido' abre incidencia automática, cuyo
  // default es `afecta_cobro=true`, y el motor de fallidos cobra con solo eso
  // —sin mirar el conductor, a diferencia de la liquidación—. Sin esta guardia
  // se facturaría un intento de entrega que Rutax no hizo… o que hizo OTRO
  // courier: el mismo `ml_user_id` puede estar conectado a dos tenants
  // distintos (ver `procesar-shipment.ts`) y un seller despacha con varios.
  //
  // Acotado a los estados automáticos: 'entregado_manual' y 'fallido_manual'
  // son correcciones humanas deliberadas (RBAC + motivo) y siguen facturando
  // como siempre — ahí SÍ hay alguien afirmando que la operación ocurrió.
  const sinAsignacionEnRutax =
    (entrada.estadoNuevo === 'entregado' || entrada.estadoNuevo === 'fallido') &&
    !pedidoActual.driver_id_asignado;

  if (ESTADOS_FINANCIEROS.has(entrada.estadoNuevo) && !sinAsignacionEnRutax) {
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

  // 8b. Post-commit: publicar el evento SOURCE-NEUTRAL de estado terminal —
  // punto de extensión para que `integraciones` escriba de vuelta a la fuente
  // que originó el pedido (hoy: Shopify marca el `Fulfillment` al entregar).
  // Evento y try/catch INDEPENDIENTES del financiero de arriba, a propósito
  // (ver el comentario de `EventoPedidoEstadoTerminal` en `lib/inngest/eventos.ts`):
  // no es un contrato de `dinero`, y NO lleva la excepción `sinAsignacionEnRutax`
  // — esa excepción existe para no facturar una entrega que Rutax no hizo, pero
  // avisarle a la tienda que su pedido llegó a un estado terminal es correcto
  // sin importar quién lo entregó.
  if (ESTADOS_FINANCIEROS.has(entrada.estadoNuevo)) {
    try {
      await inngest.send({
        name: 'operacion/pedido.estado-terminal',
        id: `pedido-estado-terminal-${entrada.pedidoId}-${entrada.estadoNuevo}`,
        data: {
          pedidoId: entrada.pedidoId,
          tenantId: entrada.tenantId,
          sellerId: pedidoActual.seller_id as string,
          fuente: pedidoActual.fuente as 'ml_flex' | 'rutax_manual' | 'shopify',
          idExterno: (pedidoActual.id_externo as string | null) ?? null,
          estadoNuevo: entrada.estadoNuevo as 'entregado' | 'entregado_manual' | 'fallido' | 'fallido_manual' | 'devuelto' | 'cancelado',
          fechaTransicion: new Date().toISOString(),
        },
      });
    } catch {
      // Best-effort post-commit, igual que el evento financiero: nunca
      // relanzar — el pedido ya está en su nuevo estado.
    }
  }

  return pedido;
}

// =============================================================================
// cancelarPedido
// =============================================================================

/**
 * Cancela un pedido same-day vivo (docs/arquitectura/edicion-y-cancelacion-de-
 * pedidos.md §7.1). Es la ENVOLTURA que valida ventana (vía la máquina de
 * estados, dentro de `actualizarEstadoPedido`), `tipo_pedido='same_day'`, RBAC
 * y motivo (≥10 caracteres) — y que desactiva la asignación activa DESPUÉS de
 * delegar la escritura de estado. `actualizarEstadoPedido` sigue siendo el
 * único camino de escritura de estado: aquí NO se duplican optimistic locking,
 * máquina de estados, incidencias ni evento financiero.
 *
 * `cliente` DEBE ser `service_role` — igual que el resto de este módulo.
 * La pertenencia del pedido (para `ejecutor='seller'`) NO se decide aquí: la
 * decide la lectura previa hecha con el cliente de la SESIÓN en la Server
 * Action (RLS), que responde "Pedido no encontrado" antes de llegar a esta
 * función. `entrada.sellerId` es una guarda ATÓMICA adicional contra la
 * carrera entre esa lectura y esta escritura — no el mecanismo de autorización.
 *
 * Orden de efectos (§5 fila 2): la asignación se desactiva DESPUÉS de llamar a
 * `actualizarEstadoPedido`, no antes — el evento financiero (publicado dentro
 * de esa llamada) lleva `driverIdAsignado`, y ese valor se lee de la fila del
 * pedido ANTES de que la desactivación de la asignación dispare el trigger
 * `trg_asignaciones_sincronizar_driver_id` que la pondría en `null`. Si se
 * desactivara primero, el evento financiero mentiría sobre quién llevaba el
 * paquete.
 *
 * Lanza: ErrorValidacion (RBAC, tipo_pedido, motivo) · ErrorPedidoNoEncontrado ·
 * ErrorTransicionInvalida (ventana) · ErrorConflicto (carrera).
 */
export async function cancelarPedido(
  cliente: SupabaseClient,
  entrada: CancelarPedidoEntrada,
  actor: UsuarioActual,
): Promise<Pedido> {
  // 1. RBAC — mismo gate que la acción equivalente en la UI.
  if (entrada.ejecutor === "interno") {
    if (!puedeAjustarOperacionDiaria(actor)) {
      throw new ErrorValidacion(
        "El usuario no tiene capacidad para cancelar pedidos manualmente",
      );
    }
  } else {
    if (!puedeGestionarPedidosPropios(actor)) {
      throw new ErrorValidacion(
        "El usuario no tiene capacidad para cancelar sus propios pedidos",
      );
    }
    if (!entrada.sellerId) {
      throw new ErrorValidacion(
        "Se requiere sellerId para cancelar un pedido como seller",
      );
    }
  }

  // 2. Motivo obligatorio, >= 10 caracteres. La BD NO lo impone a propósito
  // (migración 20260811000003): la cancelación por sincronización de ML no
  // trae motivo humano y entra por `actualizarEstadoPedido` directamente, sin
  // pasar por esta envoltura.
  if (!entrada.motivo || entrada.motivo.trim().length < MOTIVO_CANCELACION_MIN) {
    throw new ErrorValidacion(
      `El motivo de cancelación debe tener al menos ${MOTIVO_CANCELACION_MIN} caracteres`,
    );
  }

  // 3. Leer el pedido — con guarda de tenant (y de seller, si corresponde).
  // Nota: por diseño (§4.2) la existencia/pertenencia ya la decidió la lectura
  // con el cliente de la SESIÓN en la Server Action; aquí, si no aparece, es
  // una carrera genuina (o un error de programación) — ErrorPedidoNoEncontrado
  // es la respuesta correcta en ambos casos.
  let consulta = cliente
    .from("pedidos")
    .select("id, estado, tipo_pedido, fuente, seller_id, driver_id_asignado")
    .eq("id", entrada.pedidoId)
    .eq("tenant_id", entrada.tenantId);
  if (entrada.ejecutor === "seller" && entrada.sellerId) {
    consulta = consulta.eq("seller_id", entrada.sellerId);
  }
  const { data: pedidoActual, error: errorLectura } = await consulta.maybeSingle();

  if (errorLectura) {
    throw new Error(`Error al leer el pedido: ${errorLectura.message}`);
  }
  if (!pedidoActual) {
    throw new ErrorPedidoNoEncontrado(entrada.pedidoId);
  }

  // 4. Barrera por fuente (§3.2): la cancelación humana solo alcanza a los
  // pedidos cuyo ciclo de vida es de Rutax. Un Flex vivo lo gobierna Mercado
  // Envíos — Rutax orquesta alrededor, nunca escribe de vuelta un estado
  // terminal que ML no pidió. (El camino existente `fallido → cancelado` para un
  // Flex atascado sigue intacto: va directo por `actualizarEstadoPedido`, no por
  // esta función.)
  if (podLoGobiernaLaFuente(pedidoActual.fuente)) {
    throw new ErrorValidacion(
      "Este pedido no se puede cancelar desde aquí — su ciclo de vida lo gobierna Mercado Envíos.",
    );
  }

  // 5. Delegar la escritura de estado a actualizarEstadoPedido (único camino):
  // optimistic locking, máquina de estados (impone la ventana por ejecutor),
  // bitácora, resolución de incidencias, las 3 columnas de cancelación en el
  // mismo UPDATE, y el evento financiero — con el driver_id_asignado ORIGINAL,
  // porque la asignación todavía no se ha tocado en este punto.
  const pedido = await actualizarEstadoPedido(
    cliente,
    {
      pedidoId: entrada.pedidoId,
      tenantId: entrada.tenantId,
      estadoNuevo: "cancelado",
      estadoEsperado: entrada.estadoEsperado,
      ejecutor: entrada.ejecutor,
      actuadoPorUsuarioId: entrada.actuadoPorUsuarioId,
      motivo: entrada.motivo,
      sellerId: entrada.ejecutor === "seller" ? entrada.sellerId : undefined,
    },
    actor,
  );

  // 6. Desactivar la asignación activa (si existe) — DESPUÉS del paso anterior
  // (§5 fila 1, bloqueante): si no se desactiva, la parada cancelada sigue viva
  // en la app Expo del conductor y, con la cola offline, puede cerrarse después.
  try {
    await desactivarAsignacionActivaPedido(cliente, entrada.pedidoId, entrada.tenantId);
  } catch (err) {
    // SE LANZA A PROPÓSITO — no lo conviertas en un log silencioso.
    //
    // El pedido YA está cancelado (paso 5 confirmado) y no se revierte: el
    // estado operativo es correcto. Lo que quedó mal es la asignación, que
    // sigue activa. Ese es exactamente el efecto colateral bloqueante de §5
    // fila 1: la parada cancelada seguiría viva en la app Expo del conductor
    // y, con la cola offline, podría cerrarse después.
    //
    // Tragarse este error dejaría esa inconsistencia sin un solo rastro. Al
    // lanzar, el operador ve que la cancelación se aplicó pero la asignación
    // no, y Sentry lo captura. El mensaje dice ambas cosas a propósito.
    const detalle = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Pedido '${entrada.pedidoId}' cancelado, pero no se pudo desactivar su asignación activa: ${detalle}`,
    );
  }

  return pedido;
}

/**
 * Desactiva la asignación activa de un pedido, si existe (docs/arquitectura/
 * edicion-y-cancelacion-de-pedidos.md §5 fila 1). Se llama SIEMPRE DESPUÉS de
 * mover el estado a 'cancelado' — nunca antes: si se desactivara primero, el
 * evento financiero (publicado dentro de `actualizarEstadoPedido`) leería
 * `driver_id_asignado` ya en null y mentiría sobre quién llevaba el paquete.
 *
 * Sin error si no hay ninguna asignación activa (p. ej. cancelando desde
 * 'pendiente_asignacion', que nunca tuvo una) — 0 filas afectadas es el
 * resultado esperado, no una falla.
 *
 * Compartido por `cancelarPedido` (cancelación humana, solo same-day) y por
 * `operacion/jobs/procesar-cancelacion-ml.ts` (cancelación reportada por ML,
 * cualquier tipo_pedido) — es el mismo efecto colateral bloqueante
 * independientemente de quién disparó la cancelación: si el conductor lleva
 * el bulto en la van, su app no debe seguir mostrando esa parada.
 *
 * `cliente` DEBE ser service_role, igual que el resto de este módulo.
 */
export async function desactivarAsignacionActivaPedido(
  cliente: SupabaseClient,
  pedidoId: string,
  tenantId: string,
): Promise<void> {
  const { error } = await cliente
    .from("asignaciones_pedido")
    .update({ activa: false, desasignado_en: new Date().toISOString() })
    .eq("pedido_id", pedidoId)
    .eq("tenant_id", tenantId)
    .eq("activa", true);

  if (error) {
    throw new Error(error.message);
  }
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

  const tarifaAplicableId = await resolverTarifaVigente(cliente, {
    tenantId: entrada.tenantId,
    sellerId: entrada.sellerId,
    tipoEntrega: "same_day",
    fecha: fechaHoy,
  });

  if (!tarifaAplicableId) {
    throw new ErrorValidacion(
      "El seller no tiene una tarifa configurada para entregas same-day — " +
        "configúrala en /onboarding/tarifas antes de crear pedidos",
    );
  }

  // --- 2. Resolver zona de la comuna -----------------------------------------
  // Normalizar la comuna antes de llamar a resolver_zona (la función SQL compara
  // por igualdad exacta y espera la forma canónica del catálogo).
  const comunaCanonica = resolverComunaCanonica(entrada.destinatarioComuna);
  const zonaId = comunaCanonica
    ? await resolverZona(cliente, entrada.tenantId, comunaCanonica)
    : null;

  // --- 3-4. Resolver la ventana de corte y evaluarla en TZ Santiago -----------
  // El cálculo vive en `evaluarVentanaCorte` (./ventanas-corte.ts) porque lo
  // comparte con la ingesta de Shopify (`integraciones/shopify/ingesta-pedidos.ts`):
  // dos altas distintas del mismo régimen same-day no pueden tener dos relojes.
  // Lo que se queda AQUÍ es lo que solo tiene sentido con un humano delante: la
  // bitácora con su actor y el `avisoCorte` de la pantalla.
  const corte = await evaluarVentanaCorte(cliente, {
    tenantId: entrada.tenantId,
    sellerId: entrada.sellerId,
    zonaId,
    tipoEntrega: 'same_day',
  });

  const fechaCompromisoHora = corte.fechaCompromisoHora;
  const corteRiesgo = corte.corteRiesgo;
  let avisoCorte: ResultadoCrearPedidoSameDay['avisoCorte'] | undefined;

  if (corte.corteRiesgo && corte.ventana) {
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
          hora_corte: corte.ventana.horaCorte,
          hora_actual: corte.horaEvaluada,
          zona_id: zonaId,
        },
      });
    }

    avisoCorte = {
      tipo: 'fuera_corte',
      mensaje: `Pasó la hora de corte (${corte.ventana.horaCorte}). El pedido se registró, pero la entrega para hoy está en riesgo.`,
      horaCorte: corte.ventana.horaCorte,
      sugerencia: 'Avisa al destinatario sobre el posible retraso o reactiva el pedido para mañana.',
    };
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
        fuente: "rutax_manual",
        origen: "same_day_manual",
        estado: "pendiente_asignacion",
        destinatario_nombre: entrada.destinatarioNombre,
        destinatario_direccion: entrada.destinatarioDireccion,
        destinatario_comuna: entrada.destinatarioComuna,
        destinatario_telefono: entrada.destinatarioTelefono ?? null,
        instrucciones_entrega: entrada.instruccionesEntrega ?? null,
        // 🔴 Sin fecha, el pedido se compromete para HOY (día operativo de
        // Santiago). Antes se guardaba NULL, y eso lo volvía invisible: el
        // panel de Pedidos filtra `fecha_compromiso` con `.eq` (o con
        // `.gte`/`.lte`), y en SQL un NULL no satisface NINGUNA comparación:
        // el pedido existía y no aparecía en ninguna pantalla del día —
        // tampoco en «Registrar retiro», así que no se podía ni asignar.
        // Mordió el 2026-08-27 al crear diez pedidos de prueba.
        //
        // El formulario SIEMPRE prometió esto («Si la dejas vacía, se entrega
        // hoy»); lo que faltaba era cumplirlo.
        //
        // ⚠️ `hoyEnSantiago()` y no `new Date().toISOString()`: en Vercel
        // el runtime corre en UTC, así que después de las 21:00 de Chile el
        // pedido se habría comprometido para MAÑANA.
        fecha_compromiso: entrada.fechaCompromiso ?? hoyEnSantiago(),
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
        // Procedencia: la escribe el INSERT de arriba como 'rutax_manual'. Se
        // lee de la fila y no se repite el literal, para que no puedan divergir.
        fuente: pedido.fuente,
      },
    });
  } catch {
    // Evento best-effort post-commit. NUNCA relanzar — no debe bloquear la
    // creación del pedido.
    //
    // ⚠️ OJO CON LO QUE PASA DESPUÉS. Una versión anterior de este comentario
    // decía que "el job de geocoding lo procesará por barrido". Ese barrido NO
    // EXISTE (verificado 2026-08-13): el registro de Inngest tiene un solo job
    // de geocoding y su único disparo es este evento — no hay cron. Si el send
    // falla, el pedido queda con `geo_estado = 'pendiente'` y `lat`/`long` en
    // NULL INDEFINIDAMENTE, y nada automático lo detecta.
    //
    // El único desatasco es manual y pedido por pedido: el filtro "sin
    // ubicación" de `/operaciones` los encuentra, y `accionReubicarPedido`
    // resetea el estado y republica el evento. Importa para el ruteo: una ruta
    // se calcula sobre coordenadas, así que un pedido sin ubicar es un pedido
    // que no se puede secuenciar.
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

