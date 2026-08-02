/**
 * Agregación de insumos del motor de riesgo — de filas de BD a entradas puras.
 * =====================================================================
 *
 * Entre las consultas (I/O, en el job y en el composer) y el motor de riesgo
 * (puro, sin BD) falta un paso que no es ninguna de las dos cosas: convertir
 * filas planas —pronóstico horario por comuna, ventanas de corte por seller,
 * asignaciones de conductor a zona, tarifas— en las entradas por ZONA y por
 * FRANJA que el motor espera.
 *
 * Ese paso vive aquí, separado y puro, por dos razones:
 *
 *   1. **El job y el composer necesitan exactamente lo mismo.** El nivel 2 de
 *      la pantalla («por qué») muestra el desglose de los mismos seis factores
 *      que el job persiste. Si cada uno agregara por su cuenta, el mapa y el
 *      desglose podrían contradecirse — que es justo lo que la jerarquía de
 *      tres niveles no puede permitirse.
 *   2. **Es lo que más fácil se equivoca en silencio.** Un `max` donde iba un
 *      `promedio`, una comuna que no empareja por un acento, una franja que se
 *      lee en UTC. Nada de eso lanza: produce un número plausible y equivocado.
 *      Aislado y puro, se puede probar.
 *
 * ZONA HORARIA. `clima_horario.hora` y `aire_horario.hora` son `timestamptz`
 * (UTC en disco). Aquí se convierten a fecha y hora **de Santiago** con los
 * helpers de `@/lib/fecha-santiago`, nunca con `toISOString()`. A las 21:00 de
 * Santiago UTC ya está en el día siguiente: leer la fecha civil de un instante
 * UTC mete el pronóstico de mañana en la franja de punta de hoy.
 */

import { fechaLocalEnSantiago, horaLocalEnSantiago, horaAMinutos } from '@/lib/fecha-santiago';
import { normalizarComuna } from '@/modules/integraciones/geocoding/normalizacion';
import type { NivelAire } from '@/modules/integraciones/contexto/aire/tipos';
import type { EntradaClima, EntradaEventos, EventoEnVentana } from './motor-riesgo';
import type { Franja } from './tipos';

/** Ventana horaria local de cada franja. Espeja `contexto.franja` de la migración. */
export const RANGO_FRANJA: Readonly<Record<Franja, { desde: string; hasta: string }>> = {
  manana: { desde: '08:00', hasta: '12:00' },
  tarde: { desde: '12:00', hasta: '17:00' },
  punta: { desde: '17:00', hasta: '21:00' },
};

/**
 * Niveles de aire, de mejor a peor. El orden ES la comparación: `indexOf` sobre
 * este arreglo es lo que decide cuál es «el peor» de una zona. Se declara
 * `satisfies` contra `NivelAire` para que añadir un nivel al enum sin ordenarlo
 * aquí sea un error de compilación y no una comparación silenciosamente mal.
 */
const ORDEN_AIRE = [
  'bueno',
  'regular',
  'alerta',
  'preemergencia',
  'emergencia',
] as const satisfies readonly NivelAire[];

// =============================================================================
// Capacidad por zona
// =============================================================================

export interface ConductorCapacidad {
  id: string;
  capacidadParadas: number;
}

/** Fila de `identidad.conductor_zonas`. */
export interface AsignacionZona {
  conductorId: string;
  zonaId: string;
}

/**
 * Reparte la capacidad instalada entre las zonas, usando las zonas preferentes
 * de cada conductor.
 *
 * Tres reglas, y las tres importan:
 *
 * - Un conductor asignado a UNA zona aporta ahí toda su capacidad.
 * - Un conductor asignado a VARIAS reparte su capacidad entre ellas. No se
 *   suma completa a cada una: un conductor con 30 paradas que cubre Centro y
 *   Poniente no da 30 paradas en cada una, da 30 en total. Contarlo dos veces
 *   infla la holgura justo donde el coordinador la mira para decidir.
 * - Un conductor SIN zonas asignadas es pool flexible y se reparte entre todas.
 *   Es el caso del courier que todavía no configuró preferencias, y antes de
 *   esto era el ÚNICO comportamiento: se dividía el pool completo a partes
 *   iguales, con lo que una zona con cero conductores propios mostraba
 *   capacidad como si los tuviera.
 *
 * Devuelve un entero por zona (se trunca: media parada no existe).
 */
export function capacidadPorZona(
  conductores: readonly ConductorCapacidad[],
  asignaciones: readonly AsignacionZona[],
  zonaIds: readonly string[],
): Map<string, number> {
  const capacidad = new Map<string, number>(zonaIds.map((id) => [id, 0]));
  if (zonaIds.length === 0) return capacidad;

  const zonasValidas = new Set(zonaIds);
  const zonasDeConductor = new Map<string, string[]>();
  for (const a of asignaciones) {
    if (!zonasValidas.has(a.zonaId)) continue;
    const lista = zonasDeConductor.get(a.conductorId);
    if (lista) lista.push(a.zonaId);
    else zonasDeConductor.set(a.conductorId, [a.zonaId]);
  }

  const acumulado = new Map<string, number>(zonaIds.map((id) => [id, 0]));
  for (const conductor of conductores) {
    const destino = zonasDeConductor.get(conductor.id) ?? zonaIds;
    const porZona = conductor.capacidadParadas / destino.length;
    for (const zonaId of destino) {
      acumulado.set(zonaId, (acumulado.get(zonaId) ?? 0) + porZona);
    }
  }

  for (const [zonaId, valor] of acumulado) capacidad.set(zonaId, Math.floor(valor));
  return capacidad;
}

// =============================================================================
// Minutos hasta el corte
// =============================================================================

/** Fila de `identidad.ventanas_corte`, ya filtrada por tenant. */
export interface VentanaCorte {
  /** `null` = ventana por defecto del seller; con valor = override de esa zona. */
  zonaId: string | null;
  /** Hora local de Santiago, `HH:MM` o `HH:MM:SS`. */
  horaCorte: string;
  activa: boolean;
}

/**
 * Minutos que faltan para el primer corte aplicable a la zona.
 *
 * **La más temprana entre las activas aplicables**, y no la de la zona ni la
 * media: el corte que aprieta es el primero que vence. Una zona con un seller
 * que corta a las 12:00 y otro a las 18:00 tiene su presión a las 12:00 — si
 * se tomara la última, el tablero diría que hay seis horas de holgura que no
 * existen para la mitad de los pedidos.
 *
 * Aplicables = activas y con `zonaId` igual al de la zona **o** `null` (la
 * ventana por defecto del seller, que rige donde no hay override).
 *
 * Devuelve `null` si el courier no configuró ninguna ventana — el motor lo
 * trata como «sin dato», que es distinto de «sin tiempo». Un corte ya vencido
 * devuelve 0, no un negativo: el motor mide urgencia, y más allá del corte la
 * urgencia ya no crece.
 */
export function minutosHastaCorte(
  ventanas: readonly VentanaCorte[],
  zonaId: string,
  fechaObjetivo: string,
  ahora: { fecha: string; horaMinutos: number },
): number | null {
  const aplicables = ventanas.filter(
    (v) => v.activa && (v.zonaId === zonaId || v.zonaId === null),
  );
  if (aplicables.length === 0) return null;

  const minutoCorte = Math.min(...aplicables.map((v) => horaAMinutos(v.horaCorte)));
  const diasDeDiferencia = diasEntre(ahora.fecha, fechaObjetivo);
  return Math.max(0, diasDeDiferencia * 1440 + minutoCorte - ahora.horaMinutos);
}

/** Días de calendario entre dos fechas civiles `YYYY-MM-DD`. */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(
    Number(desde.slice(0, 4)),
    Number(desde.slice(5, 7)) - 1,
    Number(desde.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(hasta.slice(0, 4)),
    Number(hasta.slice(5, 7)) - 1,
    Number(hasta.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

// =============================================================================
// Clima y aire por zona y franja
// =============================================================================

/** Fila de `contexto.clima_horario`. `hora` es el timestamptz tal como llega. */
export interface FilaClima {
  comuna: string;
  hora: string;
  precipitacionMm: number | null;
  vientoKmh: number | null;
}

/** Fila de `contexto.aire_horario`. */
export interface FilaAire {
  comuna: string;
  hora: string;
  nivelEstimado: NivelAire;
}

/**
 * Índice `comuna normalizada → fecha Santiago → franja → filas`. Se construye
 * UNA vez por corrida y lo comparten las tres franjas × las N zonas × los tres
 * horizontes: sin él, cada combinación recorrería las ~3.700 filas del
 * pronóstico completo.
 */
export function indexarPorComunaFechaFranja<T extends { comuna: string; hora: string }>(
  filas: readonly T[],
): Map<string, Map<string, Map<Franja, T[]>>> {
  const indice = new Map<string, Map<string, Map<Franja, T[]>>>();

  for (const fila of filas) {
    const instante = new Date(fila.hora);
    if (Number.isNaN(instante.getTime())) continue;

    const fecha = fechaLocalEnSantiago(instante);
    const franja = franjaDeHora(horaLocalEnSantiago(instante));
    if (!franja) continue; // fuera de 08–21: no es ventana de reparto

    const comuna = normalizarComuna(fila.comuna);
    let porFecha = indice.get(comuna);
    if (!porFecha) indice.set(comuna, (porFecha = new Map()));
    let porFranja = porFecha.get(fecha);
    if (!porFranja) porFecha.set(fecha, (porFranja = new Map()));
    const lista = porFranja.get(franja);
    if (lista) lista.push(fila);
    else porFranja.set(franja, [fila]);
  }

  return indice;
}

/**
 * Franja a la que pertenece una hora local `HH:MM`, o `null` si cae fuera de la
 * jornada de reparto. El borde es cerrado por abajo y abierto por arriba
 * (12:00 es tarde, no mañana), igual que `RANGO_FRANJA`.
 */
export function franjaDeHora(hora: string): Franja | null {
  const minutos = horaAMinutos(hora);
  for (const franja of ['manana', 'tarde', 'punta'] as const) {
    const { desde, hasta } = RANGO_FRANJA[franja];
    if (minutos >= horaAMinutos(desde) && minutos < horaAMinutos(hasta)) return franja;
  }
  return null;
}

function filasDe<T>(
  indice: Map<string, Map<string, Map<Franja, T[]>>>,
  comunas: readonly string[],
  fecha: string,
  franja: Franja,
): T[] {
  const salida: T[] = [];
  for (const comuna of comunas) {
    const filas = indice.get(normalizarComuna(comuna))?.get(fecha)?.get(franja);
    if (filas) salida.push(...filas);
  }
  return salida;
}

/**
 * Clima de una zona en una franja: el **peor** de sus comunas, no el promedio.
 *
 * Una zona no se moja «en promedio». Si llueve 8 mm/h sobre Las Condes y nada
 * sobre Vitacura, el coordinador de la zona Oriente tiene un problema de 8, no
 * de 4: los pedidos de Las Condes se van a atrasar igual. Promediar es lo que
 * hace que un tablero de anticipación no anticipe nada.
 */
export function climaDeZonaFranja(
  indice: Map<string, Map<string, Map<Franja, FilaClima[]>>>,
  comunas: readonly string[],
  fecha: string,
  franja: Franja,
): EntradaClima {
  const filas = filasDe(indice, comunas, fecha, franja);
  const { desde, hasta } = RANGO_FRANJA[franja];

  let precipitacion = 0;
  let viento: number | null = null;
  for (const fila of filas) {
    if (fila.precipitacionMm !== null && fila.precipitacionMm > precipitacion) {
      precipitacion = fila.precipitacionMm;
    }
    if (fila.vientoKmh !== null && (viento === null || fila.vientoKmh > viento)) {
      viento = fila.vientoKmh;
    }
  }

  return {
    precipitacionMaximaMmHora: precipitacion,
    vientoMaximoKmh: viento,
    ventanaInicioLocal: desde,
    ventanaFinLocal: hasta,
  };
}

/**
 * Nivel de aire de una zona en una franja: el peor de sus comunas. Mismo
 * criterio que el clima, y aquí con más razón — un episodio se decreta, no se
 * promedia.
 *
 * Sin dato devuelve `'bueno'`, que es el neutro del motor. Es una decisión
 * consciente: no hay forma de distinguir «aire limpio» de «no medimos» con el
 * tipo del contrato, y suponer lo peor pintaría de rojo todas las zonas cada
 * vez que el feed del MMA se cae.
 */
export function aireDeZonaFranja(
  indice: Map<string, Map<string, Map<Franja, FilaAire[]>>>,
  comunas: readonly string[],
  fecha: string,
  franja: Franja,
): NivelAire {
  const filas = filasDe(indice, comunas, fecha, franja);
  let peor: NivelAire = 'bueno';
  for (const fila of filas) {
    if (ORDEN_AIRE.indexOf(fila.nivelEstimado) > ORDEN_AIRE.indexOf(peor)) {
      peor = fila.nivelEstimado;
    }
  }
  return peor;
}

// =============================================================================
// Eventos por zona y franja
// =============================================================================

/** Fila de `contexto.eventos_ciudad`. */
export interface FilaEvento {
  nombre: string;
  comuna: string;
  ventanaInicio: string;
  ventanaFin: string | null;
  asistenciaEstimada: number | null;
}

/**
 * Eventos que caen sobre una zona en una franja.
 *
 * El emparejamiento es **por comuna**, no por distancia al radio. El contrato
 * trae `lat/long/radio_m`, pero las zonas del courier no tienen geometría en la
 * base: se definen como un conjunto de comunas. Cruzar un radio en metros
 * contra un conjunto de nombres exigiría la geometría comunal en el servidor —
 * hoy solo existe en el cliente, como activo estático del mapa. La comuna del
 * recinto es la aproximación honesta y disponible; el radio se usa en el mapa,
 * que sí tiene geometría, para dibujar el perímetro.
 *
 * Un evento cuenta si su ventana se solapa con la franja. `ventanaFin` nula =
 * sin término conocido, y se toma como que sigue en curso.
 */
export function eventosDeZonaFranja(
  eventos: readonly FilaEvento[],
  comunas: readonly string[],
  fecha: string,
  franja: Franja,
): EntradaEventos {
  const deLaZona = new Set(comunas.map(normalizarComuna));
  const { desde, hasta } = RANGO_FRANJA[franja];
  const relevantes: EventoEnVentana[] = [];

  for (const evento of eventos) {
    if (!deLaZona.has(normalizarComuna(evento.comuna))) continue;

    const inicio = new Date(evento.ventanaInicio);
    if (Number.isNaN(inicio.getTime())) continue;
    const fin = evento.ventanaFin ? new Date(evento.ventanaFin) : null;

    const fechaInicio = fechaLocalEnSantiago(inicio);
    const fechaFin = fin ? fechaLocalEnSantiago(fin) : null;
    // El evento tiene que tocar el día evaluado.
    if (fechaInicio > fecha) continue;
    if (fechaFin !== null && fechaFin < fecha) continue;

    // Y solaparse con la franja dentro de ese día.
    const minutoInicio = fechaInicio === fecha ? horaAMinutos(horaLocalEnSantiago(inicio)) : 0;
    const minutoFin =
      fin === null ? 1440 : fechaFin === fecha ? horaAMinutos(horaLocalEnSantiago(fin)) : 1440;
    if (minutoInicio >= horaAMinutos(hasta) || minutoFin <= horaAMinutos(desde)) continue;

    relevantes.push({ nombre: evento.nombre, asistenciaEstimada: evento.asistenciaEstimada });
  }

  return { eventos: relevantes };
}

// =============================================================================
// Dinero comprometido
// =============================================================================

/** Pedido pendiente, con lo mínimo para agregarlo por zona y valorizarlo. */
export interface PedidoPendiente {
  destinatarioComuna: string;
  fechaCompromiso: string | null;
  tarifaAplicableId: string | null;
}

/**
 * Pendientes y monto comprometido por zona para una fecha.
 *
 * **El monto sale de `identidad.tarifas` vía `pedidos.tarifa_aplicable_id`, y
 * NO de `dinero.lineas_cobro`.** Las líneas de cobro nacen cuando el pedido se
 * entrega: consultarlas aquí daría siempre cero, porque estos pedidos son
 * justamente los que todavía NO se entregaron. Lo que la Torre necesita es lo
 * contrario — cuánto dinero está en juego si el reparto de hoy falla — y eso es
 * la tarifa pactada del pedido pendiente.
 *
 * Un pedido sin tarifa asignada suma a los pendientes pero no al monto: no se
 * le inventa un precio.
 */
export function cargaPorZona(
  pedidos: readonly PedidoPendiente[],
  comunaAZona: ReadonlyMap<string, string>,
  tarifas: ReadonlyMap<string, number>,
  fecha: string,
): Map<string, { pendientes: number; montoClp: number }> {
  const carga = new Map<string, { pendientes: number; montoClp: number }>();

  for (const pedido of pedidos) {
    if (pedido.fechaCompromiso !== fecha) continue;
    const zonaId = comunaAZona.get(normalizarComuna(pedido.destinatarioComuna));
    if (!zonaId) continue;

    const actual = carga.get(zonaId) ?? { pendientes: 0, montoClp: 0 };
    actual.pendientes += 1;
    const tarifa = pedido.tarifaAplicableId ? tarifas.get(pedido.tarifaAplicableId) : undefined;
    if (tarifa !== undefined) actual.montoClp += tarifa;
    carga.set(zonaId, actual);
  }

  return carga;
}

// =============================================================================
// Histórico propio
// =============================================================================

/** Pedido ya cerrado, para la tasa de fallidos. */
export interface PedidoCerrado {
  destinatarioComuna: string;
  estado: string;
}

const ESTADOS_FALLIDOS = new Set(['fallido', 'fallido_manual']);
const ESTADOS_ENTREGADOS = new Set(['entregado', 'entregado_manual']);

/**
 * Tasa de fallidos por zona, en porcentaje, sobre los pedidos ya cerrados.
 *
 * Este es el factor que ninguna API entrega y que se vuelve el foso del
 * producto con el tiempo: cuánto le cuesta a ESTE courier repartir en ESA zona.
 *
 * `null` cuando la muestra es demasiado chica para significar algo. Con cinco
 * pedidos, un fallido son 20 puntos de tasa y eso no es una señal, es ruido —
 * y el motor ya sabe tratar `null` como «sin historia suficiente» en vez de
 * como «cero fallidos».
 */
export const MINIMO_MUESTRA_HISTORICO = 20;

export function tasaFallidosPorZona(
  cerrados: readonly PedidoCerrado[],
  comunaAZona: ReadonlyMap<string, string>,
): Map<string, number | null> {
  const conteo = new Map<string, { fallidos: number; total: number }>();

  for (const pedido of cerrados) {
    const zonaId = comunaAZona.get(normalizarComuna(pedido.destinatarioComuna));
    if (!zonaId) continue;
    const esFallido = ESTADOS_FALLIDOS.has(pedido.estado);
    const esEntregado = ESTADOS_ENTREGADOS.has(pedido.estado);
    if (!esFallido && !esEntregado) continue; // cancelado/devuelto no son intento fallido

    const actual = conteo.get(zonaId) ?? { fallidos: 0, total: 0 };
    actual.total += 1;
    if (esFallido) actual.fallidos += 1;
    conteo.set(zonaId, actual);
  }

  const tasas = new Map<string, number | null>();
  for (const [zonaId, { fallidos, total }] of conteo) {
    tasas.set(zonaId, total < MINIMO_MUESTRA_HISTORICO ? null : (fallidos / total) * 100);
  }
  return tasas;
}
