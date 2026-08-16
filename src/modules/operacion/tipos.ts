/**
 * Tipos del módulo `operacion` — interfaces TypeScript y enums que espejan
 * exactamente los tipos de Postgres definidos en la migración 0005.
 *
 * Regla de límite: este archivo NO importa nada de `dinero`. Las columnas
 * financieras (monto_cobro_clp, etc.) existen en la BD pero solo Fase C las
 * escribe. Aquí solo se modelan para lectura (campos opcionales de solo lectura).
 */

// =============================================================================
// Enums — espejo de los tipos operacion.* en Postgres (migración 0005)
// =============================================================================

export const ESTADOS_PEDIDO = [
  "pendiente_asignacion",
  "asignado",
  "en_ruta",
  "entregado",
  "entregado_manual",
  "fallido",
  "fallido_manual",
  "cancelado",
  "devuelto",
] as const;

export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

/** Estados terminales: ninguna transición válida desde ellos. */
export const ESTADOS_TERMINALES: readonly EstadoPedido[] = [
  "entregado",
  "entregado_manual",
  "cancelado",
  "devuelto",
];

/**
 * Régimen operativo y de tarifa del pedido — espejo de `operacion.tipo_pedido`.
 *
 * ⚠️ **NO es el eje de procedencia.** Lo fue mientras las únicas dos maneras de
 * que naciera un pedido eran la ingesta de Mercado Libre y el alta manual, y por
 * eso los valores llevan nombre de marketplace. Desde que existen más fuentes
 * (Shopify, y luego Falabella), la procedencia vive en `FuentePedido` y este eje
 * significa solo dos cosas:
 *
 * - `flex`     : el POD lo gobierna Mercado Envíos; Rutax solo registra un cierre
 *                paralelo que NO mueve el estado.
 * - `same_day` : el POD de Rutax es autoritativo, mueve el estado y dispara el
 *                motor entrega→dinero. Es el régimen de todo pedido cuya fuente
 *                no impone una app de escaneo externa — incluido Shopify.
 *
 * También es la clave de tarifa (`identidad.tarifas.tipo_entrega` usa el mismo par).
 * Para decidir quién es dueño de la prueba de entrega usa
 * `podEsAutoritativoEnRutax(fuente)` de `./fuente`, nunca este enum.
 */
export const TIPOS_PEDIDO = ["flex", "same_day"] as const;
export type TipoPedido = (typeof TIPOS_PEDIDO)[number];

/**
 * Modo de descubrimiento del pedido — espejo de `operacion.origen_pedido`.
 *
 * Columna HEREDADA: se escribe y se muestra, pero no se compara en ninguna parte
 * del código de producción. Mezcla procedencia (`ml_ingesta`, `same_day_manual`)
 * con modo de descubrimiento (`backfill`), que es justamente por lo que no sirve
 * como eje de fuente. Se conserva por trazabilidad de cómo entró cada fila.
 */
export const ORIGENES_PEDIDO = [
  "ml_ingesta",
  "same_day_manual",
  "backfill",
  "shopify_ingesta",
] as const;
export type OrigenPedido = (typeof ORIGENES_PEDIDO)[number];

/**
 * Procedencia del pedido — espejo de `operacion.fuente_pedido`
 * (migración 20260816000001). **Es el eje autoritativo de fuente.**
 *
 * - `ml_flex`      : ingestado desde una cuenta de Mercado Libre (Flex).
 * - `rutax_manual` : creado a mano en Rutax (same-day ad-hoc).
 * - `shopify`      : ingestado desde la tienda Shopify de un seller.
 *
 * Ortogonal a `TipoPedido`: `shopify` viaja con `tipo_pedido='same_day'` porque
 * ese es su régimen de POD y de tarifa, no porque venga del alta manual.
 */
export const FUENTES_PEDIDO = ["ml_flex", "rutax_manual", "shopify"] as const;
export type FuentePedido = (typeof FUENTES_PEDIDO)[number];

/**
 * Situación de retiro — espejo de `operacion.situacion_retiro`
 * (migración 20260812000002). Eje PROPIO de Rutax sobre la tenencia física del
 * bulto, ORTOGONAL a `EstadoPedido` y a `estadoMl`: en Flex el ciclo del envío
 * lo gobierna Mercado Libre, así que un valor propio no cabe en esa máquina.
 *
 * Existe porque un seller despacha con VARIOS couriers: la ingesta desde su
 * cuenta de ML trae el universo de CANDIDATOS y solo el escaneo del conductor en
 * la bodega dice cuáles son de este courier ese día. Es la reja de la pantalla de
 * asignación — sin ella se generan cobros al seller por entregas ajenas.
 * Ver docs/arquitectura/retiro-y-ruteo.md §2.1 y §13bis-1.3.
 *
 * - `pendiente`    : ingestado, nadie lo tocó. Default de toda fila nueva.
 * - `retirado`     : escaneado en una bodega; está en poder del courier.
 * - `no_procesado` : pasaron los días y nunca se retiró (lo despachó otro courier).
 */
export const SITUACIONES_RETIRO = ["pendiente", "retirado", "no_procesado"] as const;
export type SituacionRetiro = (typeof SITUACIONES_RETIRO)[number];

// =============================================================================
// Enums de geocoding — espejan operacion.geo_estado y operacion.cobertura_estado
// (migración 0013). Se declaran localmente para que operacion NO dependa de
// integraciones. Los valores coinciden exactamente con los enums de Postgres.
// =============================================================================

export const ESTADOS_GEOCODING = [
  "pendiente",
  "resuelto",
  "no_resuelto",
  "fuera_cobertura",
] as const;
export type EstadoGeocoding = (typeof ESTADOS_GEOCODING)[number];

export const ESTADOS_COBERTURA = [
  "pendiente",
  "tarifada",
  "sin_tarifa_zona",
  "requiere_revision",
] as const;
export type CoberturaEstado = (typeof ESTADOS_COBERTURA)[number];

export const TIPOS_INCIDENCIA = [
  "destinatario_ausente",
  "direccion_erronea",
  "paquete_danado",
  "rechazo_destinatario",
  "problema_acceso",
  "reagendado",
  "otro",
] as const;
export type TipoIncidencia = (typeof TIPOS_INCIDENCIA)[number];

export const ESTADOS_INCIDENCIA = ["abierta", "en_gestion", "resuelta", "cerrada"] as const;
export type EstadoIncidencia = (typeof ESTADOS_INCIDENCIA)[number];

export const ESTADOS_MANIFIESTO = [
  "borrador",
  "confirmado",
  "en_ruta",
  "completado",
  "cancelado",
] as const;
export type EstadoManifiesto = (typeof ESTADOS_MANIFIESTO)[number];

// =============================================================================
// Entidades de dominio — Zonas y ventanas de corte (migración 0014 — F7, ítem 1.2)
// =============================================================================

/** Agrupación operativa de comunas por tenant (espejo de identidad.zonas). */
export interface Zona {
  id: string;
  tenantId: string;
  nombre: string;
  activa: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

/** Mapeo comuna→zona por tenant (espejo de identidad.zona_comunas). */
export interface ZonaComuna {
  id: string;
  tenantId: string;
  zonaId: string;
  comuna: string;
  creadoEn: string;
}

/**
 * SLA + hora de corte por seller (espejo de identidad.ventanas_corte).
 * `zonaId = null` = ventana por defecto del seller.
 * `horaCorte` es 'HH:MM' — hora LOCAL America/Santiago sin TZ.
 */
export interface VentanaCorte {
  id: string;
  tenantId: string;
  sellerId: string;
  zonaId: string | null;
  tipoEntrega: TipoPedido;
  /** Hora de corte en formato 'HH:MM', local America/Santiago. */
  horaCorte: string;
  minutosPreparacion: number;
  minutosRutaEstimado: number;
  /** Objetivo de SLA 0–100 (%, default 97). */
  slaObjetivoPct: number;
  activa: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

// =============================================================================
// Entidades de dominio
// =============================================================================

export interface Pedido {
  id: string;
  tenantId: string;
  sellerId: string;
  tipoPedido: TipoPedido;
  fuente: FuentePedido;
  origen: OrigenPedido;
  mlOrderId: string | null;
  mlShipmentId: string | null;
  /** Id del pedido en su fuente (gid de Shopify, etc.). `null` en Flex y same-day manual. */
  idExterno: string | null;
  /** Referencia que el humano ve en la fuente (p. ej. `#1001` de Shopify). */
  referenciaExterna: string | null;
  estado: EstadoPedido;
  estadoMl: string | null;
  subestadoMl: string | null;
  ultimaSyncMlEn: string | null;
  driverIdAsignado: string | null;
  destinatarioNombre: string;
  destinatarioDireccion: string;
  destinatarioComuna: string;
  destinatarioTelefono: string | null;
  instruccionesEntrega: string | null;
  fechaCompromiso: string | null;
  tarifaAplicableId: string | null;
  // Columnas de Fase C — presentes en BD, solo lectura en Fase B
  readonly montoCobroClp?: number | null;
  readonly montoLiquidacionClp?: number | null;
  readonly cobroGenerado?: boolean;
  readonly liquidacionGenerada?: boolean;
  notasInternas: string | null;
  creadoEn: string;
  actualizadoEn: string;
  // Columnas de geocoding (migración 0013 — F4, ítem 1.1)
  lat: number | null;
  long: number | null;
  /** Estado de geocodificación: pendiente|resuelto|no_resuelto|fuera_cobertura */
  geoEstado: EstadoGeocoding;
  /** Confianza del proveedor (0.000–1.000). null si aún no geocodificado. */
  geoConfianza: number | null;
  /** Momento en que el pedido fue geocodificado. null mientras pendiente. */
  geocodificadoEn: string | null;
  /** Estado de cobertura/tarificación: pendiente|tarifada|sin_tarifa_zona|requiere_revision */
  coberturaEstado: CoberturaEstado;
  // Columnas de SLA/corte (migración 0014 — F7, ítem 1.2)
  // Opcionales para compatibilidad con objetos literales de frontend que aún
  // no incluyen estas columnas (se garantizan en BD con DEFAULT).
  /** Instante prometido de entrega (timestamptz). null si no hay ventana configurada. */
  fechaCompromisoHora?: string | null;
  /** true = el pedido ingresó cerca/después de la hora de corte (riesgo). Default false. */
  corteRiesgo?: boolean;
  /** null hasta llegar a estado terminal; true/false según la entrega vs. fecha_compromiso_hora. */
  slaCumplido?: boolean | null;
  // Columnas de tracking same-day (migración 0016 — Bloque 2)
  /** Token opaco para el enlace de tracking en vivo. Presente SOLO en same_day. */
  trackingToken?: string | null;
  /**
   * Código interno operativo `RX-XXXX-XXXX` (Base32 Crockford) para la etiqueta
   * imprimible con QR. Único por tenant. `null` hasta que se genera — para
   * pedidos same-day antiguos, `asegurarCodigoInterno` hace backfill perezoso.
   */
  codigoInterno?: string | null;
  // Columnas de cancelación (migración 20260811000003 — cancelación same-day).
  /** Momento en que el pedido pasó a 'cancelado'. `null` mientras no lo esté. */
  canceladoEn?: string | null;
  /**
   * UUID de auth.users que canceló el pedido (RNF-04). `null` cuando la
   * cancelación no la hizo una persona (sincronización ML) o el pedido no está
   * cancelado.
   */
  canceladoPorUsuarioId?: string | null;
  /**
   * ⚠️ VISIBLE PARA EL SELLER (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md
   * §6.2) — `public.pedidos` es `select *` y P2 deja al seller leer sus propias
   * filas completas. Nada de información comercial reservada.
   */
  motivoCancelacion?: string | null;
  // Situación de retiro (migración 20260812000002 — retiro en bodega, etapa 1).
  // Opcionales por la misma razón que las de arriba: hay proyecciones de `Pedido`
  // construidas a mano en pantallas que todavía no seleccionan estas columnas.
  // En BD son NOT NULL con default (`pendiente`) y nullable respectivamente.
  /**
   * ¿Está el bulto en poder del courier? Eje propio de Rutax, independiente de
   * `estado`. Es la reja de la pantalla de asignación: solo se ofrece `retirado`.
   *
   * ⚠️ El mapeo desde BD cae a `'pendiente'` cuando la columna no viene en el
   * SELECT. Es a propósito y falla CERRADO: ante el dato ausente, el pedido no se
   * ofrece para asignar. Lo contrario abriría la compuerta por descuido.
   */
  situacionRetiro?: SituacionRetiro;
  /**
   * Momento del escaneo que lo dejó en `retirado`. `null` mientras no se retire y
   * también en los pedidos anteriores a la migración (el instante no se conoce y
   * no se inventa).
   */
  retiradoEn?: string | null;
}

export interface Manifiesto {
  id: string;
  tenantId: string;
  driverId: string;
  nombre: string;
  fechaOperacion: string;
  estado: EstadoManifiesto;
  notas: string | null;
  creadoPorUsuarioId: string | null;
  confirmadoEn: string | null;
  completadoEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

export interface AsignacionPedido {
  id: string;
  tenantId: string;
  pedidoId: string;
  manifiestoId: string;
  driverId: string;
  sellerId: string;
  activa: boolean;
  asignadoPorUsuarioId: string | null;
  asignadoEn: string;
  desasignadoEn: string | null;
}

export interface Incidencia {
  id: string;
  tenantId: string;
  pedidoId: string;
  sellerId: string;
  tipo: TipoIncidencia;
  estado: EstadoIncidencia;
  descripcion: string | null;
  notasResolucion: string | null;
  afectaCobro: boolean;
  afectaLiquidacion: boolean;
  abiertaPorUsuarioId: string | null;
  resueltaPorUsuarioId: string | null;
  abiertaEn: string;
  resueltaEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

// =============================================================================
// Entidades de dominio — Conductor con disponibilidad y zonas (F6, ítem 1.3)
// =============================================================================

/**
 * Conductor tal como lo consume el auto-assign: campos de identidad + los dos
 * nuevos de disponibilidad (migración 0015). NO contiene datos personales
 * sensibles — solo lo necesario para la heurística de asignación.
 */
export interface Conductor {
  id: string;
  tenantId: string;
  /** Alta/baja en nómina: 'activo' | 'inactivo'. Solo 'activo' entra al pool. */
  estado: 'activo' | 'inactivo';
  /**
   * Disponibilidad operativa del día. DISTINTA de `estado`:
   * un conductor activo con disponible=false (día libre, licencia) no recibe
   * auto-asignación pero sigue de alta en la nómina.
   */
  disponible: boolean;
  /** Cupo máximo de paradas en el turno (> 0). Constraint en BD. */
  capacidadParadas: number;
  /** Nombre para logs/bitácora — no se usa en la heurística. */
  nombre: string;
  // Datos bancarios para liquidación (migración 20260621000012 — F19).
  // Nullables: el flujo F19 lanza NonRetriableError si son null.
  /** Nombre del banco (ej. "Banco de Chile", "BCI"). */
  banco?: string | null;
  /** Tipo de cuenta bancaria: 'corriente' | 'vista' | 'ahorro'. */
  tipoCuenta?: 'corriente' | 'vista' | 'ahorro' | null;
  /** Número de cuenta (texto para preservar ceros iniciales). */
  numeroCuenta?: string | null;
}

/**
 * Zona preferente asignada a un conductor (espejo de identidad.conductor_zonas).
 * N:M conductor↔zona, acotado por tenant.
 */
export interface ConductorZona {
  id: string;
  tenantId: string;
  conductorId: string;
  zonaId: string;
  creadoEn: string;
}

// =============================================================================
// Tipos del motor de auto-asignación (F6, ítem 1.3)
// =============================================================================

/**
 * Motivo por el que un pedido no pudo ser auto-asignado.
 * - 'sin_conductor_disponible' : no existe ningún conductor activo+disponible en el pool.
 * - 'sin_cupo'                 : hay conductores disponibles pero todos superaron su capacidad.
 * - 'sin_conductor_en_zona'    : NO SE USA como discriminador primario (la heurística
 *                                 degrada zona→ocupación, no rechaza). Se emite solo
 *                                 cuando TODOS los candidatos sin cupo eran de otra zona.
 */
export type MotivoSinAsignar =
  | 'sin_conductor_disponible'
  | 'sin_cupo'
  | 'sin_conductor_en_zona';

/** Pedido que no pudo asignarse, con el motivo estructurado. */
export interface PedidoSinAsignar {
  pedidoId: string;
  sellerId: string;
  /** Comuna del pedido (para cálculo de impacto SLA por seller). */
  comunaDestino: string;
  motivo: MotivoSinAsignar;
}

/** SLA impactado por conductor caído o pedidos sin asignar, por seller. */
export interface ImpactoSla {
  sellerId: string;
  sellerNombre: string;
  /** SLA actual del seller (% de pedidos a tiempo sobre evaluados). null si sin datos. */
  slaPctActual: number | null;
  /** Objetivo pactado (de ventanas_corte, default 97). */
  objetivoPct: number;
  /** Paradas del seller que quedaron sin conductor en la redistribución. */
  paradasSinConductor: number;
}

/**
 * Resultado de `marcarConductorNoDisponibleYRedistribuir`.
 * Incluye el impacto en SLA de los sellers afectados.
 */
export interface ResultadoRedistribucion {
  conductorId: string;
  /** Paradas que tenía el conductor y se redistribuyeron exitosamente. */
  paradasReasignadas: string[];
  /** Paradas que no encontraron receptor. */
  paradasSinConductor: PedidoSinAsignar[];
  /** Impacto en SLA por seller. */
  impactoSla: ImpactoSla[];
  /** true si el conductor ya estaba disponible=false al ejecutar (no-op). */
  idempotente: boolean;
}

// =============================================================================
// Entradas de las operaciones de módulo
// =============================================================================

export interface FiltrosPedidos {
  tenantId: string;
  sellerId?: string;
  conductorId?: string;
  /**
   * Comuna de destino. Se agregó para los enlaces profundos de la Torre de
   * control (F11): la Torre no ejecuta, solo enlaza, así que cada comuna del
   * mapa tiene que llegar acá **con el filtro ya aplicado**. Si obligara a
   * buscar de nuevo, la pantalla no serviría.
   */
  comuna?: string;
  /** Procedencia del pedido — eje AUTORITATIVO de fuente (ver `FuentePedido`). */
  fuente?: FuentePedido;
  estado?: EstadoPedido;
  fecha?: string; // fecha_compromiso (ISO date)
  /**
   * Si `true`, filtra pedidos que requieren revisión de dirección/cobertura:
   * geo_estado IN ('no_resuelto','fuera_cobertura') OR
   * cobertura_estado IN ('requiere_revision','sin_tarifa_zona').
   * Ignora `estado` y `fecha` cuando está activo (la bandeja no filtra por día).
   */
  porRevisar?: boolean;
  pagina?: number;
  limite?: number;
}

export interface PaginadoPedidos {
  datos: Pedido[];
  total: number;
  pagina: number;
  limite: number;
}

/**
 * Quién ejecuta la transición:
 *   'sistema'   = job/webhook (ML, polling, cron)
 *   'interno'   = usuario humano con rol interno del courier
 *   'conductor' = conductor autenticado (SOLO pedidos same_day; la acotación
 *                 se impone en actualizarEstadoPedido, no aquí — la función pura
 *                 es agnóstica de tipo_pedido).
 *   'seller'    = seller autenticado cancelando SU PROPIO pedido same_day
 *                 (SOLO hasta `asignado`; la acotación de tipo_pedido y de
 *                 pertenencia se impone en `cancelarPedido`, no aquí).
 */
export type EjecutorTransicion = "sistema" | "interno" | "conductor" | "seller";

export interface ActualizarEstadoEntrada {
  pedidoId: string;
  tenantId: string;
  estadoNuevo: EstadoPedido;
  /**
   * Optimistic locking: si el estado actual en BD difiere de este valor,
   * se lanza ErrorConflicto (condición de carrera resuelta — el job termina sin reintento).
   */
  estadoEsperado: EstadoPedido;
  ejecutor: EjecutorTransicion;
  /** Requerido para ejecutor='interno'/'seller': quién realiza el cambio. */
  actuadoPorUsuarioId?: string;
  /** Requerido para correcciones manuales (ejecutor='interno') y cancelación (ejecutor='seller'). */
  motivo?: string;
  /**
   * Solo para ejecutor='conductor': tipo de incidencia que declara el conductor
   * al registrar un fallo (requerido cuando estadoNuevo='fallido').
   */
  tipoIncidenciaConductor?: TipoIncidencia;
  /**
   * Solo para ejecutor='seller' (cancelarPedido): guarda atómica en el WHERE
   * del SELECT y del UPDATE contra la carrera entre lectura y escritura
   * (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md §4.2). Se ignora
   * para cualquier otro ejecutor.
   */
  sellerId?: string;
}

/**
 * Entrada de `cancelarPedido` (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md
 * §7.1). Es la envoltura que valida ventana, `tipo_pedido='same_day'`, RBAC y
 * motivo (≥10 caracteres) antes de delegar la escritura de estado a
 * `actualizarEstadoPedido` (único camino de escritura de estado).
 */
export interface CancelarPedidoEntrada {
  pedidoId: string;
  tenantId: string;
  /** Optimistic locking: el estado que el llamador leyó. */
  estadoEsperado: EstadoPedido;
  /** 'sistema' sigue yendo por actualizarEstadoPedido (ML reporta la cancelación). */
  ejecutor: "interno" | "seller";
  /** UUID de auth. Obligatorio: RNF-04 exige el "quién". */
  actuadoPorUsuarioId: string;
  /** Obligatorio, >= 10 caracteres. Va a bitácora Y a pedidos.motivo_cancelacion. */
  motivo: string;
  /** Solo para ejecutor='seller': guarda atómica en el WHERE. */
  sellerId?: string;
}

export interface CrearPedidoSameDayEntrada {
  tenantId: string;
  sellerId: string;
  destinatarioNombre: string;
  destinatarioDireccion: string;
  destinatarioComuna: string;
  destinatarioTelefono?: string;
  instruccionesEntrega?: string;
  fechaCompromiso?: string;
  notasInternas?: string;
  /** UUID del actor interno que dispara la creación (requerido para bitácora si corte_riesgo). */
  actorUsuarioId?: string;
}

// =============================================================================
// Entradas CRUD Zonas / Ventanas de Corte (F7, ítem 1.2)
// =============================================================================

export interface CrearZonaEntrada {
  tenantId: string;
  nombre: string;
  actorUsuarioId: string;
}

export interface AsignarComunasZonaEntrada {
  tenantId: string;
  zonaId: string;
  /** Lista COMPLETA de comunas de la zona. La operación borra las existentes e inserta estas. */
  comunas: string[];
  actorUsuarioId: string;
}

export interface GuardarVentanaCorteEntrada {
  tenantId: string;
  sellerId: string;
  /** null = ventana por defecto del seller; UUID = override por zona. */
  zonaId: string | null;
  tipoEntrega: TipoPedido;
  /** Hora de corte en formato 'HH:MM', hora local America/Santiago. */
  horaCorte: string;
  minutosPreparacion: number;
  minutosRutaEstimado: number;
  /** Objetivo SLA 0–100. Default 97. */
  slaObjetivoPct?: number;
  actorUsuarioId: string;
}

/**
 * Aviso que se devuelve cuando se crea un pedido fuera del horario de corte.
 * No es un error — el pedido SE CREA igual, pero el coordinador/supervisor
 * debe saber que el compromiso de hora está comprometido.
 */
export interface AvisoCorte {
  /** 'fuera_corte' = hora actual > hora_corte configurada. */
  tipo: 'fuera_corte';
  mensaje: string;
  horaCorte: string;
  /** Sugerencia para el usuario: reagendar o confirmar de igual forma. */
  sugerencia: string;
}

/** Resultado de crearPedidoSameDay cuando hay ventana de corte configurada. */
export interface ResultadoCrearPedidoSameDay {
  pedido: Pedido;
  /** Presente solo cuando el pedido se creó pasado el horario de corte. */
  avisoCorte?: AvisoCorte;
}

export interface CrearManifiestoEntrada {
  tenantId: string;
  driverId: string;
  nombre: string;
  fechaOperacion: string;
  notas?: string;
  creadoPorUsuarioId?: string;
}

export interface AbrirIncidenciaEntrada {
  tenantId: string;
  pedidoId: string;
  sellerId: string;
  tipo: TipoIncidencia;
  descripcion?: string;
  abiertaPorUsuarioId?: string;
  /** Si true, la apertura fue iniciada por un usuario interno (requiere RBAC). */
  esAccionManual?: boolean;
}

export interface ActualizarIncidenciaEntrada {
  incidenciaId: string;
  tenantId: string;
  estado?: EstadoIncidencia;
  notasResolucion?: string;
  resueltaPorUsuarioId?: string;
}

export interface MetricasOperativas {
  totalPedidos: number;
  porEstado: Partial<Record<EstadoPedido, number>>;
  tasaEntrega: number; // 0.0 – 1.0
  incidenciasAbiertas: number;
  conexionesCaidas: number;
  /** Conductores del tenant con estado='activo' (no depende de la fecha). */
  conductoresActivos: number;
  /**
   * Conductores distintos con un manifiesto en estado 'confirmado' o
   * 'en_ruta' para `fecha_operacion` = la fecha de las métricas.
   */
  conductoresListosHoy: number;
  /**
   * Top 5 comunas con más pedidos del día (mismo criterio que `pedidosDia`),
   * ordenado descendente por cantidad. El resto de comunas se agrupa en una
   * entrada con comuna = "Otras" (si existe remanente).
   */
  paquetesPorComuna: Array<{ comuna: string; cantidad: number }>;
  /**
   * Pedidos cuya fecha_compromiso fue el día anterior a la fecha de las
   * métricas y que aún no llegaron a un estado terminal (entregado,
   * entregado_manual, fallido, fallido_manual, cancelado, devuelto).
   */
  rezagadosAyer: number;
  /**
   * % de SLA cumplido sobre el total de pedidos evaluados (sla_cumplido IS NOT NULL)
   * del tenant para la fecha. null si no hay pedidos evaluados.
   * Calculado en metricas.ts (F7, ítem 1.2).
   */
  slaGlobalPct: number | null;
}
