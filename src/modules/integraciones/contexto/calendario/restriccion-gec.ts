/**
 * Restricción vehicular PERMANENTE del GEC — función pura, sin red.
 * =====================================================================
 *
 * §4 del diseño lo dice y es correcto: *"es determinística — se calcula, no se
 * consulta"*. Este archivo no le pega a ninguna API, no lee ningún feed y no
 * tiene estado. Entra una fecha, sale la restricción.
 *
 * -----------------------------------------------------------------------------
 * FUENTE (verificada 2026-07-26, documento primario)
 * -----------------------------------------------------------------------------
 * "Plan Operacional para la Gestión de Episodios Críticos … Región
 * Metropolitana, año 2026" (SEREMI MA RM / MMA), §C.3.b "Restricción Vehicular",
 * Cuadros 13, 14 y 15. Dispuesto por los Arts. 120–123 del D.S. N° 31/2016
 * (PPDA de la RM), implementado por la SEREMITT RM.
 *   airerm.mma.gob.cl/wp-content/uploads/2026/04/01.-Plan-Operacional-GEC-2026_vf.pdf
 * Corroborado con mtt.gob.cl/restriccion-vehicular-2026/ y con el anuncio del
 * lanzamiento del GEC 2026 en mma.gob.cl.
 *
 * Cita literal: *"se debe disponer una prohibición de circulación de vehículos
 * motorizados, desde el día 1 de mayo de 2026 y hasta el 31 de agosto del mismo
 * año … de lunes a viernes, excepto festivos"*.
 *
 * -----------------------------------------------------------------------------
 * TRES COSAS QUE §4 NO DICE Y QUE CAMBIAN EL RESULTADO
 * -----------------------------------------------------------------------------
 * §4 resume la restricción como "lunes 8-9, martes 0-1, miércoles 2-3, jueves
 * 4-5, viernes 6-7, vigente desde el 4 de mayo". Es correcto pero incompleto, y
 * las tres omisiones producen datos falsos si se implementa al pie de la letra:
 *
 * 1. **TIENE FECHA DE TÉRMINO: el 31 de agosto.** No es una restricción de todo
 *    el año, es la temporada GEC (1 may – 31 ago). Una función que solo mire el
 *    día de la semana anunciaría en octubre una restricción que no existe. El
 *    "4 de mayo" de §4 no es el inicio de la vigencia: es el primer lunes hábil
 *    —el 1 de mayo de 2026 cae viernes y es feriado irrenunciable, y el 2 y 3
 *    son fin de semana—, así que el primer día en que el calendario de dígitos
 *    efectivamente muerde es el lunes 4.
 *
 * 2. **NO RIGE EN FERIADOS.** Por eso `calcularRestriccionPermanente` recibe el
 *    conjunto de feriados: es el punto de encuentro entre este cálculo y el
 *    puerto de calendario. Sin feriados a la vista la función es honesta y lo
 *    dice (`feriadosConsiderados: false`) en vez de fingir certeza.
 *
 * 3. **HAY DOS CALENDARIOS DE DÍGITOS, NO UNO.** El de §4 (2 dígitos) es el de
 *    vehículos CON sello verde inscritos antes del 1-sep-2011 (Cuadro 14) y el
 *    de motos anteriores al 1-sep-2010 (Cuadro 15). Los vehículos SIN sello
 *    verde tienen otro, de 4 dígitos (Cuadro 13): lunes 6-7-8-9, martes 0-1-2-3,
 *    miércoles 4-5-6-7, jueves 8-9-0-1, viernes 2-3-4-5. Para una flota de
 *    reparto la distinción no es académica: los vehículos de CARGA sin sello
 *    verde usan ese segundo calendario, en horario 10:00–18:00 y solo dentro del
 *    anillo Américo Vespucio.
 *
 * -----------------------------------------------------------------------------
 * LO QUE ESTE ARCHIVO **NO** HACE, Y POR QUÉ
 * -----------------------------------------------------------------------------
 * La restricción EXTRAORDINARIA (preemergencia / emergencia) NO se calcula y no
 * se intenta. Verificado en el mismo Plan Operacional, Cuadros 18 y 20: los
 * dígitos adicionales son *"2 dígitos aleatorios"* / *"6 dígitos aleatorios"*
 * que fija la autoridad al decretar el episodio. No hay función que los derive:
 * son un acto administrativo, no una regla. (Dato adicional del Cuadro
 * correspondiente a Alerta: en episodio de ALERTA *"se aplicará la restricción
 * permanente"*, sin dígitos extra — conviene no asumir que los tres niveles
 * suman dígitos.)
 *
 * Ese dato tiene que leerse del feed del MMA, y esa parte no se construyó aquí a
 * propósito: ver la nota en `puerto.ts`.
 *
 * -----------------------------------------------------------------------------
 * ZONA HORARIA
 * -----------------------------------------------------------------------------
 * Todo opera sobre fechas CIVILES 'YYYY-MM-DD' del calendario de Santiago, que
 * es exactamente lo que guarda `contexto.restriccion_vehicular.fecha` (`date`).
 * El día de la semana se calcula con `Date.UTC`, que para una fecha civil sin
 * hora es el truco correcto y sin drift — el mismo que ya usa
 * `sumarDiasCalendario` en `src/lib/fecha-santiago.ts`. Nunca `new Date(str)`
 * suelto, nunca `toISOString()` sobre "ahora".
 */

import {
  diferenciaEnDiasCalendario,
  sumarDiasCalendario,
} from '@/lib/fecha-santiago';

/** Tipologías con calendario propio en el Plan Operacional GEC 2026. */
export type TipologiaVehiculo =
  | 'auto_con_sello_verde'
  | 'moto_con_sello_verde'
  | 'auto_sin_sello_verde'
  | 'carga_sin_sello_verde';

/** Cuadro 14 y 15: vehículos CON sello verde antiguos. Dos dígitos por día. */
const DIGITOS_CON_SELLO_VERDE: Readonly<Record<number, readonly number[]>> = {
  1: [8, 9], // lunes
  2: [0, 1], // martes
  3: [2, 3], // miércoles
  4: [4, 5], // jueves
  5: [6, 7], // viernes
};

/** Cuadro 13: vehículos SIN sello verde. Cuatro dígitos por día. */
const DIGITOS_SIN_SELLO_VERDE: Readonly<Record<number, readonly number[]>> = {
  1: [6, 7, 8, 9], // lunes
  2: [0, 1, 2, 3], // martes
  3: [4, 5, 6, 7], // miércoles
  4: [8, 9, 0, 1], // jueves
  5: [2, 3, 4, 5], // viernes
};

const ALCANCE_PROVINCIA =
  'Provincia de Santiago, San Bernardo y Puente Alto';
const ALCANCE_ANILLO = 'Interior del anillo Américo Vespucio';

/** Ventana de la temporada GEC, en mes/día del calendario de Santiago. */
export const TEMPORADA_GEC = {
  inicioMes: 5,
  inicioDia: 1,
  finMes: 8,
  finDia: 31,
} as const;

export interface RestriccionPorTipologia {
  tipologia: TipologiaVehiculo;
  digitos: number[];
  /** Hora local de Santiago 'HH:MM'. */
  desde: string;
  hasta: string;
  alcance: string;
  /** A qué vehículos aplica, en lenguaje del decreto. */
  aplicaA: string;
}

/**
 * Resultado del cálculo. Calza con `contexto.restriccion_vehicular`:
 *   fecha    → fecha    date
 *   tipo     → tipo     contexto.tipo_restriccion ('permanente')
 *   digitos  → digitos  integer[]
 *   alcance  → alcance  text
 *
 * `digitos` toma el calendario de 2 dígitos (con sello verde), que es el que
 * §4 documenta y el que muestra el contrato congelado
 * (`RESTRICCIONES[0].digitos = [6, 7]`). El desglose completo va en
 * `detallePorTipologia`, que la tabla no guarda: si algún día hace falta
 * persistirlo, es una columna nueva.
 *
 * `vehiculosAfectados` es SIEMPRE `null` y no es un olvido: el modelo de datos
 * no guarda patentes de la flota (§10 del diseño y el COMMENT de la tabla), así
 * que no hay nada que contar. Cuando exista la entidad vehículo (F3), ese conteo
 * será POR TENANT y no puede vivir en una tabla global.
 */
export interface RestriccionPermanenteCalculada {
  fecha: string;
  tipo: 'permanente';
  digitos: number[];
  alcance: string;
  vehiculosAfectados: null;
  detallePorTipologia: RestriccionPorTipologia[];
  /**
   * `false` cuando no se entregó el conjunto de feriados: el resultado puede
   * estar sobre-declarando un día que en realidad es feriado. El llamador debe
   * propagar esa incertidumbre, no esconderla.
   */
  feriadosConsiderados: boolean;
}

function validarFechaCivil(fecha: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new RangeError(`fecha inválida: "${fecha}". Formato esperado: YYYY-MM-DD`);
  }
}

/**
 * Día de la semana de una fecha civil: 0 domingo … 6 sábado.
 * `Date.UTC` sobre una fecha sin hora — sin drift de zona horaria.
 */
export function diaDeLaSemana(fecha: string): number {
  validarFechaCivil(fecha);
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

/**
 * ¿La fecha cae dentro de la temporada GEC (1 de mayo – 31 de agosto)?
 * Fuera de ella no hay restricción permanente, por más que sea un martes.
 */
export function estaEnTemporadaGEC(fecha: string): boolean {
  validarFechaCivil(fecha);
  const [, mes, dia] = fecha.split('-').map(Number);
  const despuesDelInicio =
    mes > TEMPORADA_GEC.inicioMes ||
    (mes === TEMPORADA_GEC.inicioMes && dia >= TEMPORADA_GEC.inicioDia);
  const antesDelFin =
    mes < TEMPORADA_GEC.finMes ||
    (mes === TEMPORADA_GEC.finMes && dia <= TEMPORADA_GEC.finDia);
  return despuesDelInicio && antesDelFin;
}

/**
 * Calcula la restricción permanente para una fecha del calendario de Santiago.
 *
 * Devuelve `null` —que significa "hoy no restringe"— cuando:
 *   · la fecha cae fuera de la temporada GEC (1 may – 31 ago), o
 *   · es sábado o domingo, o
 *   · es feriado (solo si se entregó `feriados`).
 *
 * @param feriados Conjunto de fechas 'YYYY-MM-DD' feriadas. Sale del puerto de
 *   calendario. Si se omite, el cálculo ignora los feriados y lo declara en
 *   `feriadosConsiderados: false` — vale más un dato marcado como incompleto que
 *   uno que se presenta como certero y no lo es.
 */
export function calcularRestriccionPermanente(
  fecha: string,
  opciones: { feriados?: ReadonlySet<string> } = {},
): RestriccionPermanenteCalculada | null {
  validarFechaCivil(fecha);

  if (!estaEnTemporadaGEC(fecha)) return null;

  const dia = diaDeLaSemana(fecha);
  if (dia === 0 || dia === 6) return null;

  const feriadosConsiderados = opciones.feriados !== undefined;
  if (feriadosConsiderados && opciones.feriados!.has(fecha)) return null;

  const conSelloVerde = [...DIGITOS_CON_SELLO_VERDE[dia]];
  const sinSelloVerde = [...DIGITOS_SIN_SELLO_VERDE[dia]];

  return {
    fecha,
    tipo: 'permanente',
    digitos: conSelloVerde,
    alcance: ALCANCE_PROVINCIA,
    vehiculosAfectados: null,
    feriadosConsiderados,
    detallePorTipologia: [
      {
        tipologia: 'auto_con_sello_verde',
        digitos: conSelloVerde,
        desde: '07:30',
        hasta: '21:00',
        alcance: ALCANCE_PROVINCIA,
        aplicaA:
          'Automóviles, station wagons y similares con sello verde inscritos antes del 1 de septiembre de 2011',
      },
      {
        tipologia: 'moto_con_sello_verde',
        digitos: conSelloVerde,
        desde: '07:30',
        hasta: '21:00',
        alcance: ALCANCE_PROVINCIA,
        aplicaA:
          'Motocicletas y similares inscritas antes del 1 de septiembre de 2010',
      },
      {
        tipologia: 'auto_sin_sello_verde',
        digitos: sinSelloVerde,
        desde: '07:30',
        hasta: '21:00',
        alcance: `${ALCANCE_PROVINCIA} (fuera del anillo Américo Vespucio; dentro del anillo la prohibición es total, sin importar el dígito)`,
        aplicaA:
          'Automóviles, station wagons y similares sin sello verde, y motocicletas anteriores a 2002',
      },
      {
        tipologia: 'carga_sin_sello_verde',
        digitos: sinSelloVerde,
        desde: '10:00',
        hasta: '18:00',
        alcance: ALCANCE_ANILLO,
        aplicaA: 'Vehículos de transporte de carga sin sello verde',
      },
    ],
  };
}

/**
 * Calcula la restricción para un rango de fechas civiles consecutivas.
 * Los días sin restricción simplemente no aparecen — es lo que espera
 * `contexto.restriccion_vehicular`, cuyo PK es `(fecha, tipo)`: una fila solo
 * existe si ese día restringe.
 */
export function calcularRestriccionesEnRango(
  desde: string,
  hasta: string,
  opciones: { feriados?: ReadonlySet<string> } = {},
): RestriccionPermanenteCalculada[] {
  validarFechaCivil(desde);
  validarFechaCivil(hasta);

  // Aritmética de fecha CIVIL con los helpers del repo — nada de iterar
  // milisegundos ni de `toISOString()` sobre "ahora".
  const dias = diferenciaEnDiasCalendario(desde, hasta);
  if (dias < 0) return [];

  const salida: RestriccionPermanenteCalculada[] = [];
  for (let d = 0; d <= dias; d += 1) {
    const r = calcularRestriccionPermanente(sumarDiasCalendario(desde, d), opciones);
    if (r) salida.push(r);
  }
  return salida;
}
