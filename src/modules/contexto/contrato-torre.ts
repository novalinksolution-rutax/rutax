/**
 * Contrato de la Torre de control — los tipos, del lado del servidor.
 * =====================================================================
 *
 * Espejo de los TIPOS del contrato congelado `docs/torre-de-control/datos-dummy.ts`.
 * Aquí van solo los tipos: los datos de ejemplo siguen viviendo en la fixture
 * del frontend (`src/app/(consola)/torre-de-control/_fixture/estado-torre.ts`),
 * que desde ahora los REEXPORTA desde este archivo.
 *
 * POR QUÉ AQUÍ Y NO EN LA FIXTURE. El composer produce `EstadoTorre` y la
 * pantalla lo consume. Si cada lado tuviera su propia copia de los tipos, el
 * compilador no vería un desajuste entre lo que el servidor arma y lo que la
 * interfaz espera — dos formas «iguales» pueden divergir campo a campo sin que
 * nada lo note. Con una sola declaración, el error es de compilación.
 *
 * Y en este archivo y no en `tipos.ts` porque son cosas distintas: `tipos.ts` es
 * el vocabulario INTERNO del módulo (franjas, horizontes del motor, factores);
 * esto es el contrato EXTERNO con la pantalla, congelado por el handoff de
 * diseño. `tipos.ts` puede evolucionar; esto no, salvo que el handoff cambie.
 *
 * Regla de este archivo: **cero invención**. Todo tipo y todo campo es idéntico
 * al original. Lo único aditivo es `TorreRespuesta`, al final, que envuelve los
 * tres horizontes precalculados sin tocar `EstadoTorre`.
 */

// =============================================================================
// 1. Primitivas
// =============================================================================

/** Horizonte temporal que el usuario selecciona. Gobierna toda la pantalla. */
export type Horizonte = 'hoy' | 'manana' | '72h' | 'olas';

/** Nivel de riesgo derivado del puntaje. La UI decide cómo representarlo. */
export type NivelRiesgo = 'calmo' | 'bajo' | 'medio' | 'alto' | 'critico';

/** Severidad de una excepción. Independiente del puntaje de zona. */
export type Severidad = 'critica' | 'alta' | 'media' | 'informativa';

/** Estado de salud de una fuente externa. Nunca desaparece: se marca. */
export type EstadoFuente = 'ok' | 'atrasada' | 'caida';

/** Capas conmutables del mapa. Regla de producto: máximo 2 activas. */
export type CapaMapa =
  | 'riesgo'
  | 'clima'
  | 'aire'
  | 'transito'
  | 'eventos'
  | 'conductores'
  | 'pedidos'
  | 'comunas';

/** Nivel de zoom semántico. Determina la unidad de agregación visible. */
export type NivelZoom = 'zonas' | 'comunas' | 'pedidos';

export interface Coordenada {
  lat: number;
  long: number;
}

/**
 * Rango temporal. Fechas ISO 8601 con offset de Santiago.
 * `fin: null` = en curso, sin término conocido (una falla, un corte abierto).
 * La UI debe resolver ese caso: "desde las 08:05" en vez de un rango cerrado.
 */
export interface Ventana {
  inicio: string;
  fin: string | null;
}

// =============================================================================
// 2. Frescura de fuentes
// =============================================================================

/**
 * Edad y salud de cada fuente externa. Se muestra siempre: en un producto de
 * dinero, saber cuán viejo es el dato es parte de poder confiar en él.
 */
export interface FrescuraFuente {
  id: string;
  nombre: string;
  estado: EstadoFuente;
  /** Última actualización exitosa. */
  actualizadoEn: string;
  /** Minutos transcurridos desde `actualizadoEn`. Precalculado para la UI. */
  edadMinutos: number;
  /** Cada cuántos minutos debería refrescarse. Si edad > 2×, pasa a 'atrasada'. */
  cadenciaMinutos: number;
  /** Presente solo si estado !== 'ok'. Se muestra al usuario tal cual. */
  motivo: string | null;
}

// =============================================================================
// 3. Zonas y su riesgo
// =============================================================================

/**
 * Un factor del puntaje de riesgo. El motor es determinístico y explicable:
 * la suma ponderada de `valor × peso` da el puntaje de la zona.
 */
export interface FactorRiesgo {
  id: 'presion_operativa' | 'clima' | 'aire' | 'transito' | 'eventos' | 'historico';
  etiqueta: string;
  /** 0–100. Qué tan malo está este factor. */
  valor: number;
  /** 0–1. Cuánto pesa en el puntaje final. Suma 1 entre todos los factores. */
  peso: number;
  /** Frase corta que explica el valor. Se muestra al abrir el desglose. */
  explicacion: string;
}

/** Ventana de corte de la zona: hasta cuándo se puede seguir despachando. */
export interface VentanaCorte {
  hora: string;
  /** Minutos que faltan para el corte. Negativo si ya venció. */
  minutosRestantes: number;
}

export interface Zona {
  id: string;
  nombre: string;
  comunas: string[];
  /** 0–100. Suma ponderada de los factores. */
  riesgo: number;
  nivel: NivelRiesgo;
  factores: FactorRiesgo[];
  pedidosPendientes: number;
  pedidosEntregados: number;
  /** Capacidad estimada = conductores disponibles × capacidad individual. */
  capacidadEstimada: number;
  conductoresAsignados: number;
  conductoresDisponibles: number;
  ventanaCorte: VentanaCorte;
  /** Monto de cobro asociado a los pedidos pendientes. NO es pérdida esperada. */
  montoComprometidoClp: number;
  /** Centro visual de la zona, para etiquetas y encuadre. */
  centro: Coordenada;
}

// =============================================================================
// 4. Métricas de resumen
// =============================================================================

export interface MetricaResumen {
  id: string;
  etiqueta: string;
  /** Valor ya formateado para mostrar. La UI no debería tener que formatear. */
  valor: string;
  /** Valor crudo, por si el diseño quiere formatear distinto. */
  valorCrudo: number;
  /** Variación contra el mismo día de la semana anterior. null = sin base. */
  variacionPorcentual: number | null;
  /** Contexto corto. Puede ir como subtítulo o tooltip. */
  detalle: string;
}

// =============================================================================
// 5. Excepciones (el riel de alertas)
// =============================================================================

/** Acción que la excepción sugiere. La UI la presenta como control. */
export interface AccionSugerida {
  id: string;
  etiqueta: string;
  /** Qué pasa al ejecutarla. Se muestra antes de confirmar. */
  descripcion: string;
  /** true = requiere confirmación explícita antes de ejecutar. */
  requiereConfirmacion: boolean;
}

export interface Excepcion {
  id: string;
  severidad: Severidad;
  titulo: string;
  cuerpo: string;
  zonaId: string | null;
  /** Cuándo ocurre el problema, no cuándo se detectó. */
  ventana: Ventana | null;
  /** Pedidos del courier afectados. 0 = alerta contextual sin impacto directo. */
  pedidosAfectados: number;
  montoAfectadoClp: number;
  acciones: AccionSugerida[];
  /** De dónde salió: motor de riesgo, señal de prensa, marca manual. */
  origen: 'motor' | 'senal' | 'manual';
  /** 0–1. Solo presente cuando el origen es 'senal'. */
  confianza: number | null;
  detectadaEn: string;
  /** El coordinador puede descartarla; eso calibra umbrales. */
  descartable: boolean;
}

// =============================================================================
// 6. Ola entrante (calendario comercial)
// =============================================================================

/**
 * Dos arquetipos con comportamiento opuesto:
 * - 'venta': la ola de entregas llega DESPUÉS del evento (D+1 a D+5).
 * - 'regalo': la ola llega ANTES y el plazo es duro (la fecha es el deadline).
 */
export type ArquetipoOla = 'venta' | 'regalo';

/** Un día de la curva de entregas proyectada. */
export interface PuntoCurva {
  fecha: string;
  /** Etiqueta corta para el eje. */
  etiquetaDia: string;
  /** Desplazamiento respecto al evento. Negativo = antes. */
  offsetDias: number;
  pedidosProyectados: number;
  /** Volumen que habría sin el evento. Sirve de línea base. */
  pedidosBase: number;
  /** Capacidad instalada ese día. Si es menor que lo proyectado, hay brecha. */
  capacidadEstimada: number;
  esPeak: boolean;
}

/** Hito de preparación con cuenta regresiva. */
export interface HitoPreparacion {
  id: string;
  /** Días antes del evento en que corresponde hacerlo. */
  tMenosDias: number;
  fechaLimite: string;
  titulo: string;
  estado: 'pendiente' | 'hecho' | 'vencido';
}

export interface OlaEntrante {
  id: string;
  nombre: string;
  arquetipo: ArquetipoOla;
  organizador: string | null;
  /** Fecha del evento comercial en sí. */
  fechaEvento: Ventana;
  diasParaEvento: number;
  /** Ventana en que llegan las entregas. Distinta de `fechaEvento`. */
  ventanaEntregas: Ventana;
  /** Variación esperada del volumen contra una semana base. */
  variacionEsperadaPct: number;
  curva: PuntoCurva[];
  /** Día con mayor brecha entre proyección y capacidad. */
  diaCritico: string;
  brechaConductores: number;
  /** Solo para arquetipo 'regalo': hasta cuándo puede comprar el cliente final. */
  fechaLimiteCompraPorZona: { zonaId: string; fecha: string }[] | null;
  hitos: HitoPreparacion[];
  /** De dónde salió el multiplicador: catálogo o histórico propio del courier. */
  fuenteProyeccion: 'catalogo' | 'historico_tenant';
}

/** Calendario comercial chileno. */
export interface EventoComercial {
  id: string;
  nombre: string;
  arquetipo: ArquetipoOla;
  organizador: string | null;
  inicio: string;
  fin: string;
  /** Multiplicador de volumen sobre la línea base. */
  multiplicadorBase: number;
  /** Distribución del rezago: clave = offset en días, valor = proporción. */
  curvaRezago: Record<string, number>;
}

// =============================================================================
// 7. Línea de tiempo del día
// =============================================================================

/** Un bloque en la franja temporal. Puede solaparse con otros. */
export interface BloqueTimeline {
  id: string;
  tipo: 'ventana_reparto' | 'clima' | 'evento' | 'corte_en_riesgo' | 'restriccion';
  etiqueta: string;
  inicio: string;
  fin: string;
  zonaId: string | null;
  /** Carril visual sugerido para evitar solapes. La UI puede ignorarlo. */
  carril: number;
}

// =============================================================================
// 8. Capas del mapa
// =============================================================================

export interface EstadoCapa {
  id: CapaMapa;
  etiqueta: string;
  activa: boolean;
  /** false cuando su fuente está caída. Se muestra deshabilitada, no oculta. */
  disponible: boolean;
  /** Motivo de indisponibilidad, para mostrar al usuario. */
  motivoNoDisponible: string | null;
}

// =============================================================================
// 9. Entidades geográficas del mapa
// =============================================================================

export interface ConductorEnMapa {
  id: string;
  nombre: string;
  zonaId: string;
  posicion: Coordenada;
  ultimoPing: string;
  /** Minutos desde el último ping. Si supera 20, se marca como sin señal. */
  minutosSinPing: number;
  paradasTotales: number;
  paradasCompletadas: number;
  estado: 'en_ruta' | 'detenido' | 'sin_senal' | 'finalizado';
}

/** Evento de ciudad con radio de influencia. */
export interface EventoCiudad {
  id: string;
  nombre: string;
  tipo: 'deportivo' | 'masivo' | 'civico' | 'comercial';
  recinto: string;
  comuna: string;
  posicion: Coordenada;
  radioMetros: number;
  ventana: Ventana;
  asistenciaEstimada: number | null;
  fuente: string;
}

/** Celda de precipitación. Geometría simplificada como círculo. */
export interface CeldaClima {
  id: string;
  tipo: 'lluvia' | 'viento';
  centro: Coordenada;
  radioMetros: number;
  intensidadMmHora: number;
  ventana: Ventana;
  zonasAfectadas: string[];
}

export interface IncidenteTransito {
  id: string;
  tipo: 'accidente' | 'corte' | 'congestion' | 'obra';
  descripcion: string;
  via: string;
  posicion: Coordenada;
  magnitud: 1 | 2 | 3 | 4;
  desde: string;
  hasta: string | null;
  zonaId: string;
}

/** Marca puesta a mano por el coordinador. Alimenta el mapa y el histórico. */
export interface MarcaOperativa {
  id: string;
  nota: string;
  posicion: Coordenada;
  radioMetros: number;
  ventana: Ventana;
  autor: string;
  creadaEn: string;
}

// =============================================================================
// 10. Calidad del aire y restricción vehicular
// =============================================================================

export type NivelAire = 'bueno' | 'regular' | 'alerta' | 'preemergencia' | 'emergencia';

export interface PronosticoAire {
  fecha: string;
  pm25Maximo: number;
  nivel: NivelAire;
  /** true cuando el pronóstico proyecta un episodio, aún sin decreto oficial. */
  esProyeccion: boolean;
}

export interface RestriccionVehicular {
  fecha: string;
  tipo: 'permanente' | 'preemergencia' | 'emergencia';
  digitos: number[];
  alcance: string;
  /** Vehículos del courier afectados. null si el modelo aún no guarda patentes. */
  vehiculosAfectados: number | null;
}

// =============================================================================
// 11. Señales de prensa
// =============================================================================

export interface FuenteSenal {
  medio: string;
  titular: string;
  url: string;
  publicadoEn: string;
}

export interface Senal {
  id: string;
  /** Título del acontecimiento, no del artículo. Uno por evento, no por medio. */
  titulo: string;
  resumen: string;
  tipo: 'corte_transito' | 'manifestacion' | 'paro' | 'emergencia' | 'transporte' | 'otro';
  comunas: string[];
  ejesViales: string[];
  ventana: Ventana | null;
  severidad: Severidad;
  /** 0–1. Sube cuando varios medios independientes reportan lo mismo. */
  confianza: number;
  afectaOperacion: boolean;
  pedidosEnRango: number;
  zonasAfectadas: string[];
  fuentes: FuenteSenal[];
  /** El coordinador marca si era relevante; eso calibra el filtro. */
  marcaHumana: 'confirmada' | 'descartada' | null;
}

// =============================================================================
// 12. Estados de la pantalla
// =============================================================================

/**
 * Estados que la interfaz DEBE resolver explícitamente. No son casos borde:
 * son estados de diseño de primera clase.
 */
export type EstadoPantalla =
  /** Datos completos y al menos una excepción. El caso de la captura. */
  | 'con_excepciones'
  /** Sin riesgo: se dice en una línea y la pantalla se calla. */
  | 'tranquilo'
  /** Primera carga. Cada panel llega por separado, ninguno bloquea al otro. */
  | 'cargando'
  /** Una o más fuentes caídas. El resto sigue funcionando. */
  | 'degradado'
  /** El courier no configuró zonas. Se usa el fallback y se invita a configurar. */
  | 'sin_zonas'
  /** No hay pedidos hoy (feriado, domingo). */
  | 'sin_pedidos';

export interface MensajeEstado {
  estado: EstadoPantalla;
  titulo: string;
  cuerpo: string;
  accion: { etiqueta: string; destino: string } | null;
}

// =============================================================================
// 13. Interacciones
// =============================================================================

/**
 * Contrato de interacción. Define QUÉ hace cada gesto, no cómo se ve ni cómo
 * se anima. Los tiempos son presupuestos de respuesta percibida, no de estilo.
 */
export interface Interaccion {
  id: string;
  gesto: string;
  resultado: string;
  /** Milisegundos máximos hasta que el usuario ve una respuesta. */
  presupuestoMs: number;
  atajoTeclado: string | null;
}

// =============================================================================
// 14. Raíz — todo el estado de la pantalla en un objeto
// =============================================================================

export interface EstadoTorre {
  courier: { id: string; nombre: string };
  ahora: string;
  horizonte: Horizonte;
  estado: EstadoPantalla;
  zoom: NivelZoom;
  zonaSeleccionada: string | null;
  metricas: MetricaResumen[];
  zonas: Zona[];
  excepciones: Excepcion[];
  senales: Senal[];
  olaEntrante: OlaEntrante | null;
  timeline: BloqueTimeline[];
  rangoTimeline: Ventana;
  capas: EstadoCapa[];
  frescura: FrescuraFuente[];
  conductores: ConductorEnMapa[];
  eventosCiudad: EventoCiudad[];
  celdasClima: CeldaClima[];
  incidentesTransito: IncidenteTransito[];
  marcasOperativas: MarcaOperativa[];
  pronosticoAire: PronosticoAire[];
  restricciones: RestriccionVehicular[];
  pedidosSinGeocodificar: number;
}

// =============================================================================
// 15. Envoltorio de horizontes — ADITIVO, el contrato congelado queda intacto
// =============================================================================

/**
 * Los tres horizontes del motor de riesgo. `'olas'` NO está aquí: no es un
 * horizonte del motor sino la proyección de volumen del calendario comercial
 * (§12 del diseño técnico), con su propio mecanismo y su propia fuente.
 */
export type HorizonteTorre = 'hoy' | 'manana' | '72h';

export const HORIZONTES_TORRE: readonly HorizonteTorre[] = ['hoy', 'manana', '72h'];

/**
 * Lo que el composer devuelve a la pantalla.
 *
 * **Los tres horizontes vienen PRECALCULADOS, en el mismo payload.** El contrato
 * de interacción lo exige (`cambiar-horizonte`: 300 ms, «los datos vienen
 * precalculados»): cambiar de horizonte no puede disparar un viaje al servidor,
 * porque eso remontaría el tablero y haría saltar la posición de scroll del
 * riel, que es justo lo que el handoff prohíbe.
 *
 * Es aditivo: `EstadoTorre` no cambia ni un campo. Cada valor del mapa es un
 * `EstadoTorre` completo y autoconsistente para su fecha.
 */
export interface TorreRespuesta {
  /** Horizonte con el que abre la consola. Hoy siempre `'hoy'`. */
  horizonteInicial: Horizonte;
  horizontes: Record<HorizonteTorre, EstadoTorre>;
}
