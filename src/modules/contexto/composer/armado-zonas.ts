/**
 * Armado de `Zona[]` — de filas planas a lo que pinta el mapa.
 * =====================================================================
 *
 * Puro: sin BD, sin Inngest, sin `Date.now()`. Todo lo que necesita saber del
 * mundo llega por parámetro, incluido «ahora». Eso es lo que permite probar la
 * pieza donde más fácil se equivoca en silencio: una zona que pierde su
 * polígono por un acento, un corte que se lee al revés, un centroide espejado.
 *
 * -----------------------------------------------------------------------------
 * EL COMPOSER NO RECALCULA EL RIESGO
 * -----------------------------------------------------------------------------
 * `riesgo` y `factores` salen TAL CUAL de `contexto.riesgo_zona`, que es lo que
 * dejó el job. No se vuelve a llamar al motor aquí. Si el composer recalculara,
 * el número del mapa (nivel 1) y el desglose del riel (nivel 2) podrían
 * discrepar en cuanto uno de los dos leyera un insumo medio segundo distinto —
 * y la jerarquía de tres niveles se sostiene precisamente sobre que los tres son
 * el mismo número mirado con más detalle.
 *
 * Cuando no hay fila (el job no ha corrido para este tenant, o el courier no
 * tiene zonas), el puntaje es 0 y los seis factores lo DICEN. No se rellena con
 * un valor plausible: un tablero de anticipación que inventa deja de servir para
 * anticipar.
 */

import { normalizarComuna, resolverComunaCanonica } from '@/modules/integraciones/geocoding/normalizacion';
import { CENTROIDES_RM } from '@/lib/geo/centroides-rm';
import type { ComunaRM } from '@/lib/ui/comunas-rm';
import { horaAMinutos } from '@/lib/fecha-santiago';
import { nivelDesdePuntaje, PESOS_EFECTIVOS_F1 } from '../motor-riesgo';
import type { FactorRiesgoId, Franja } from '../tipos';
import type { Coordenada, FactorRiesgo, Zona } from '../contrato-torre';

// =============================================================================
// Centro de zona
// =============================================================================

/** Centro de la RM. Solo se usa si una zona no tiene ni una comuna con centroide. */
const CENTRO_RM: Coordenada = { lat: -33.45, long: -70.66 };

/**
 * Centro visual de una zona: el promedio de los centroides de sus comunas.
 *
 * Es para colocar la placa y encuadrar la cámara, no para medir nada. El
 * centroide geométrico real de la unión de polígonos lo calcula el cliente, que
 * es quien tiene la geometría; aquí basta el promedio, y evita mandar 113 KB de
 * TopoJSON al servidor para colocar cinco etiquetas.
 */
export function centroDeZona(comunas: readonly string[]): Coordenada {
  let sumaLat = 0;
  let sumaLong = 0;
  let cuenta = 0;

  for (const comuna of comunas) {
    const canonica = resolverComunaCanonica(comuna);
    const centroide = canonica ? CENTROIDES_RM[canonica as ComunaRM] : undefined;
    if (!centroide) continue;
    sumaLat += centroide.lat;
    sumaLong += centroide.long;
    cuenta += 1;
  }

  if (cuenta === 0) return CENTRO_RM;
  return { lat: sumaLat / cuenta, long: sumaLong / cuenta };
}

// =============================================================================
// Ventana de corte
// =============================================================================

export interface VentanaCorteFila {
  /** `null` = ventana por defecto del seller; con valor = override de esa zona. */
  zonaId: string | null;
  horaCorte: string;
  activa: boolean;
}

/**
 * El corte que aprieta la zona: **el más temprano entre los aplicables**, no el
 * de la zona ni el promedio.
 *
 * Una zona con un seller que corta a las 12:00 y otro a las 18:00 tiene su
 * presión a las 12:00. Tomar el último inventaría seis horas de holgura que no
 * existen para la mitad de los pedidos.
 *
 * A diferencia de `minutosHastaCorte` del motor, aquí `minutosRestantes` SÍ
 * puede ser negativo: el contrato lo declara así («negativo si ya venció») y la
 * pantalla usa el signo para decir «venció hace 40 min». El motor lo satura en
 * 0 porque mide urgencia, y más allá del corte la urgencia ya no crece; la
 * pantalla informa, y ahí sí importa cuánto se pasó.
 *
 * Sin ninguna ventana configurada devuelve `21:00` — el fin de la jornada de
 * reparto del propio esquema (`contexto.franja`: punta 17–21) — y lo dice en la
 * pantalla vía el estado de configuración, no aquí.
 */
export function ventanaCorteDeZona(
  ventanas: readonly VentanaCorteFila[],
  zonaId: string,
  diasDeDiferencia: number,
  ahoraMinutos: number,
): { hora: string; minutosRestantes: number } {
  const aplicables = ventanas.filter(
    (v) => v.activa && (v.zonaId === zonaId || v.zonaId === null),
  );

  const minutoCorte =
    aplicables.length > 0
      ? Math.min(...aplicables.map((v) => horaAMinutos(v.horaCorte)))
      : horaAMinutos('21:00');

  const hora = `${String(Math.floor(minutoCorte / 60)).padStart(2, '0')}:${String(
    minutoCorte % 60,
  ).padStart(2, '0')}`;

  return {
    hora,
    minutosRestantes: diasDeDiferencia * 1440 + minutoCorte - ahoraMinutos,
  };
}

// =============================================================================
// Factores
// =============================================================================

const ETIQUETAS_FACTOR: Readonly<Record<FactorRiesgoId, string>> = {
  presion_operativa: 'Presión operativa',
  clima: 'Clima',
  aire: 'Aire y restricción',
  transito: 'Tránsito',
  eventos: 'Eventos',
  historico: 'Histórico propio',
};

const ORDEN_FACTORES: readonly FactorRiesgoId[] = [
  'presion_operativa',
  'clima',
  'aire',
  'transito',
  'eventos',
  'historico',
];

/**
 * Los seis factores cuando no hay puntaje que mostrar, con su explicación
 * honesta. No es un `[]`: la pantalla lista los seis siempre, y una lista vacía
 * se leería como «no hay factores», que es distinto de «todavía no se calculan».
 */
export function factoresSinCalculo(motivo: string): FactorRiesgo[] {
  return ORDEN_FACTORES.map((id) => ({
    id,
    etiqueta: ETIQUETAS_FACTOR[id],
    valor: 0,
    peso: PESOS_EFECTIVOS_F1[id],
    explicacion: motivo,
  }));
}

/** Lee `desglose.factores` de una fila de `riesgo_zona`, tolerando basura. */
export function factoresDesdeDesglose(desglose: unknown): FactorRiesgo[] | null {
  if (typeof desglose !== 'object' || desglose === null) return null;
  const crudo = (desglose as { factores?: unknown }).factores;
  if (!Array.isArray(crudo) || crudo.length === 0) return null;

  const factores: FactorRiesgo[] = [];
  for (const item of crudo) {
    if (typeof item !== 'object' || item === null) continue;
    const f = item as Record<string, unknown>;
    const id = f.id;
    if (typeof id !== 'string' || !ORDEN_FACTORES.includes(id as FactorRiesgoId)) continue;
    factores.push({
      id: id as FactorRiesgo['id'],
      etiqueta: typeof f.etiqueta === 'string' ? f.etiqueta : ETIQUETAS_FACTOR[id as FactorRiesgoId],
      valor: typeof f.valor === 'number' ? f.valor : 0,
      peso: typeof f.peso === 'number' ? f.peso : PESOS_EFECTIVOS_F1[id as FactorRiesgoId],
      explicacion: typeof f.explicacion === 'string' ? f.explicacion : '',
    });
  }

  return factores.length > 0 ? factores : null;
}

/** Franja que el job marcó como dominante al colapsar el día. */
export function franjaDominanteDesdeDesglose(desglose: unknown): Franja | null {
  if (typeof desglose !== 'object' || desglose === null) return null;
  const valor = (desglose as { franja_dominante?: unknown }).franja_dominante;
  return valor === 'manana' || valor === 'tarde' || valor === 'punta' ? valor : null;
}

function puntajeColapsadoDesdeDesglose(desglose: unknown): number | null {
  if (typeof desglose !== 'object' || desglose === null) return null;
  const valor = (desglose as { puntaje_colapsado?: unknown }).puntaje_colapsado;
  return typeof valor === 'number' ? valor : null;
}

// =============================================================================
// Armado
// =============================================================================

/** Una fila de `contexto.riesgo_zona`, ya en camelCase. */
export interface RiesgoDeFranja {
  zonaId: string;
  franja: Franja;
  puntaje: number;
  desglose: unknown;
  pedidosPendientes: number;
  montoComprometidoClp: number;
}

export interface ZonaConfigurada {
  id: string;
  nombre: string;
  /** Nombres canónicos de comuna, para mostrar. */
  comunas: string[];
}

export interface ConductorDeZona {
  id: string;
  capacidadParadas: number;
  disponible: boolean;
}

export interface EntradaArmadoZonas {
  zonas: readonly ZonaConfigurada[];
  /** Filas de `riesgo_zona` de LA FECHA del horizonte, todas sus franjas. */
  riesgo: readonly RiesgoDeFranja[];
  /** Capacidad por zona, ya repartida (viene de `capacidadPorZona`). */
  capacidadPorZona: ReadonlyMap<string, number>;
  /** Conductores de cada zona: los asignados, con su bandera de disponibilidad. */
  conductoresPorZona: ReadonlyMap<string, ConductorDeZona[]>;
  /** Entregados por zona en la fecha del horizonte. */
  entregadosPorZona: ReadonlyMap<string, number>;
  /**
   * Pendientes y monto por zona contados EN VIVO. Solo se usa para las zonas que
   * no tienen fila de riesgo — ver `armarZonas`.
   */
  cargaEnVivoPorZona: ReadonlyMap<string, { pendientes: number; montoClp: number }>;
  ventanas: readonly VentanaCorteFila[];
  /** Días entre hoy y la fecha del horizonte (0, 1 o 2). */
  diasDeDiferencia: number;
  /** Minutos desde medianoche, hora de Santiago. */
  ahoraMinutos: number;
  /** Explicación para los factores cuando no hay fila de riesgo. */
  motivoSinCalculo: string;
}

/**
 * `Zona[]` para UNA fecha de horizonte, ordenadas de mayor a menor riesgo.
 *
 * El orden no es cosmético: el des-solapado de placas del mapa coloca primero
 * la de mayor riesgo y hace ceder a las demás, así que un orden distinto movería
 * la placa crítica de sitio.
 */
export function armarZonas(entrada: EntradaArmadoZonas): Zona[] {
  const porZona = new Map<string, RiesgoDeFranja[]>();
  for (const fila of entrada.riesgo) {
    const lista = porZona.get(fila.zonaId);
    if (lista) lista.push(fila);
    else porZona.set(fila.zonaId, [fila]);
  }

  const zonas = entrada.zonas.map<Zona>((zona) => {
    const filas = porZona.get(zona.id) ?? [];
    const dominante = elegirFilaDominante(filas);

    const puntaje = dominante
      ? Math.round(puntajeColapsadoDesdeDesglose(dominante.desglose) ?? dominante.puntaje)
      : 0;
    const factores = dominante
      ? (factoresDesdeDesglose(dominante.desglose) ?? factoresSinCalculo(entrada.motivoSinCalculo))
      : factoresSinCalculo(entrada.motivoSinCalculo);

    const conductores = entrada.conductoresPorZona.get(zona.id) ?? [];

    // Con fila de riesgo manda la fila; sin ella, el conteo en vivo.
    //
    // No es una preferencia estética. La explicación que el motor escribió cita
    // su propio número literal («86 pedidos pendientes contra capacidad de 60»),
    // así que mostrar al lado un conteo más fresco haría que el nivel 1 y el
    // nivel 2 se contradijeran en la misma pantalla. Y al revés: sin fila —el
    // job todavía no corrió para este tenant, o el courier no tiene zonas
    // propias— dejar cero mostraría un tablero vacío sobre una operación llena.
    const enVivo = entrada.cargaEnVivoPorZona.get(zona.id);
    const pendientes = dominante?.pedidosPendientes ?? enVivo?.pendientes ?? 0;
    const monto = dominante?.montoComprometidoClp ?? enVivo?.montoClp ?? 0;

    return {
      id: zona.id,
      nombre: zona.nombre,
      comunas: zona.comunas,
      riesgo: puntaje,
      nivel: nivelDesdePuntaje(puntaje),
      factores,
      pedidosPendientes: pendientes,
      pedidosEntregados: entrada.entregadosPorZona.get(zona.id) ?? 0,
      capacidadEstimada: entrada.capacidadPorZona.get(zona.id) ?? 0,
      conductoresAsignados: conductores.length,
      conductoresDisponibles: conductores.filter((c) => c.disponible).length,
      ventanaCorte: ventanaCorteDeZona(
        entrada.ventanas,
        zona.id,
        entrada.diasDeDiferencia,
        entrada.ahoraMinutos,
      ),
      montoComprometidoClp: monto,
      centro: centroDeZona(zona.comunas),
    };
  });

  return zonas.sort((a, b) => b.riesgo - a.riesgo || a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * De las hasta tres filas de una zona (una por franja), la que el job marcó
 * como dominante; si esa marca no está, la de mayor puntaje.
 *
 * Se prefiere la marca del job y no el máximo recalculado aquí porque el job
 * descarta las franjas ya vencidas para el horizonte `hoy` — a las 18:00, la
 * franja de la mañana ya no anticipa nada. Recalcular el máximo aquí resucitaría
 * esa franja muerta y la pantalla mostraría un riesgo que ya pasó.
 */
function elegirFilaDominante(filas: readonly RiesgoDeFranja[]): RiesgoDeFranja | null {
  if (filas.length === 0) return null;

  const marcada = franjaDominanteDesdeDesglose(filas[0].desglose);
  if (marcada) {
    const fila = filas.find((f) => f.franja === marcada);
    if (fila) return fila;
  }

  return filas.reduce((mejor, fila) => (fila.puntaje > mejor.puntaje ? fila : mejor));
}

// =============================================================================
// Mapeo comuna → zona
// =============================================================================

/**
 * Índice `comuna normalizada → zonaId`. Se normaliza con el MISMO helper que usó
 * `zona_comunas` al escribirse: una comuna que no empareja por un acento no
 * lanza, simplemente deja de contar, y sus pedidos desaparecen del tablero.
 */
export function indexarComunaAZona(
  zonas: readonly ZonaConfigurada[],
): Map<string, string> {
  const indice = new Map<string, string>();
  for (const zona of zonas) {
    for (const comuna of zona.comunas) {
      indice.set(normalizarComuna(comuna), zona.id);
    }
  }
  return indice;
}

/** Cuenta por zona, agrupando por comuna. Sirve para entregados y pendientes. */
export function contarPorZona(
  filas: readonly { comuna: string }[],
  comunaAZona: ReadonlyMap<string, string>,
): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const fila of filas) {
    const zonaId = comunaAZona.get(normalizarComuna(fila.comuna));
    if (!zonaId) continue;
    conteo.set(zonaId, (conteo.get(zonaId) ?? 0) + 1);
  }
  return conteo;
}
