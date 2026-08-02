/**
 * Armado de las capas del mapa, la frescura y la línea de tiempo.
 * =====================================================================
 *
 * Puro. Todo lo que necesita del mundo —incluido «ahora»— llega por parámetro.
 *
 * Las tres decisiones que hay que entender antes de tocar este archivo:
 *
 * 1. **Lo que no existe se declara, no se finge.** Tránsito (F2) no tiene dato
 *    todavía, y la flota en vivo solo lo tiene cuando alguien está reportando
 *    posición: sus capas salen `disponible: false` CON MOTIVO, no vacías y
 *    encendibles. Una capa que se puede prender y no dibuja nada es peor que una
 *    capa bloqueada que explica por qué.
 *
 * 2. **Las celdas de lluvia se derivan de la comuna, con un radio que sale de
 *    la geografía y no de un número bonito.** El contrato ya declara la celda
 *    como «geometría simplificada como círculo»; lo que este módulo no hace es
 *    inventar el tamaño: el radio es la mitad de la distancia al centroide de la
 *    comuna vecina más cercana, que es el disco que le corresponde sin pisar al
 *    vecino. Comunas grandes y aisladas dan círculos grandes porque LO SON.
 *
 * 3. **El pronóstico de aire se deriva agregando `aire_horario` por fecha de
 *    Santiago** — la propia migración dice que `PronosticoAire` no se almacena.
 *    El nivel del día es el PEOR de sus horas, no el promedio: un episodio se
 *    decreta, no se promedia.
 */

import { combinarFechaHoraSantiago, fechaLocalEnSantiago } from '@/lib/fecha-santiago';
import { distanciaEnMetros } from '@/lib/geo/distancia';
import { CENTROIDES_RM } from '@/lib/geo/centroides-rm';
import { COMUNAS_RM, type ComunaRM } from '@/lib/ui/comunas-rm';
import { normalizarComuna, resolverComunaCanonica } from '@/modules/integraciones/geocoding/normalizacion';
import type {
  BloqueTimeline,
  CeldaClima,
  ConductorEnMapa,
  EstadoCapa,
  EventoCiudad,
  FrescuraFuente,
  MarcaOperativa,
  NivelAire,
  PronosticoAire,
  RestriccionVehicular,
  Ventana,
  Zona,
} from '../contrato-torre';
import type {
  FilaAireHorario,
  FilaClimaHorario,
  FilaEventoCiudad,
  FilaFuenteEstado,
  FilaMarcaOperativa,
  FilaRestriccion,
} from './consultas';

// =============================================================================
// Ventana de la jornada
// =============================================================================

/** Extremos de la línea de tiempo. Espeja `contexto.franja`: 08–21 local. */
export const INICIO_JORNADA = '08:00';
export const FIN_JORNADA = '21:00';

/** Instante ISO de una hora local de Santiago en una fecha civil. */
export function instanteSantiago(fecha: string, horaLocal: string): string {
  return combinarFechaHoraSantiago(fecha, horaLocal).toISOString();
}

// =============================================================================
// Frescura de fuentes
// =============================================================================

/**
 * `FrescuraFuente[]` a partir de `contexto.fuentes_estado`.
 *
 * `edadMinutos` se DERIVA aquí (la columna no existe: guardarla obligaría a
 * reescribir cinco filas cada minuto para que no mintiera).
 *
 * DESAJUSTE CONOCIDO con el contrato, resuelto explícitamente: el contrato
 * declara `actualizadoEn` no-nulo, pero una fuente que nunca corrió con éxito no
 * tiene última actualización. Va como cadena vacía, y la barra superior la lee
 * como «—» en vez de imprimir una edad de cero que se leería como dato fresco.
 */
export function armarFrescura(
  filas: readonly FilaFuenteEstado[],
  ahora: Date,
): FrescuraFuente[] {
  return filas.map((fila) => {
    const instante = fila.actualizado_en ? new Date(fila.actualizado_en) : null;
    const valido = instante !== null && !Number.isNaN(instante.getTime());
    return {
      id: fila.id,
      nombre: fila.nombre,
      estado: fila.estado,
      actualizadoEn: valido ? instante.toISOString() : '',
      edadMinutos: valido ? Math.max(0, Math.round((ahora.getTime() - instante.getTime()) / 60_000)) : 0,
      cadenciaMinutos: fila.cadencia_minutos,
      motivo: fila.motivo,
    };
  });
}

// =============================================================================
// Capas
// =============================================================================

/**
 * Motivo de la capa de flota cuando NO hay ni una posición.
 *
 * Ya no dice «el bloque de tiempo real no está construido» —lo está— sino lo que
 * de verdad pasa: nadie ha reportado ubicación. La app del conductor solo la
 * envía con un manifiesto en ruta, así que fuera de horario esto es lo normal.
 */
export const MOTIVO_CONDUCTORES =
  'Ningún conductor está reportando ubicación ahora mismo.';

/** Copy de respaldo cuando una fuente está caída y no dejó su propio motivo. */
const MOTIVO_FUENTE_GENERICO = 'La fuente no está respondiendo. La capa vuelve cuando se recupere.';

interface EntradaCapas {
  frescura: readonly FrescuraFuente[];
  /** false cuando no hay ni una celda de lluvia que dibujar en el horizonte. */
  hayClima: boolean;
  hayEventos: boolean;
  /** false cuando ningún conductor está reportando posición. */
  hayConductores: boolean;
}

/**
 * Las ocho capas con su disponibilidad resuelta.
 *
 * Una fuente `caida` bloquea su capa; una `atrasada` NO la bloquea —el dato
 * viejo sigue siendo dato, y la barra superior ya muestra su edad—, salvo que el
 * propio motivo diga otra cosa. La capa `pedidos` sale disponible desde aquí: es
 * R3 quien la bloquea, porque su motivo depende del proveedor de geocoding que
 * corra en el entorno, no del dataset.
 */
export function armarCapas(entrada: EntradaCapas): EstadoCapa[] {
  const porId = new Map(entrada.frescura.map((f) => [f.id, f]));

  function desdeFuente(
    id: 'clima' | 'aire' | 'transito' | 'eventos',
    hayDato: boolean,
    sinDato: string,
  ): { disponible: boolean; motivo: string | null } {
    const fuente = porId.get(id);
    if (fuente && fuente.estado === 'caida') {
      return { disponible: false, motivo: fuente.motivo ?? MOTIVO_FUENTE_GENERICO };
    }
    if (!hayDato) return { disponible: false, motivo: sinDato };
    return { disponible: true, motivo: null };
  }

  const clima = desdeFuente('clima', entrada.hayClima, 'Sin precipitación pronosticada en este horizonte.');
  const aire = desdeFuente('aire', true, '');
  const transito = desdeFuente('transito', false, 'La capa de tránsito se habilita en una entrega posterior.');
  const eventos = desdeFuente('eventos', entrada.hayEventos, 'Sin eventos de ciudad en este horizonte.');

  return [
    { id: 'riesgo', etiqueta: 'Riesgo', activa: true, disponible: true, motivoNoDisponible: null },
    { id: 'clima', etiqueta: 'Lluvia', activa: clima.disponible, disponible: clima.disponible, motivoNoDisponible: clima.motivo },
    { id: 'aire', etiqueta: 'Aire', activa: false, disponible: aire.disponible, motivoNoDisponible: aire.motivo },
    { id: 'transito', etiqueta: 'Tránsito', activa: false, disponible: transito.disponible, motivoNoDisponible: transito.motivo },
    { id: 'eventos', etiqueta: 'Eventos', activa: false, disponible: eventos.disponible, motivoNoDisponible: eventos.motivo },
    {
      id: 'conductores',
      etiqueta: 'Conductores',
      activa: false,
      disponible: entrada.hayConductores,
      motivoNoDisponible: entrada.hayConductores ? null : MOTIVO_CONDUCTORES,
    },
    { id: 'pedidos', etiqueta: 'Pedidos', activa: false, disponible: true, motivoNoDisponible: null },
    { id: 'comunas', etiqueta: 'Comunas', activa: false, disponible: true, motivoNoDisponible: null },
  ];
}

// =============================================================================
// Celdas de lluvia
// =============================================================================

/** Precipitación mínima para dibujar una celda, en mm/h. Bajo esto es garúa. */
export const UMBRAL_LLUVIA_MM_HORA = 0.2;

/** Radio mínimo y máximo de una celda, en metros. Acotan el disco de Voronoi. */
const RADIO_MINIMO_M = 2_500;
const RADIO_MAXIMO_M = 15_000;

const radiosPorComuna = new Map<string, number>();

/**
 * Radio del disco que le corresponde a una comuna: la mitad de la distancia al
 * centroide de la comuna más cercana.
 *
 * No es un número elegido a ojo. Es la aproximación de Voronoi más simple que
 * existe: dos comunas vecinas se reparten el espacio entre sus centros, así que
 * el disco de cada una llega hasta la mitad. Da círculos grandes en Melipilla y
 * chicos en Independencia, que es exactamente lo que pasa en el terreno.
 */
export function radioDeComuna(comuna: string): number {
  const canonica = resolverComunaCanonica(comuna);
  if (!canonica) return RADIO_MINIMO_M;

  const cacheado = radiosPorComuna.get(canonica);
  if (cacheado !== undefined) return cacheado;

  const centro = CENTROIDES_RM[canonica as ComunaRM];
  let minima = Number.POSITIVE_INFINITY;
  for (const otra of COMUNAS_RM) {
    if (otra === canonica) continue;
    const distancia = distanciaEnMetros(centro, CENTROIDES_RM[otra]);
    if (distancia < minima) minima = distancia;
  }

  const radio = Number.isFinite(minima)
    ? Math.min(RADIO_MAXIMO_M, Math.max(RADIO_MINIMO_M, Math.round(minima / 2)))
    : RADIO_MINIMO_M;
  radiosPorComuna.set(canonica, radio);
  return radio;
}

/**
 * Celdas de lluvia de una fecha, una por comuna con precipitación en la jornada.
 *
 * La ventana de cada celda va de la primera a la última hora con lluvia (+1 h,
 * porque el pronóstico es horario y una fila de las 16:00 cubre hasta las
 * 17:00). La intensidad es el MÁXIMO, no el promedio: la zona no se moja en
 * promedio.
 */
export function armarCeldasClima(
  filas: readonly FilaClimaHorario[],
  comunaAZona: ReadonlyMap<string, string>,
  fecha: string,
): CeldaClima[] {
  interface Acumulado {
    comuna: string;
    horas: number[];
    intensidad: number;
  }
  const porComuna = new Map<string, Acumulado>();

  for (const fila of filas) {
    const precipitacion = fila.precipitacion_mm;
    if (precipitacion === null || precipitacion < UMBRAL_LLUVIA_MM_HORA) continue;

    const instante = new Date(fila.hora);
    if (Number.isNaN(instante.getTime())) continue;
    if (fechaLocalEnSantiago(instante) !== fecha) continue;

    const clave = normalizarComuna(fila.comuna);
    const hora = horaLocalDeInstante(instante);
    if (hora === null) continue;

    const actual = porComuna.get(clave);
    if (actual) {
      actual.horas.push(hora);
      actual.intensidad = Math.max(actual.intensidad, precipitacion);
    } else {
      porComuna.set(clave, { comuna: fila.comuna, horas: [hora], intensidad: precipitacion });
    }
  }

  const celdas: CeldaClima[] = [];
  for (const [clave, acumulado] of porComuna) {
    const canonica = resolverComunaCanonica(acumulado.comuna);
    const centroide = canonica ? CENTROIDES_RM[canonica as ComunaRM] : undefined;
    if (!centroide) continue; // fuera de la RM: no hay dónde dibujarla

    const desde = Math.min(...acumulado.horas);
    const hasta = Math.min(24, Math.max(...acumulado.horas) + 1);
    const zonaId = comunaAZona.get(clave);

    celdas.push({
      id: `clima-${fecha}-${clave.replace(/\s+/g, '-')}`,
      tipo: 'lluvia',
      centro: { lat: centroide.lat, long: centroide.long },
      radioMetros: radioDeComuna(acumulado.comuna),
      intensidadMmHora: Math.round(acumulado.intensidad * 10) / 10,
      ventana: {
        inicio: instanteSantiago(fecha, `${String(desde).padStart(2, '0')}:00`),
        fin: instanteSantiago(fecha, `${String(Math.min(hasta, 23)).padStart(2, '0')}:00`),
      },
      zonasAfectadas: zonaId ? [zonaId] : [],
    });
  }

  return celdas.sort((a, b) => b.intensidadMmHora - a.intensidadMmHora);
}

/** Hora local de Santiago de un instante, como entero 0–23. */
function horaLocalDeInstante(instante: Date): number | null {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(instante);
  const valor = Number(partes.find((p) => p.type === 'hour')?.value);
  if (!Number.isFinite(valor)) return null;
  return valor === 24 ? 0 : valor;
}

// =============================================================================
// Pronóstico de aire y restricción
// =============================================================================

/** Niveles de aire de mejor a peor. El orden ES la comparación. */
const ORDEN_AIRE: readonly NivelAire[] = ['bueno', 'regular', 'alerta', 'preemergencia', 'emergencia'];

/**
 * `PronosticoAire[]` agregando `aire_horario` por fecha de Santiago: el nivel
 * del día es el PEOR de sus horas y el PM2.5 el máximo.
 *
 * `esProyeccion` es true para toda fecha posterior a hoy: es pronóstico, no
 * medición, y la pantalla lo dice.
 */
export function armarPronosticoAire(
  filas: readonly FilaAireHorario[],
  fechaHoy: string,
): PronosticoAire[] {
  const porFecha = new Map<string, { pm25: number; nivel: NivelAire }>();

  for (const fila of filas) {
    const instante = new Date(fila.hora);
    if (Number.isNaN(instante.getTime())) continue;
    const fecha = fechaLocalEnSantiago(instante);

    const actual = porFecha.get(fecha) ?? { pm25: 0, nivel: 'bueno' as NivelAire };
    if (fila.pm25 !== null && fila.pm25 > actual.pm25) actual.pm25 = fila.pm25;
    if (ORDEN_AIRE.indexOf(fila.nivel_estimado) > ORDEN_AIRE.indexOf(actual.nivel)) {
      actual.nivel = fila.nivel_estimado;
    }
    porFecha.set(fecha, actual);
  }

  return [...porFecha.entries()]
    .map(([fecha, valor]) => ({
      fecha,
      pm25Maximo: Math.round(valor.pm25),
      nivel: valor.nivel,
      esProyeccion: fecha > fechaHoy,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * `RestriccionVehicular[]`.
 *
 * `vehiculosAfectados` va SIEMPRE en `null` y no es un olvido: el modelo de
 * datos no guarda patentes de la flota, así que no hay forma de saber cuántos
 * vehículos del courier quedan restringidos. Poner un número aquí sería
 * inventarlo. Cuando exista la entidad vehículo, ese conteo será POR TENANT.
 */
export function armarRestricciones(filas: readonly FilaRestriccion[]): RestriccionVehicular[] {
  return filas
    .map((fila) => ({
      fecha: fila.fecha,
      tipo: fila.tipo,
      digitos: fila.digitos ?? [],
      alcance: fila.alcance,
      vehiculosAfectados: null,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// =============================================================================
// Eventos de ciudad y marcas operativas
// =============================================================================

/** Eventos cuya ventana toca la fecha del horizonte. */
export function armarEventosCiudad(
  filas: readonly FilaEventoCiudad[],
  fecha: string,
): EventoCiudad[] {
  const eventos: EventoCiudad[] = [];

  for (const fila of filas) {
    const inicio = new Date(fila.ventana_inicio);
    if (Number.isNaN(inicio.getTime())) continue;
    const fin = fila.ventana_fin ? new Date(fila.ventana_fin) : null;

    const fechaInicio = fechaLocalEnSantiago(inicio);
    const fechaFin = fin && !Number.isNaN(fin.getTime()) ? fechaLocalEnSantiago(fin) : null;
    if (fechaInicio > fecha) continue;
    if (fechaFin !== null && fechaFin < fecha) continue;

    eventos.push({
      id: fila.id,
      nombre: fila.nombre,
      tipo: fila.tipo,
      recinto: fila.recinto,
      comuna: fila.comuna,
      posicion: { lat: fila.lat, long: fila.long },
      radioMetros: fila.radio_m,
      ventana: { inicio: inicio.toISOString(), fin: fin ? fin.toISOString() : null },
      asistenciaEstimada: fila.asistencia_estimada,
      fuente: fila.fuente,
    });
  }

  return eventos;
}

/**
 * Marcas del coordinador, con el autor resuelto a nombre.
 *
 * ⚠️ `nota` puede contener datos personales: no debe salir en logs ni en URLs.
 * Aquí solo viaja al navegador del propio courier.
 */
export function armarMarcasOperativas(
  filas: readonly FilaMarcaOperativa[],
  nombresPorUsuario: ReadonlyMap<string, string>,
): MarcaOperativa[] {
  return filas.map((fila) => ({
    id: fila.id,
    nota: fila.nota,
    posicion: { lat: fila.lat, long: fila.long },
    radioMetros: fila.radio_m,
    ventana: { inicio: fila.vigencia_inicio, fin: fila.vigencia_fin },
    autor:
      (fila.autor_usuario_id ? nombresPorUsuario.get(fila.autor_usuario_id) : undefined) ??
      'Alguien del equipo',
    creadaEn: fila.creada_en,
  }));
}

// =============================================================================
// Flota en vivo
// =============================================================================

/** Minutos sin ping desde los que se considera que se perdió la señal. */
export const MINUTOS_SIN_SENAL = 20;

export interface ConductorDeFlota {
  id: string;
  nombre: string;
  zonaId: string;
  lat: number;
  long: number;
  ultimoPing: string;
  paradasTotales: number;
  paradasCompletadas: number;
  /** Estado del manifiesto del día, si tiene uno. */
  estadoManifiesto: string | null;
}

/**
 * `ConductorEnMapa[]` — la flota en vivo.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NUNCA SE DEVUELVE `'detenido'`
 * -----------------------------------------------------------------------------
 * El contrato congelado admite cuatro estados: `en_ruta`, `detenido`,
 * `sin_senal` y `finalizado`. Tres se pueden calcular; **`detenido` no**, y no
 * por falta de trabajo: decir que un conductor está detenido exige saber que NO
 * se movió, y para eso hay que guardar dónde estaba antes.
 *
 * El modelo guarda a propósito **una sola fila por conductor, la última
 * posición, sin histórico de recorrido** — es minimización de datos personales
 * del trabajador (Ley 21.431), una decisión tomada en su momento y documentada
 * en `operacion/ubicacion-conductor.ts`. Emitir `'detenido'` obligaría a
 * reintroducir el rastro que esa decisión eliminó.
 *
 * Así que se emite el estado que el dato sostiene y ya. Un conductor quieto
 * aparece `en_ruta` con su hora de último ping a la vista, que es información
 * verdadera; inventar `detenido` sería una afirmación sobre su conducta hecha
 * con datos que no tenemos.
 */
export function armarConductores(
  conductores: readonly ConductorDeFlota[],
  ahora: Date,
): ConductorEnMapa[] {
  return conductores.map((c) => {
    const ping = new Date(c.ultimoPing);
    const valido = !Number.isNaN(ping.getTime());
    const minutosSinPing = valido
      ? Math.max(0, Math.round((ahora.getTime() - ping.getTime()) / 60_000))
      : Number.MAX_SAFE_INTEGER;

    return {
      id: c.id,
      nombre: c.nombre,
      zonaId: c.zonaId,
      posicion: { lat: c.lat, long: c.long },
      ultimoPing: valido ? ping.toISOString() : ahora.toISOString(),
      minutosSinPing: valido ? minutosSinPing : 0,
      paradasTotales: c.paradasTotales,
      paradasCompletadas: c.paradasCompletadas,
      estado: estadoDeConductor(c, minutosSinPing),
    };
  });
}

function estadoDeConductor(
  c: ConductorDeFlota,
  minutosSinPing: number,
): ConductorEnMapa['estado'] {
  // Terminar la ruta manda sobre todo lo demás: un conductor que cerró su
  // manifiesto y apagó el teléfono no es una señal perdida, es alguien que
  // terminó. Marcarlo `sin_senal` mandaría al coordinador a buscar un problema
  // que no existe.
  if (c.estadoManifiesto === 'completado') return 'finalizado';
  if (c.paradasTotales > 0 && c.paradasCompletadas >= c.paradasTotales) return 'finalizado';
  if (minutosSinPing > MINUTOS_SIN_SENAL) return 'sin_senal';
  return 'en_ruta';
}

// =============================================================================
// Línea de tiempo
// =============================================================================

export interface EntradaTimeline {
  fecha: string;
  zonas: readonly Zona[];
  celdasClima: readonly CeldaClima[];
  eventosCiudad: readonly EventoCiudad[];
  restricciones: readonly RestriccionVehicular[];
}

/**
 * Los bloques de la jornada, con su carril ya asignado.
 *
 * La ventana de reparto se queda con el carril 0 siempre: es el fondo sobre el
 * que se leen los demás. El resto se empaqueta con el algoritmo más simple que
 * funciona — cada bloque va al primer carril libre donde no pise a otro — y con
 * los bloques ordenados por hora de inicio, que es lo que hace que el resultado
 * sea estable entre renders. Un carril que baila entre recargas se lee como si
 * hubiera cambiado el dato.
 */
export function armarTimeline(entrada: EntradaTimeline): {
  timeline: BloqueTimeline[];
  rangoTimeline: Ventana;
} {
  const { fecha } = entrada;
  const rangoInicio = instanteSantiago(fecha, INICIO_JORNADA);
  const rangoFin = instanteSantiago(fecha, FIN_JORNADA);

  const candidatos: Omit<BloqueTimeline, 'carril'>[] = [];

  // La ventana de reparto llega hasta el corte más tardío del courier.
  const cortes = entrada.zonas.map((z) => z.ventanaCorte.hora).filter(Boolean).sort();
  const finReparto = cortes.length > 0 ? cortes[cortes.length - 1] : FIN_JORNADA;
  candidatos.push({
    id: 'tl-reparto',
    tipo: 'ventana_reparto',
    etiqueta: 'Ventana de reparto',
    inicio: rangoInicio,
    fin: instanteSantiago(fecha, finReparto),
    zonaId: null,
  });

  // Un corte solo entra si hay algo pendiente que dependa de él.
  for (const zona of entrada.zonas) {
    if (zona.pedidosPendientes === 0) continue;
    const enRiesgo = zona.pedidosPendientes > zona.capacidadEstimada;
    const instante = instanteSantiago(fecha, zona.ventanaCorte.hora);
    candidatos.push({
      id: `tl-corte-${zona.id}`,
      tipo: 'corte_en_riesgo',
      etiqueta: enRiesgo ? `Corte de ${zona.nombre} en riesgo` : `Corte de ${zona.nombre}`,
      inicio: instante,
      fin: instante,
      zonaId: zona.id,
    });
  }

  // Lluvia: un bloque por zona afectada, no uno por comuna — el riel y el mapa
  // hablan de zonas, y quince bloques de comuna llenarían la franja de ruido.
  const nombresDeZona = new Map(entrada.zonas.map((z) => [z.id, z.nombre]));
  const lluviaPorZona = new Map<string, { inicio: string; fin: string; intensidad: number }>();
  for (const celda of entrada.celdasClima) {
    for (const zonaId of celda.zonasAfectadas) {
      const actual = lluviaPorZona.get(zonaId);
      const fin = celda.ventana.fin ?? celda.ventana.inicio;
      if (actual) {
        if (celda.ventana.inicio < actual.inicio) actual.inicio = celda.ventana.inicio;
        if (fin > actual.fin) actual.fin = fin;
        actual.intensidad = Math.max(actual.intensidad, celda.intensidadMmHora);
      } else {
        lluviaPorZona.set(zonaId, { inicio: celda.ventana.inicio, fin, intensidad: celda.intensidadMmHora });
      }
    }
  }
  for (const [zonaId, lluvia] of lluviaPorZona) {
    candidatos.push({
      id: `tl-clima-${zonaId}`,
      tipo: 'clima',
      etiqueta: `Lluvia sobre ${nombresDeZona.get(zonaId) ?? 'la zona'}`,
      inicio: lluvia.inicio,
      fin: lluvia.fin,
      zonaId,
    });
  }

  for (const evento of entrada.eventosCiudad) {
    candidatos.push({
      id: `tl-evento-${evento.id}`,
      tipo: 'evento',
      etiqueta: evento.nombre,
      inicio: evento.ventana.inicio,
      fin: evento.ventana.fin ?? rangoFin,
      zonaId: null,
    });
  }

  // Solo la restricción EXTRAORDINARIA entra a la franja: la permanente del GEC
  // rige todos los días hábiles y pintarla a diario sería ruido, no señal.
  const extraordinaria = entrada.restricciones.find(
    (r) => r.fecha === fecha && r.tipo !== 'permanente',
  );
  if (extraordinaria) {
    candidatos.push({
      id: `tl-restriccion-${fecha}`,
      tipo: 'restriccion',
      etiqueta:
        extraordinaria.tipo === 'emergencia'
          ? 'Emergencia ambiental: restricción extraordinaria'
          : 'Preemergencia: restricción extraordinaria',
      inicio: rangoInicio,
      fin: rangoFin,
      zonaId: null,
    });
  }

  const timeline = asignarCarriles(recortarAlRango(candidatos, rangoInicio, rangoFin));
  return { timeline, rangoTimeline: { inicio: rangoInicio, fin: rangoFin } };
}

/** Descarta lo que cae fuera de la jornada y recorta lo que la desborda. */
function recortarAlRango(
  bloques: readonly Omit<BloqueTimeline, 'carril'>[],
  rangoInicio: string,
  rangoFin: string,
): Omit<BloqueTimeline, 'carril'>[] {
  const recortados: Omit<BloqueTimeline, 'carril'>[] = [];
  for (const bloque of bloques) {
    if (bloque.fin < rangoInicio || bloque.inicio > rangoFin) continue;
    recortados.push({
      ...bloque,
      inicio: bloque.inicio < rangoInicio ? rangoInicio : bloque.inicio,
      fin: bloque.fin > rangoFin ? rangoFin : bloque.fin,
    });
  }
  return recortados.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id.localeCompare(b.id));
}

function asignarCarriles(bloques: readonly Omit<BloqueTimeline, 'carril'>[]): BloqueTimeline[] {
  /** Fin del último bloque de cada carril. El índice 0 lo ocupa el reparto. */
  const finPorCarril: string[] = [];
  const salida: BloqueTimeline[] = [];

  for (const bloque of bloques) {
    if (bloque.tipo === 'ventana_reparto') {
      salida.push({ ...bloque, carril: 0 });
      continue;
    }

    let carril = 1;
    while (finPorCarril[carril] !== undefined && finPorCarril[carril] > bloque.inicio) {
      carril += 1;
    }
    finPorCarril[carril] = bloque.fin;
    salida.push({ ...bloque, carril });
  }

  return salida;
}
