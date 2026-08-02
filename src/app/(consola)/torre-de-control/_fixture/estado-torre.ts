/**
 * Torre de control — fixture tipada del frontend.
 * =====================================================================
 *
 * Los DATOS de ejemplo del contrato congelado `docs/torre-de-control/datos-dummy.ts`.
 *
 * ⚠️ **Los TIPOS ya no viven aquí**: se movieron a
 * `@/modules/contexto/contrato-torre` y este archivo los reexporta, así que
 * cualquier import existente (`import type { Zona } from "../_fixture/estado-torre"`)
 * sigue funcionando sin cambios.
 *
 * Por qué se movieron: el composer del servidor produce `EstadoTorre` y esta
 * pantalla lo consume. Con dos declaraciones «iguales» —una aquí, otra en el
 * módulo— el compilador no vería un desajuste entre lo que el servidor arma y
 * lo que la interfaz espera. Con una sola, el desajuste es un error de
 * compilación. La fixture se queda con lo suyo: los datos.
 *
 * Para qué sirve todavía esta fixture, ahora que hay datos reales:
 *
 *   1. Es la fuente de las variantes de `EstadoPantalla` (`variantes.ts`), que
 *      son la única forma de ver los seis estados sin esperar a que ocurran en
 *      producción.
 *   2. Es el catálogo de macro-zonas del fallback `sin_zonas` — las cinco
 *      particionan exactamente las 52 comunas de la RM.
 *   3. Es el dataset contra el que se leyeron las capturas del handoff.
 *
 * Disciplina de esta copia: cero invención. Toda cifra, nombre de
 * zona/comuna/conductor y evento es idéntico al original.
 *
 * ⚠️ El dummy es contrato de TIPOS, no de VALORES. Sus umbrales de PM2.5, por
 * ejemplo, no son los reales (los del Plan Operacional GEC 2026 del MMA son
 * Alerta 80 · Preemergencia 110 · Emergencia 170 sobre la media móvil de 24 h).
 * No leer cifras de aquí para tomar decisiones de producto.
 */

import type {
  BloqueTimeline,
  EstadoCapa,
  EstadoTorre,
  EventoCiudad,
  EventoComercial,
  Excepcion,
  FrescuraFuente,
  Interaccion,
  MarcaOperativa,
  MensajeEstado,
  MetricaResumen,
  OlaEntrante,
  PronosticoAire,
  RestriccionVehicular,
  Senal,
  Ventana,
  Zona,
  CeldaClima,
  ConductorEnMapa,
  IncidenteTransito,
} from "@/modules/contexto/contrato-torre";

export type {
  AccionSugerida,
  ArquetipoOla,
  BloqueTimeline,
  CapaMapa,
  CeldaClima,
  ConductorEnMapa,
  Coordenada,
  EstadoCapa,
  EstadoFuente,
  EstadoPantalla,
  EstadoTorre,
  EventoCiudad,
  EventoComercial,
  Excepcion,
  FactorRiesgo,
  FrescuraFuente,
  FuenteSenal,
  HitoPreparacion,
  Horizonte,
  IncidenteTransito,
  Interaccion,
  MarcaOperativa,
  MensajeEstado,
  MetricaResumen,
  NivelAire,
  NivelRiesgo,
  NivelZoom,
  OlaEntrante,
  PronosticoAire,
  PuntoCurva,
  RestriccionVehicular,
  Senal,
  Severidad,
  TorreRespuesta,
  Ventana,
  VentanaCorte,
  Zona,
} from "@/modules/contexto/contrato-torre";

// =============================================================================
// 2. Frescura de fuentes
// =============================================================================

export const FRESCURA_FUENTES: FrescuraFuente[] = [
  {
    id: 'clima',
    nombre: 'Clima',
    estado: 'ok',
    actualizadoEn: '2026-07-25T09:10:00-04:00',
    edadMinutos: 4,
    cadenciaMinutos: 60,
    motivo: null,
  },
  {
    id: 'aire',
    nombre: 'Calidad del aire',
    estado: 'ok',
    actualizadoEn: '2026-07-25T08:53:00-04:00',
    edadMinutos: 21,
    cadenciaMinutos: 60,
    motivo: null,
  },
  {
    id: 'transito',
    nombre: 'Tránsito',
    estado: 'atrasada',
    actualizadoEn: '2026-07-25T08:36:00-04:00',
    edadMinutos: 38,
    cadenciaMinutos: 10,
    motivo: 'El proveedor respondió con error en los últimos 3 intentos.',
  },
  {
    id: 'eventos',
    nombre: 'Eventos de la ciudad',
    estado: 'ok',
    actualizadoEn: '2026-07-25T05:00:00-04:00',
    edadMinutos: 254,
    cadenciaMinutos: 1440,
    motivo: null,
  },
  {
    id: 'senales',
    nombre: 'Señales de prensa',
    estado: 'ok',
    actualizadoEn: '2026-07-25T09:00:00-04:00',
    edadMinutos: 14,
    cadenciaMinutos: 30,
    motivo: null,
  },
];

// =============================================================================
// 3. Zonas y su riesgo
// =============================================================================

export const ZONAS: Zona[] = [
  {
    id: 'zona-oriente',
    nombre: 'Oriente',
    comunas: [
      'Las Condes', 'Vitacura', 'Lo Barnechea', 'Providencia',
      'Ñuñoa', 'La Reina', 'Peñalolén', 'Macul',
    ],
    riesgo: 81,
    nivel: 'critico',
    factores: [
      { id: 'presion_operativa', etiqueta: 'Presión operativa', valor: 72, peso: 0.35, explicacion: '86 pedidos pendientes contra capacidad de 60.' },
      { id: 'clima', etiqueta: 'Clima', valor: 95, peso: 0.20, explicacion: 'Lluvia de 8 mm/h entre 16:00 y 19:00, dentro de la ventana de reparto.' },
      { id: 'aire', etiqueta: 'Aire y restricción', valor: 40, peso: 0.15, explicacion: 'PM2.5 en rango regular. Sin restricción extraordinaria hoy.' },
      { id: 'transito', etiqueta: 'Tránsito', valor: 68, peso: 0.15, explicacion: '4 incidentes activos, 2 de ellos sobre Vespucio Oriente.' },
      { id: 'eventos', etiqueta: 'Eventos', valor: 30, peso: 0.10, explicacion: 'Partido en Ñuñoa a las 20:00, fuera de la ventana de reparto.' },
      { id: 'historico', etiqueta: 'Histórico propio', valor: 88, peso: 0.05, explicacion: 'Tus últimas 4 lluvias en Oriente subieron los fallidos 14 %.' },
    ],
    pedidosPendientes: 86,
    pedidosEntregados: 24,
    capacidadEstimada: 60,
    conductoresAsignados: 2,
    conductoresDisponibles: 2,
    ventanaCorte: { hora: '18:00', minutosRestantes: 526 },
    montoComprometidoClp: 486_200,
    centro: { lat: -33.4089, long: -70.5683 },
  },
  {
    id: 'zona-centro',
    nombre: 'Centro',
    comunas: [
      'Santiago', 'Estación Central', 'Quinta Normal', 'San Miguel',
      'San Joaquín', 'Pedro Aguirre Cerda', 'Cerrillos',
    ],
    riesgo: 54,
    nivel: 'medio',
    factores: [
      { id: 'presion_operativa', etiqueta: 'Presión operativa', valor: 88, peso: 0.35, explicacion: '148 pedidos pendientes contra capacidad de 130.' },
      { id: 'clima', etiqueta: 'Clima', valor: 15, peso: 0.20, explicacion: 'Nublado sin precipitación en la ventana.' },
      { id: 'aire', etiqueta: 'Aire y restricción', valor: 45, peso: 0.15, explicacion: 'PM2.5 regular. Restricción permanente afecta dígitos 6 y 7.' },
      { id: 'transito', etiqueta: 'Tránsito', valor: 60, peso: 0.15, explicacion: 'Congestión habitual de sábado en el eje Alameda.' },
      { id: 'eventos', etiqueta: 'Eventos', valor: 20, peso: 0.10, explicacion: 'Sin eventos masivos en la zona.' },
      { id: 'historico', etiqueta: 'Histórico propio', valor: 34, peso: 0.05, explicacion: 'Fallidos dentro del promedio de los últimos 30 días.' },
    ],
    pedidosPendientes: 148,
    pedidosEntregados: 61,
    capacidadEstimada: 130,
    conductoresAsignados: 6,
    conductoresDisponibles: 6,
    ventanaCorte: { hora: '12:00', minutosRestantes: 166 },
    montoComprometidoClp: 742_800,
    centro: { lat: -33.4489, long: -70.6693 },
  },
  {
    id: 'zona-sur',
    nombre: 'Sur',
    comunas: [
      'Puente Alto', 'La Florida', 'La Granja', 'La Pintana', 'El Bosque',
      'La Cisterna', 'San Ramón', 'Lo Espejo', 'San Bernardo', 'Buin',
      'Paine', 'Calera de Tango', 'Pirque', 'San José de Maipo',
    ],
    riesgo: 31,
    nivel: 'bajo',
    factores: [
      { id: 'presion_operativa', etiqueta: 'Presión operativa', valor: 38, peso: 0.35, explicacion: '62 pedidos pendientes contra capacidad de 100.' },
      { id: 'clima', etiqueta: 'Clima', valor: 12, peso: 0.20, explicacion: 'Sin precipitación pronosticada.' },
      { id: 'aire', etiqueta: 'Aire y restricción', valor: 34, peso: 0.15, explicacion: 'PM2.5 en rango bueno.' },
      { id: 'transito', etiqueta: 'Tránsito', valor: 26, peso: 0.15, explicacion: '1 incidente menor en Vespucio Sur.' },
      { id: 'eventos', etiqueta: 'Eventos', valor: 10, peso: 0.10, explicacion: 'Sin eventos relevantes.' },
      { id: 'historico', etiqueta: 'Histórico propio', valor: 22, peso: 0.05, explicacion: 'Zona con la tasa de fallidos más baja del courier.' },
    ],
    pedidosPendientes: 62,
    pedidosEntregados: 38,
    capacidadEstimada: 100,
    conductoresAsignados: 5,
    conductoresDisponibles: 5,
    ventanaCorte: { hora: '17:00', minutosRestantes: 466 },
    montoComprometidoClp: 298_400,
    centro: { lat: -33.5833, long: -70.6333 },
  },
  {
    id: 'zona-norte',
    nombre: 'Norte',
    comunas: [
      'Conchalí', 'Huechuraba', 'Independencia', 'Quilicura',
      'Recoleta', 'Renca', 'Colina', 'Lampa', 'Tiltil',
    ],
    riesgo: 28,
    nivel: 'bajo',
    factores: [
      { id: 'presion_operativa', etiqueta: 'Presión operativa', valor: 30, peso: 0.35, explicacion: '64 pedidos pendientes contra capacidad de 100.' },
      { id: 'clima', etiqueta: 'Clima', valor: 10, peso: 0.20, explicacion: 'Sin precipitación pronosticada.' },
      { id: 'aire', etiqueta: 'Aire y restricción', valor: 35, peso: 0.15, explicacion: 'PM2.5 en rango regular hacia la tarde.' },
      { id: 'transito', etiqueta: 'Tránsito', valor: 22, peso: 0.15, explicacion: 'Sin incidentes activos.' },
      { id: 'eventos', etiqueta: 'Eventos', valor: 0, peso: 0.10, explicacion: 'Sin eventos relevantes.' },
      { id: 'historico', etiqueta: 'Histórico propio', valor: 28, peso: 0.05, explicacion: 'Fallidos dentro del promedio.' },
    ],
    pedidosPendientes: 64,
    pedidosEntregados: 29,
    capacidadEstimada: 100,
    conductoresAsignados: 5,
    conductoresDisponibles: 5,
    ventanaCorte: { hora: '17:00', minutosRestantes: 466 },
    montoComprometidoClp: 312_600,
    centro: { lat: -33.3667, long: -70.6750 },
  },
  {
    id: 'zona-poniente',
    nombre: 'Poniente',
    comunas: [
      'Maipú', 'Pudahuel', 'Cerro Navia', 'Lo Prado', 'Curacaví',
      'María Pinto', 'Melipilla', 'Alhué', 'San Pedro', 'Talagante',
      'El Monte', 'Isla de Maipo', 'Padre Hurtado', 'Peñaflor',
    ],
    riesgo: 16,
    nivel: 'calmo',
    factores: [
      { id: 'presion_operativa', etiqueta: 'Presión operativa', valor: 18, peso: 0.35, explicacion: '52 pedidos pendientes contra capacidad de 80.' },
      { id: 'clima', etiqueta: 'Clima', valor: 8, peso: 0.20, explicacion: 'Despejado.' },
      { id: 'aire', etiqueta: 'Aire y restricción', valor: 30, peso: 0.15, explicacion: 'PM2.5 en rango bueno.' },
      { id: 'transito', etiqueta: 'Tránsito', valor: 14, peso: 0.15, explicacion: 'Sin incidentes activos.' },
      { id: 'eventos', etiqueta: 'Eventos', valor: 0, peso: 0.10, explicacion: 'Sin eventos relevantes.' },
      { id: 'historico', etiqueta: 'Histórico propio', valor: 18, peso: 0.05, explicacion: 'Fallidos bajo el promedio.' },
    ],
    pedidosPendientes: 52,
    pedidosEntregados: 26,
    capacidadEstimada: 80,
    conductoresAsignados: 4,
    conductoresDisponibles: 4,
    ventanaCorte: { hora: '16:00', minutosRestantes: 406 },
    montoComprometidoClp: 241_100,
    centro: { lat: -33.5100, long: -70.7600 },
  },
];

// =============================================================================
// 4. Métricas de resumen
// =============================================================================

export const METRICAS: MetricaResumen[] = [
  {
    id: 'pedidos-hoy',
    etiqueta: 'Pedidos hoy',
    valor: '412',
    valorCrudo: 412,
    variacionPorcentual: 6.2,
    detalle: '178 entregados · 234 pendientes',
  },
  {
    id: 'monto-comprometido',
    etiqueta: 'Comprometido',
    valor: '$2.081.100',
    valorCrudo: 2_081_100,
    variacionPorcentual: 4.8,
    detalle: 'Cobro asociado a los pedidos aún no entregados',
  },
  {
    id: 'sla-en-riesgo',
    etiqueta: 'SLA en riesgo',
    valor: '38',
    valorCrudo: 38,
    variacionPorcentual: 21.0,
    detalle: 'Pedidos cuyo compromiso vence antes del cierre de la zona',
  },
  {
    id: 'sin-geocodificar',
    etiqueta: 'Sin ubicar',
    valor: '7',
    valorCrudo: 7,
    variacionPorcentual: null,
    detalle: 'No aparecen en el mapa. Requieren revisión de dirección',
  },
];

// =============================================================================
// 5. Excepciones (el riel de alertas)
// =============================================================================

export const EXCEPCIONES: Excepcion[] = [
  {
    id: 'exc-001',
    severidad: 'critica',
    titulo: 'Lluvia 16–19 h sobre Oriente',
    cuerpo:
      '86 pedidos con corte a las 18:00 y solo 2 conductores en zona. Tus últimas 4 lluvias en Oriente subieron los fallidos 14 %.',
    zonaId: 'zona-oriente',
    ventana: { inicio: '2026-07-25T16:00:00-04:00', fin: '2026-07-25T19:00:00-04:00' },
    pedidosAfectados: 86,
    montoAfectadoClp: 486_200,
    acciones: [
      {
        id: 'adelantar-corte-oriente',
        etiqueta: 'Adelantar corte de Oriente',
        descripcion: 'Mueve la ventana de corte de 18:00 a 15:30 solo para hoy.',
        requiereConfirmacion: true,
      },
      {
        id: 'ver-pedidos-oriente',
        etiqueta: 'Ver los 86 pedidos',
        descripcion: 'Abre la lista filtrada por zona y ventana.',
        requiereConfirmacion: false,
      },
    ],
    origen: 'motor',
    confianza: null,
    detectadaEn: '2026-07-25T09:10:00-04:00',
    descartable: true,
  },
  {
    id: 'exc-002',
    severidad: 'alta',
    titulo: 'Preemergencia probable el lunes',
    cuerpo:
      'El PM2.5 proyectado supera el umbral a 48 horas. Una restricción extraordinaria dejaría fuera del anillo Vespucio a los vehículos sin sello verde.',
    zonaId: null,
    ventana: { inicio: '2026-07-27T00:00:00-04:00', fin: '2026-07-27T23:59:00-04:00' },
    pedidosAfectados: 0,
    montoAfectadoClp: 0,
    acciones: [
      {
        id: 'ver-flota-expuesta',
        etiqueta: 'Ver flota expuesta',
        descripcion: 'Lista de conductores cuyo vehículo quedaría restringido.',
        requiereConfirmacion: false,
      },
    ],
    origen: 'motor',
    confianza: null,
    detectadaEn: '2026-07-25T08:53:00-04:00',
    descartable: true,
  },
  {
    id: 'exc-003',
    severidad: 'alta',
    titulo: 'Centro sin holgura',
    cuerpo:
      '148 pedidos pendientes contra una capacidad de 130. La ventana de corte vence en 2 h 46 min.',
    zonaId: 'zona-centro',
    ventana: { inicio: '2026-07-25T09:14:00-04:00', fin: '2026-07-25T12:00:00-04:00' },
    pedidosAfectados: 18,
    montoAfectadoClp: 90_400,
    acciones: [
      {
        id: 'reasignar-desde-poniente',
        etiqueta: 'Reasignar 2 conductores desde Poniente',
        descripcion: 'Poniente queda con 2 conductores y capacidad de 40.',
        requiereConfirmacion: true,
      },
    ],
    origen: 'motor',
    confianza: null,
    detectadaEn: '2026-07-25T09:12:00-04:00',
    descartable: true,
  },
  {
    id: 'exc-004',
    severidad: 'media',
    titulo: 'Corte de tránsito en Providencia por evento deportivo',
    cuerpo:
      'Tres medios reportan cierre perimetral en el eje Nueva Providencia desde las 18:00. Caen 24 pedidos tuyos dentro del perímetro.',
    zonaId: 'zona-oriente',
    ventana: { inicio: '2026-07-25T18:00:00-04:00', fin: '2026-07-25T23:30:00-04:00' },
    pedidosAfectados: 24,
    montoAfectadoClp: 118_800,
    acciones: [
      {
        id: 'ver-pedidos-perimetro',
        etiqueta: 'Ver los 24 pedidos',
        descripcion: 'Abre la lista filtrada por el perímetro del evento.',
        requiereConfirmacion: false,
      },
    ],
    origen: 'senal',
    confianza: 0.86,
    detectadaEn: '2026-07-25T09:00:00-04:00',
    descartable: true,
  },
];

// =============================================================================
// 6. Ola entrante (calendario comercial)
// =============================================================================

export const OLA_ENTRANTE: OlaEntrante = {
  id: 'ola-dia-del-nino-2026',
  nombre: 'Día del Niño',
  arquetipo: 'regalo',
  organizador: null,
  fechaEvento: { inicio: '2026-08-09T00:00:00-04:00', fin: '2026-08-09T23:59:00-04:00' },
  diasParaEvento: 15,
  ventanaEntregas: { inicio: '2026-08-03T00:00:00-04:00', fin: '2026-08-08T23:59:00-04:00' },
  variacionEsperadaPct: 38,
  curva: [
    { fecha: '2026-08-03', etiquetaDia: 'lun 3', offsetDias: -6, pedidosProyectados: 402, pedidosBase: 390, capacidadEstimada: 470, esPeak: false },
    { fecha: '2026-08-04', etiquetaDia: 'mar 4', offsetDias: -5, pedidosProyectados: 448, pedidosBase: 395, capacidadEstimada: 470, esPeak: false },
    { fecha: '2026-08-05', etiquetaDia: 'mié 5', offsetDias: -4, pedidosProyectados: 512, pedidosBase: 398, capacidadEstimada: 470, esPeak: false },
    { fecha: '2026-08-06', etiquetaDia: 'jue 6', offsetDias: -3, pedidosProyectados: 604, pedidosBase: 402, capacidadEstimada: 470, esPeak: true },
    { fecha: '2026-08-07', etiquetaDia: 'vie 7', offsetDias: -2, pedidosProyectados: 571, pedidosBase: 410, capacidadEstimada: 470, esPeak: true },
    { fecha: '2026-08-08', etiquetaDia: 'sáb 8', offsetDias: -1, pedidosProyectados: 318, pedidosBase: 280, capacidadEstimada: 380, esPeak: false },
    { fecha: '2026-08-09', etiquetaDia: 'dom 9', offsetDias: 0, pedidosProyectados: 96, pedidosBase: 90, capacidadEstimada: 190, esPeak: false },
  ],
  diaCritico: '2026-08-06',
  brechaConductores: -2,
  fechaLimiteCompraPorZona: [
    { zonaId: 'zona-centro', fecha: '2026-08-07' },
    { zonaId: 'zona-oriente', fecha: '2026-08-07' },
    { zonaId: 'zona-norte', fecha: '2026-08-06' },
    { zonaId: 'zona-sur', fecha: '2026-08-06' },
    { zonaId: 'zona-poniente', fecha: '2026-08-05' },
  ],
  hitos: [
    { id: 'h-21', tMenosDias: 21, fechaLimite: '2026-07-19', titulo: 'Confirmar sellers participantes', estado: 'vencido' },
    { id: 'h-14', tMenosDias: 14, fechaLimite: '2026-07-26', titulo: 'Reforzar flota para el peak', estado: 'pendiente' },
    { id: 'h-7', tMenosDias: 7, fechaLimite: '2026-08-02', titulo: 'Validar tarifas y ventanas de corte', estado: 'pendiente' },
    { id: 'h-3', tMenosDias: 3, fechaLimite: '2026-08-06', titulo: 'Congelar cambios de configuración', estado: 'pendiente' },
  ],
  fuenteProyeccion: 'catalogo',
};

/** Calendario comercial chileno 2026. Fechas verificadas al 2026-07-25. */
export const CALENDARIO_COMERCIAL_2026: EventoComercial[] = [
  { id: 'cyberday-2026', nombre: 'CyberDay', arquetipo: 'venta', organizador: 'Cámara de Comercio de Santiago', inicio: '2026-06-01', fin: '2026-06-03', multiplicadorBase: 2.4, curvaRezago: { '1': 0.20, '2': 0.30, '3': 0.25, '4': 0.15, '5': 0.10 } },
  { id: 'cybermonday-2026', nombre: 'CyberMonday', arquetipo: 'venta', organizador: 'Cámara de Comercio de Santiago', inicio: '2026-10-05', fin: '2026-10-07', multiplicadorBase: 2.2, curvaRezago: { '1': 0.20, '2': 0.30, '3': 0.25, '4': 0.15, '5': 0.10 } },
  { id: 'black-friday-2026', nombre: 'Black Friday', arquetipo: 'venta', organizador: 'Wide Latam', inicio: '2026-11-27', fin: '2026-11-30', multiplicadorBase: 2.0, curvaRezago: { '1': 0.22, '2': 0.28, '3': 0.24, '4': 0.16, '5': 0.10 } },
  { id: 'fecha-doble-08-08', nombre: 'Fecha doble 8.8 (Mercado Libre)', arquetipo: 'venta', organizador: 'Mercado Libre', inicio: '2026-08-08', fin: '2026-08-08', multiplicadorBase: 1.3, curvaRezago: { '1': 0.40, '2': 0.35, '3': 0.25 } },
  { id: 'dia-del-nino-2026', nombre: 'Día del Niño', arquetipo: 'regalo', organizador: null, inicio: '2026-08-09', fin: '2026-08-09', multiplicadorBase: 1.38, curvaRezago: { '-6': 0.05, '-5': 0.12, '-4': 0.20, '-3': 0.30, '-2': 0.25, '-1': 0.08 } },
  { id: 'fiestas-patrias-2026', nombre: 'Fiestas Patrias', arquetipo: 'regalo', organizador: null, inicio: '2026-09-18', fin: '2026-09-19', multiplicadorBase: 1.6, curvaRezago: { '-6': 0.08, '-5': 0.14, '-4': 0.20, '-3': 0.26, '-2': 0.22, '-1': 0.10 } },
  { id: 'halloween-2026', nombre: 'Halloween', arquetipo: 'regalo', organizador: null, inicio: '2026-10-31', fin: '2026-10-31', multiplicadorBase: 1.2, curvaRezago: { '-5': 0.10, '-4': 0.18, '-3': 0.28, '-2': 0.28, '-1': 0.16 } },
  { id: 'navidad-2026', nombre: 'Navidad', arquetipo: 'regalo', organizador: null, inicio: '2026-12-25', fin: '2026-12-25', multiplicadorBase: 2.6, curvaRezago: { '-10': 0.06, '-8': 0.10, '-6': 0.16, '-4': 0.22, '-3': 0.24, '-2': 0.16, '-1': 0.06 } },
];

// =============================================================================
// 7. Línea de tiempo del día
// =============================================================================

export const TIMELINE_HOY: BloqueTimeline[] = [
  { id: 'tl-01', tipo: 'ventana_reparto', etiqueta: 'Ventana de reparto', inicio: '2026-07-25T08:30:00-04:00', fin: '2026-07-25T18:00:00-04:00', zonaId: null, carril: 0 },
  { id: 'tl-02', tipo: 'corte_en_riesgo', etiqueta: 'Corte de Centro', inicio: '2026-07-25T12:00:00-04:00', fin: '2026-07-25T12:00:00-04:00', zonaId: 'zona-centro', carril: 1 },
  { id: 'tl-03', tipo: 'clima', etiqueta: 'Lluvia sobre Oriente', inicio: '2026-07-25T16:00:00-04:00', fin: '2026-07-25T19:00:00-04:00', zonaId: 'zona-oriente', carril: 1 },
  { id: 'tl-04', tipo: 'corte_en_riesgo', etiqueta: 'Corte de Oriente en riesgo', inicio: '2026-07-25T18:00:00-04:00', fin: '2026-07-25T18:00:00-04:00', zonaId: 'zona-oriente', carril: 2 },
  { id: 'tl-05', tipo: 'evento', etiqueta: 'Partido en Ñuñoa', inicio: '2026-07-25T18:00:00-04:00', fin: '2026-07-25T23:30:00-04:00', zonaId: 'zona-oriente', carril: 2 },
];

/** Marcador de "ahora". Se mueve solo; no salta. */
export const AHORA = '2026-07-25T09:14:00-04:00';

/** Extremos de la franja temporal visible. */
export const RANGO_TIMELINE: Ventana = {
  inicio: '2026-07-25T08:00:00-04:00',
  fin: '2026-07-25T21:00:00-04:00',
};

// =============================================================================
// 8. Capas del mapa
// =============================================================================

export const CAPAS: EstadoCapa[] = [
  { id: 'riesgo', etiqueta: 'Riesgo', activa: true, disponible: true, motivoNoDisponible: null },
  { id: 'clima', etiqueta: 'Lluvia', activa: true, disponible: true, motivoNoDisponible: null },
  { id: 'aire', etiqueta: 'Aire', activa: false, disponible: true, motivoNoDisponible: null },
  { id: 'transito', etiqueta: 'Tránsito', activa: false, disponible: false, motivoNoDisponible: 'Datos con 38 minutos de atraso.' },
  { id: 'eventos', etiqueta: 'Eventos', activa: false, disponible: true, motivoNoDisponible: null },
  { id: 'conductores', etiqueta: 'Conductores', activa: false, disponible: true, motivoNoDisponible: null },
  { id: 'pedidos', etiqueta: 'Pedidos', activa: false, disponible: true, motivoNoDisponible: null },
  { id: 'comunas', etiqueta: 'Comunas', activa: false, disponible: true, motivoNoDisponible: null },
];

/** Regla de producto: no más de 2 capas encendidas a la vez. */
export const MAX_CAPAS_ACTIVAS = 2;

// =============================================================================
// 9. Entidades geográficas del mapa
// =============================================================================

export const CONDUCTORES: ConductorEnMapa[] = [
  { id: 'cond-01', nombre: 'Marcelo Ortiz', zonaId: 'zona-centro', posicion: { lat: -33.4372, long: -70.6506 }, ultimoPing: '2026-07-25T09:12:00-04:00', minutosSinPing: 2, paradasTotales: 28, paradasCompletadas: 11, estado: 'en_ruta' },
  { id: 'cond-02', nombre: 'Javiera Muñoz', zonaId: 'zona-oriente', posicion: { lat: -33.4152, long: -70.5891 }, ultimoPing: '2026-07-25T09:13:00-04:00', minutosSinPing: 1, paradasTotales: 32, paradasCompletadas: 9, estado: 'en_ruta' },
  { id: 'cond-03', nombre: 'Rodrigo Salas', zonaId: 'zona-oriente', posicion: { lat: -33.4501, long: -70.5502 }, ultimoPing: '2026-07-25T08:47:00-04:00', minutosSinPing: 27, paradasTotales: 30, paradasCompletadas: 7, estado: 'sin_senal' },
  { id: 'cond-04', nombre: 'Camila Vergara', zonaId: 'zona-sur', posicion: { lat: -33.5622, long: -70.6011 }, ultimoPing: '2026-07-25T09:11:00-04:00', minutosSinPing: 3, paradasTotales: 24, paradasCompletadas: 15, estado: 'en_ruta' },
  { id: 'cond-05', nombre: 'Ignacio Fuentes', zonaId: 'zona-poniente', posicion: { lat: -33.5089, long: -70.7702 }, ultimoPing: '2026-07-25T09:09:00-04:00', minutosSinPing: 5, paradasTotales: 22, paradasCompletadas: 14, estado: 'detenido' },
  { id: 'cond-06', nombre: 'Pilar Reyes', zonaId: 'zona-norte', posicion: { lat: -33.3712, long: -70.6789 }, ultimoPing: '2026-07-25T09:13:00-04:00', minutosSinPing: 1, paradasTotales: 26, paradasCompletadas: 12, estado: 'en_ruta' },
];

export const EVENTOS_CIUDAD: EventoCiudad[] = [
  {
    id: 'ev-001',
    nombre: 'Universidad de Chile vs. Colo Colo',
    tipo: 'deportivo',
    recinto: 'Estadio Nacional',
    comuna: 'Ñuñoa',
    posicion: { lat: -33.4645, long: -70.6103 },
    radioMetros: 1800,
    ventana: { inicio: '2026-07-25T18:00:00-04:00', fin: '2026-07-25T23:30:00-04:00' },
    asistenciaEstimada: 45000,
    fuente: 'Calendario de Primera División',
  },
];

export const CELDAS_CLIMA: CeldaClima[] = [
  {
    id: 'clima-001',
    tipo: 'lluvia',
    centro: { lat: -33.4200, long: -70.5450 },
    radioMetros: 7500,
    intensidadMmHora: 8,
    ventana: { inicio: '2026-07-25T16:00:00-04:00', fin: '2026-07-25T19:00:00-04:00' },
    zonasAfectadas: ['zona-oriente'],
  },
];

export const INCIDENTES_TRANSITO: IncidenteTransito[] = [
  { id: 'tr-001', tipo: 'accidente', descripcion: 'Colisión con dos pistas bloqueadas', via: 'Américo Vespucio Oriente', posicion: { lat: -33.4198, long: -70.5701 }, magnitud: 3, desde: '2026-07-25T08:41:00-04:00', hasta: null, zonaId: 'zona-oriente' },
  { id: 'tr-002', tipo: 'congestion', descripcion: 'Tránsito lento por volumen', via: 'Costanera Norte poniente', posicion: { lat: -33.4102, long: -70.6011 }, magnitud: 2, desde: '2026-07-25T08:20:00-04:00', hasta: null, zonaId: 'zona-oriente' },
  { id: 'tr-003', tipo: 'obra', descripcion: 'Faena con desvío señalizado', via: 'Vespucio Sur', posicion: { lat: -33.5301, long: -70.6202 }, magnitud: 1, desde: '2026-07-24T07:00:00-04:00', hasta: '2026-07-30T18:00:00-04:00', zonaId: 'zona-sur' },
];

export const MARCAS_OPERATIVAS: MarcaOperativa[] = [
  {
    id: 'marca-001',
    nota: 'Corte de calle en Independencia por feria. Confirmado por Marcelo.',
    posicion: { lat: -33.4152, long: -70.6634 },
    radioMetros: 600,
    ventana: { inicio: '2026-07-25T07:00:00-04:00', fin: '2026-07-25T15:00:00-04:00' },
    autor: 'Paula Herrera',
    creadaEn: '2026-07-25T07:22:00-04:00',
  },
];

// =============================================================================
// 10. Calidad del aire y restricción vehicular
// =============================================================================

export const PRONOSTICO_AIRE: PronosticoAire[] = [
  { fecha: '2026-07-25', pm25Maximo: 48, nivel: 'regular', esProyeccion: false },
  { fecha: '2026-07-26', pm25Maximo: 71, nivel: 'alerta', esProyeccion: true },
  { fecha: '2026-07-27', pm25Maximo: 96, nivel: 'preemergencia', esProyeccion: true },
];

export const RESTRICCIONES: RestriccionVehicular[] = [
  { fecha: '2026-07-25', tipo: 'permanente', digitos: [6, 7], alcance: 'Provincia de Santiago, San Bernardo y Puente Alto', vehiculosAfectados: null },
  { fecha: '2026-07-27', tipo: 'preemergencia', digitos: [2, 3, 4, 5], alcance: 'Sin sello verde, dentro del anillo Américo Vespucio', vehiculosAfectados: null },
];

// =============================================================================
// 11. Señales de prensa
// =============================================================================

export const SENALES: Senal[] = [
  {
    id: 'sen-001',
    titulo: 'Cierre perimetral en Ñuñoa por partido en el Estadio Nacional',
    resumen:
      'Carabineros informa desvíos en el eje Grecia y cierre del perímetro del estadio desde las 18:00 hasta el término del encuentro.',
    tipo: 'corte_transito',
    comunas: ['Ñuñoa', 'Providencia'],
    ejesViales: ['Avenida Grecia', 'Nueva Providencia'],
    ventana: { inicio: '2026-07-25T18:00:00-04:00', fin: '2026-07-25T23:30:00-04:00' },
    severidad: 'media',
    confianza: 0.86,
    afectaOperacion: true,
    pedidosEnRango: 24,
    zonasAfectadas: ['zona-oriente'],
    fuentes: [
      { medio: 'Transporte Informa RM', titular: 'Desvíos de tránsito por encuentro en Estadio Nacional', url: 'https://www.transporteinforma.cl/', publicadoEn: '2026-07-25T08:40:00-04:00' },
      { medio: 'La Tercera', titular: 'Carabineros anuncia cortes en Ñuñoa por el clásico', url: 'https://www.latercera.com/', publicadoEn: '2026-07-25T08:12:00-04:00' },
      { medio: 'Canal 13', titular: 'Los desvíos que regirán este sábado en Ñuñoa', url: 'https://www.13.cl/', publicadoEn: '2026-07-25T07:55:00-04:00' },
    ],
    marcaHumana: null,
  },
  {
    id: 'sen-002',
    titulo: 'Falla en Línea 1 del Metro con servicio parcial',
    resumen:
      'Metro reporta servicio interrumpido entre Los Héroes y Universidad Católica. Se habilitaron buses de apoyo.',
    tipo: 'transporte',
    comunas: ['Santiago', 'Providencia'],
    ejesViales: ['Alameda'],
    ventana: { inicio: '2026-07-25T08:05:00-04:00', fin: null },
    severidad: 'informativa',
    confianza: 0.72,
    afectaOperacion: false,
    pedidosEnRango: 0,
    zonasAfectadas: [],
    fuentes: [
      { medio: 'Emol', titular: 'Metro informa servicio parcial en Línea 1', url: 'https://www.emol.com/', publicadoEn: '2026-07-25T08:20:00-04:00' },
    ],
    marcaHumana: null,
  },
];

// =============================================================================
// 12. Estados de la pantalla
// =============================================================================

export const MENSAJES_ESTADO: MensajeEstado[] = [
  {
    estado: 'tranquilo',
    titulo: 'Todo tranquilo',
    cuerpo: 'Ninguna zona supera el umbral de riesgo y no hay eventos relevantes en las próximas 24 horas.',
    accion: { etiqueta: 'Ver el detalle igual', destino: '#detalle' },
  },
  {
    estado: 'degradado',
    titulo: 'Faltan datos de tránsito',
    cuerpo: 'La capa de tránsito muestra información de hace 38 minutos. El resto del tablero está al día.',
    accion: null,
  },
  {
    estado: 'sin_zonas',
    titulo: 'Todavía no defines tus zonas',
    cuerpo: 'Estás viendo las cinco macro-zonas de la Región Metropolitana. Agrupa tus comunas para que el tablero refleje cómo operas.',
    accion: { etiqueta: 'Configurar zonas', destino: '/configuracion/zonas' },
  },
  {
    estado: 'sin_pedidos',
    titulo: 'Sin pedidos para hoy',
    cuerpo: 'No hay pedidos asignados. La próxima ola comercial es el Día del Niño, en 15 días.',
    accion: { etiqueta: 'Ver la ola entrante', destino: '#olas' },
  },
];

// =============================================================================
// 13. Interacciones
// =============================================================================

export const INTERACCIONES: Interaccion[] = [
  { id: 'hover-zona', gesto: 'Puntero sobre una zona', resultado: 'La zona se destaca y aparece su nombre y puntaje.', presupuestoMs: 100, atajoTeclado: null },
  { id: 'seleccionar-zona', gesto: 'Clic en una zona', resultado: 'Las demás zonas se atenúan y el riel muestra el desglose de factores.', presupuestoMs: 180, atajoTeclado: null },
  { id: 'abrir-factor', gesto: 'Clic en un factor del desglose', resultado: 'Se abre la lista de pedidos afectados por ese factor.', presupuestoMs: 200, atajoTeclado: null },
  { id: 'drill-comuna', gesto: 'Doble clic o zoom sobre una zona', resultado: 'El mapa baja al nivel de comunas y muestra sus nombres.', presupuestoMs: 260, atajoTeclado: null },
  { id: 'cambiar-horizonte', gesto: 'Seleccionar Hoy / Mañana / 72 h / Olas', resultado: 'Todo el tablero cambia de horizonte. Los datos vienen precalculados.', presupuestoMs: 300, atajoTeclado: '1 2 3 4' },
  { id: 'toggle-capa', gesto: 'Encender o apagar una capa', resultado: 'La capa aparece o desaparece. Al llegar a dos activas, el resto se bloquea.', presupuestoMs: 120, atajoTeclado: null },
  { id: 'paleta-comandos', gesto: 'Abrir la paleta de comandos', resultado: 'Saltar a una zona, cambiar horizonte, encender capa o buscar un pedido.', presupuestoMs: 120, atajoTeclado: 'Cmd+K' },
  { id: 'marcar-evento', gesto: 'Marcar un punto en el mapa', resultado: 'Crea una marca operativa visible para todo el equipo.', presupuestoMs: 200, atajoTeclado: 'M' },
  { id: 'descartar-excepcion', gesto: 'Descartar una excepción', resultado: 'La saca del riel y calibra el umbral que la generó.', presupuestoMs: 120, atajoTeclado: null },
  { id: 'lista-sin-mapa', gesto: 'Cambiar a vista de lista', resultado: 'Zonas ordenadas por riesgo, navegable con teclado. Mismos datos.', presupuestoMs: 120, atajoTeclado: null },
];

// =============================================================================
// 14. Raíz — todo el estado de la pantalla en un objeto
// =============================================================================

export const ESTADO_TORRE: EstadoTorre = {
  courier: { id: 'courier-demo', nombre: 'Andes Última Milla' },
  ahora: AHORA,
  horizonte: 'hoy',
  estado: 'con_excepciones',
  zoom: 'zonas',
  zonaSeleccionada: null,
  metricas: METRICAS,
  zonas: ZONAS,
  excepciones: EXCEPCIONES,
  senales: SENALES,
  olaEntrante: OLA_ENTRANTE,
  timeline: TIMELINE_HOY,
  rangoTimeline: RANGO_TIMELINE,
  capas: CAPAS,
  frescura: FRESCURA_FUENTES,
  conductores: CONDUCTORES,
  eventosCiudad: EVENTOS_CIUDAD,
  celdasClima: CELDAS_CLIMA,
  incidentesTransito: INCIDENTES_TRANSITO,
  marcasOperativas: MARCAS_OPERATIVAS,
  pronosticoAire: PRONOSTICO_AIRE,
  restricciones: RESTRICCIONES,
  pedidosSinGeocodificar: 7,
};
