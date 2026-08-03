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

/**
 * Horizonte temporal que el usuario selecciona. Gobierna toda la pantalla.
 *
 * Eran cuatro: `'olas'` se fusionó con `'72h'`. No era un horizonte del motor
 * sino una vista aparte que nunca se construyó y caía a «hoy», mientras 72 h se
 * veía casi vacío por diseño (solo cuenta pedidos YA ingestados). La ola
 * entrante se calcula una vez y se muestra en los tres horizontes, así que
 * fusionarlos no perdió nada: quitó un modo que no llevaba a ninguna parte.
 */
export type Horizonte = 'hoy' | 'manana' | '72h';

/** Nivel de riesgo derivado del puntaje. La UI decide cómo representarlo. */
export type NivelRiesgo = 'calmo' | 'bajo' | 'medio' | 'alto' | 'critico';

/** Severidad de una excepción. Independiente del puntaje de zona. */
export type Severidad = 'critica' | 'alta' | 'media' | 'informativa';

/** Estado de salud de una fuente externa. Nunca desaparece: se marca. */
export type EstadoFuente = 'ok' | 'atrasada' | 'caida';

/**
 * Capas conmutables del mapa. Regla de producto: máximo 2 activas.
 *
 * `transito` y `eventos` SALIERON del contrato. Tránsito quedó fuera de alcance
 * (TomTom es de pago y el conductor ya ve la congestión en Waze); eventos de
 * ciudad se quedó sin fuente al parar el pipeline de señales. Los factores
 * homónimos del motor de riesgo SÍ siguen existiendo, en peso 0 y valor 0 —
 * son cosas distintas: el factor explica el puntaje, la capa dibuja el mapa.
 */
export type CapaMapa =
  | 'riesgo'
  | 'clima'
  | 'aire'
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
  /**
   * De dónde salió. `'senal'` se retiró junto con el pipeline de prensa.
   *
   * También se fue `descartable`: el botón de descartar solo ocultaba la ficha
   * en el estado local del navegador y prometía «calibrar umbrales» sin nada
   * detrás. Un control que completa el flujo y no ejecuta nada es peor que su
   * ausencia — el mismo criterio por el que se quitaron «adelantar corte» y
   * «reasignar conductores».
   */
  origen: 'motor' | 'manual';
  detectadaEn: string;
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

/**
 * Un bloque en la franja temporal. Puede solaparse con otros.
 *
 * El tipo `'evento'` salió junto con la capa de eventos de ciudad: sin fuente
 * que la pueble, nadie producía esos bloques.
 */
export interface BloqueTimeline {
  id: string;
  tipo: 'ventana_reparto' | 'clima' | 'corte_en_riesgo' | 'restriccion';
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

/**
 * Un pedido ubicado en el mapa (nivel 3 del zoom).
 *
 * ⚠️ **MINIMIZACIÓN DE DATO PERSONAL — decisión de producto, no de estilo.**
 * Este tipo lleva el PUNTO y el ESTADO, y nada más. No lleva la dirección, ni el
 * nombre del destinatario, ni su teléfono. El mapa pinta un círculo coloreado
 * por estado, sin etiqueta; quien necesite la dirección abre el pedido, y ahí la
 * ve la pantalla de operación con su propio control de acceso.
 *
 * El motivo es el invariante de CLAUDE.md: los datos del destinatario van con
 * minimización. Un tablero que un supervisor deja abierto toda la mañana no
 * tiene por qué mostrar el domicilio de cada cliente del courier.
 *
 * `seguridad-cumplimiento` debe firmar esto antes del release.
 */
export interface PedidoEnMapa {
  id: string;
  posicion: Coordenada;
  /** Estado operativo, para colorear el punto. No se muestra como texto. */
  estado: string;
  /** true cuando el estado ya es terminal (entregado, fallido, cancelado…). */
  cerrado: boolean;
  zonaId: string | null;
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

/**
 * Restricción vehicular vigente. Es LÍNEA DE CONTEXTO, no alerta con impacto.
 *
 * Tenía un `vehiculosAfectados` que iba siempre en `null` y se retiró en vez de
 * llenarlo, porque no se puede llenar con sentido: la restricción PERMANENTE
 * solo aplica a vehículos sin sello verde —una flota de última milla moderna
 * daría 0 siempre, menos informativo que el propio `null`— y la de EPISODIO,
 * que sí importaría, depende de un decreto con dígitos que la autoridad fija
 * arbitrariamente y que el sistema deliberadamente no adivina.
 *
 * Construir la entidad `vehiculos` solo para este conteo no se justifica: si
 * algún día existe, será porque la operación la necesite por sí misma.
 */
export interface RestriccionVehicular {
  fecha: string;
  tipo: 'permanente' | 'preemergencia' | 'emergencia';
  digitos: number[];
  alcance: string;

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
  olaEntrante: OlaEntrante | null;
  timeline: BloqueTimeline[];
  rangoTimeline: Ventana;
  capas: EstadoCapa[];
  frescura: FrescuraFuente[];
  conductores: ConductorEnMapa[];
  celdasClima: CeldaClima[];
  pedidos: PedidoEnMapa[];
  marcasOperativas: MarcaOperativa[];
  pronosticoAire: PronosticoAire[];
  restricciones: RestriccionVehicular[];
  pedidosSinGeocodificar: number;
}

// =============================================================================
// 15. Envoltorio de horizontes — ADITIVO, el contrato congelado queda intacto
// =============================================================================

/**
 * Los horizontes que el motor precalcula. Desde que `'olas'` se fusionó con
 * `'72h'`, coincide exactamente con `Horizonte` — se conserva como alias porque
 * `TorreRespuesta` habla de «los horizontes precalculados», que es un concepto
 * del servidor, no de la pantalla.
 */
export type HorizonteTorre = Horizonte;

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
