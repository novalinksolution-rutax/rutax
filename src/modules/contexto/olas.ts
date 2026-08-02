/**
 * Proyección de la ola entrante — el calendario comercial (§12).
 * =====================================================================
 *
 * Puro: sin BD, sin reloj propio. Todo llega por parámetro, incluido «hoy».
 *
 * -----------------------------------------------------------------------------
 * LA IDEA, QUE ES LO QUE HAY QUE ENTENDER ANTES DE TOCAR NADA
 * -----------------------------------------------------------------------------
 * **Un courier no entrega el día del CyberDay: entrega la ola que ese CyberDay
 * generó.** Marcar la fecha en un calendario no sirve de nada. Lo que da valor es
 * modelar el desfase entre la venta y la entrega, y ahí hay dos arquetipos con
 * comportamiento OPUESTO:
 *
 *   · **venta** (CyberDay, Black Friday, fechas dobles): la compra ocurre en una
 *     ventana corta y las entregas llegan DESPUÉS, D+1 a D+5. Lo que el
 *     coordinador necesita saber es cuántos conductores le van a faltar.
 *   · **regalo** (Día del Niño, Fiestas Patrias, Navidad): el regalo tiene que
 *     llegar ANTES y el plazo es duro. Lo que necesita saber es hasta cuándo
 *     puede comprar el cliente final para que llegue a tiempo — un dato que hoy
 *     nadie le da al seller.
 *
 * -----------------------------------------------------------------------------
 * LA FÓRMULA, Y POR QUÉ NO ES LITERALMENTE LA DEL DOCUMENTO
 * -----------------------------------------------------------------------------
 * §12.3 la escribe así:
 *
 *     proyectado(día) = base(día_semana) × multiplicador × curva_rezago(offset)
 *
 * Tomada al pie de la letra **da menos volumen que un día normal**: con CyberDay
 * (multiplicador 2,4) el día peak de la curva (0,30) daría 0,72 × base. El
 * producto de los tres factores no cierra dimensionalmente porque la curva de
 * rezago SUMA 1 — es un reparto, no un factor.
 *
 * Lo que sí cierra, y es lo que hace este módulo:
 *
 *     extra_total   = base_diario × (multiplicador − 1) × días_del_evento
 *     proyectado(d) = base(día_semana(d)) + extra_total × curva_rezago(offset(d))
 *
 * Se lee entero: un evento de tres días con multiplicador 2,4 genera tres días
 * de demanda extra (1,4 × base cada uno), y esa demanda extra se reparte entre
 * los días de entrega según la curva. Con multiplicador 1 no hay extra, que es
 * la degradación correcta.
 *
 * ⚠️ **Las cifras del dummy congelado NO se reproducen con esto, y está bien.**
 * El dummy es contrato de TIPOS, no de valores; sus 402/448/512/604 no salen de
 * ninguna fórmula publicada. Intentar calzarlos habría significado elegir la
 * fórmula por su resultado en un dataset de ejemplo.
 *
 * -----------------------------------------------------------------------------
 * LO QUE NO SE INVENTA
 * -----------------------------------------------------------------------------
 * · **La capacidad es la misma todos los días.** Un courier tiene menos flota el
 *   domingo, pero eso no se puede saber: la dotación futura no está en ninguna
 *   tabla. Se usa la capacidad instalada de hoy, igual para todos los días, y se
 *   dice aquí. Suponer una curva de fin de semana sería inventar la mitad del
 *   diagnóstico de brecha.
 * · **`hecho` no existe como estado de hito.** Marcar un hito como cumplido
 *   exige que alguien lo marque, y no hay dónde guardarlo todavía. Los hitos solo
 *   distinguen vencido de pendiente.
 * · **`fuenteProyeccion` es siempre `'catalogo'`.** El ajuste con el histórico
 *   del propio courier (§12.5, `contexto.olas_historicas`) es F3.
 */

import {
  combinarFechaHoraSantiago,
  diferenciaEnDiasCalendario,
  sumarDiasCalendario,
} from '@/lib/fecha-santiago';
import type {
  ArquetipoOla,
  HitoPreparacion,
  OlaEntrante,
  PuntoCurva,
} from './contrato-torre';

// =============================================================================
// Entradas
// =============================================================================

/** Fila de `contexto.eventos_comerciales`, ya en camelCase. */
export interface EventoComercialCatalogo {
  id: string;
  nombre: string;
  arquetipo: ArquetipoOla;
  organizador: string | null;
  /** Fecha civil `YYYY-MM-DD`. */
  inicio: string;
  fin: string;
  multiplicadorBase: number;
  /** Clave = offset en días respecto del INICIO del evento; valor = proporción. */
  curvaRezago: Record<string, number>;
}

/**
 * Volumen base por día de semana, `0` = domingo … `6` = sábado. Es la media
 * histórica del courier, no un supuesto: la calcula el composer sobre los
 * pedidos ya cerrados.
 */
export type VolumenBasePorDiaSemana = Readonly<Record<number, number>>;

export interface EntradaProyeccion {
  evento: EventoComercialCatalogo;
  volumenBase: VolumenBasePorDiaSemana;
  /** Capacidad instalada en paradas/día. Constante — ver encabezado. */
  capacidadDiaria: number;
  /** Paradas que cubre un conductor. Sirve para traducir la brecha a personas. */
  capacidadPorConductor: number;
  /** Fecha civil de hoy en Santiago. */
  hoy: string;
  /**
   * Días de holgura entre la compra y la entrega, por zona. Solo se usa en el
   * arquetipo `regalo`, para la fecha límite de compra. Sale del propio
   * histórico del courier; una zona sin historia no aparece en el resultado.
   */
  plazoPorZona?: ReadonlyMap<string, number>;
}

// =============================================================================
// Selección del evento
// =============================================================================

/** Cuántos días antes de un evento empieza a tener sentido mostrarlo. */
export const HORIZONTE_OLA_DIAS = 45;

/**
 * El evento que la Torre debe mostrar: el más próximo cuya ventana de entregas
 * todavía no terminó, dentro del horizonte.
 *
 * Se mira la VENTANA DE ENTREGAS, no la fecha del evento, y esa distinción es el
 * módulo entero: el 26 de diciembre Navidad ya pasó, pero el 10 de junio el
 * CyberDay del 1–3 sigue siendo la ola que el courier está entregando.
 */
export function proximaOla(
  eventos: readonly EventoComercialCatalogo[],
  hoy: string,
  horizonteDias = HORIZONTE_OLA_DIAS,
): EventoComercialCatalogo | null {
  const candidatos = eventos
    .map((evento) => ({ evento, ventana: ventanaDeEntregas(evento) }))
    .filter(({ evento, ventana }) => {
      if (ventana.fin < hoy) return false; // la ola ya se entregó entera
      return diferenciaEnDiasCalendario(hoy, evento.inicio) <= horizonteDias;
    })
    .sort((a, b) => a.ventana.inicio.localeCompare(b.ventana.inicio));

  return candidatos[0]?.evento ?? null;
}

/** Primer y último día de entrega, derivados de los offsets de la curva. */
export function ventanaDeEntregas(evento: EventoComercialCatalogo): {
  inicio: string;
  fin: string;
} {
  const offsets = offsetsOrdenados(evento);
  if (offsets.length === 0) {
    // Sin curva no hay ola que repartir: la ventana es el evento mismo.
    return { inicio: evento.inicio, fin: evento.fin };
  }
  return {
    inicio: sumarDiasCalendario(evento.inicio, offsets[0]),
    fin: sumarDiasCalendario(evento.inicio, offsets[offsets.length - 1]),
  };
}

function offsetsOrdenados(evento: EventoComercialCatalogo): number[] {
  return Object.keys(evento.curvaRezago)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

// =============================================================================
// Proyección
// =============================================================================

const DIAS_HITO = [21, 14, 7, 3] as const;

const TITULO_HITO: Readonly<Record<number, string>> = {
  21: 'Confirmar sellers participantes',
  14: 'Reforzar flota para el peak',
  7: 'Validar tarifas y ventanas de corte',
  3: 'Congelar cambios de configuración',
};

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES_CORTOS = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/** Día de la semana de una fecha civil, sin pasar por husos horarios. */
export function diaSemanaDeFecha(fecha: string): number {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

function etiquetaDia(fecha: string): string {
  const [, mes, dia] = fecha.split('-').map(Number);
  return `${DIAS_CORTOS[diaSemanaDeFecha(fecha)]} ${dia}`;
}

/**
 * ISO de medianoche y de fin de día en hora de Santiago, para los campos
 * `Ventana`.
 *
 * Antes esto pegaba el offset `-04:00` CLAVADO, que es el de invierno: en
 * verano Santiago es −03:00 y la ventana quedaba una hora corrida. Se coló
 * porque el guard de fechas de este módulo sólo buscaba el sufijo `Z` y no los
 * offsets numéricos — ese hueco ya está tapado.
 */
function ventanaDeDias(desde: string, hasta: string) {
  return {
    inicio: combinarFechaHoraSantiago(desde, '00:00:00').toISOString(),
    fin: combinarFechaHoraSantiago(hasta, '23:59:00').toISOString(),
  };
}

/**
 * Proyecta la ola. Devuelve `null` si no hay con qué proyectar — sin volumen
 * base histórico la curva sería una fila de ceros con pinta de dato.
 */
export function proyectarOla(entrada: EntradaProyeccion): OlaEntrante | null {
  const { evento, volumenBase, capacidadDiaria, capacidadPorConductor, hoy } = entrada;

  const baseDiaria = promedioBase(volumenBase);
  if (baseDiaria <= 0) return null;

  const offsets = offsetsOrdenados(evento);
  if (offsets.length === 0) return null;

  const diasEvento = Math.max(1, diferenciaEnDiasCalendario(evento.inicio, evento.fin) + 1);
  const extraTotal = baseDiaria * Math.max(0, evento.multiplicadorBase - 1) * diasEvento;

  const curva: PuntoCurva[] = offsets.map((offset) => {
    const fecha = sumarDiasCalendario(evento.inicio, offset);
    const base = Math.round(volumenBase[diaSemanaDeFecha(fecha)] ?? baseDiaria);
    const proyectado = Math.round(base + extraTotal * (evento.curvaRezago[String(offset)] ?? 0));
    return {
      fecha,
      etiquetaDia: etiquetaDia(fecha),
      offsetDias: offset,
      pedidosProyectados: proyectado,
      pedidosBase: base,
      capacidadEstimada: capacidadDiaria,
      esPeak: false,
    };
  });

  // El peak se marca DESPUÉS de construir la curva y sobre el proyectado, no
  // sobre la proporción de la curva: dos días con la misma proporción pueden
  // tener bases distintas (un sábado no es un miércoles).
  const maximo = Math.max(...curva.map((p) => p.pedidosProyectados));
  for (const punto of curva) punto.esPeak = punto.pedidosProyectados === maximo;

  // El día CRÍTICO no es el de mayor volumen: es el de mayor BRECHA contra la
  // capacidad. Un peak que cabe en la flota no es un problema; un día mediano
  // sin conductores, sí.
  const critico = curva.reduce((peor, punto) =>
    punto.pedidosProyectados - punto.capacidadEstimada >
    peor.pedidosProyectados - peor.capacidadEstimada
      ? punto
      : peor,
  );
  const faltante = critico.pedidosProyectados - critico.capacidadEstimada;
  const brechaConductores =
    capacidadPorConductor > 0 && faltante > 0
      ? -Math.ceil(faltante / capacidadPorConductor)
      : 0;

  const sumaBase = curva.reduce((s, p) => s + p.pedidosBase, 0);
  const sumaProyectada = curva.reduce((s, p) => s + p.pedidosProyectados, 0);
  const variacionEsperadaPct =
    sumaBase > 0 ? Math.round(((sumaProyectada - sumaBase) / sumaBase) * 100) : 0;

  const entregas = ventanaDeEntregas(evento);

  return {
    id: evento.id,
    nombre: evento.nombre,
    arquetipo: evento.arquetipo,
    organizador: evento.organizador,
    fechaEvento: ventanaDeDias(evento.inicio, evento.fin),
    diasParaEvento: diferenciaEnDiasCalendario(hoy, evento.inicio),
    ventanaEntregas: ventanaDeDias(entregas.inicio, entregas.fin),
    variacionEsperadaPct,
    curva,
    diaCritico: critico.fecha,
    brechaConductores,
    fechaLimiteCompraPorZona:
      evento.arquetipo === 'regalo'
        ? fechasLimiteDeCompra(evento, entrada.plazoPorZona)
        : null,
    hitos: hitosDePreparacion(evento.inicio, hoy),
    fuenteProyeccion: 'catalogo',
  };
}

/** Media del volumen base sobre los días de semana que tienen dato. */
function promedioBase(volumenBase: VolumenBasePorDiaSemana): number {
  const valores = Object.values(volumenBase).filter((v) => Number.isFinite(v) && v > 0);
  if (valores.length === 0) return 0;
  return valores.reduce((s, v) => s + v, 0) / valores.length;
}

/**
 * Hasta cuándo puede comprar el cliente final para que le llegue a tiempo.
 *
 * `fecha del evento − 1 día` (tiene que estar EN LA CASA la víspera, no el día
 * mismo) menos el plazo real de la zona. Sin plazo medido la zona no aparece:
 * prometer una fecha límite calculada sobre un supuesto es exactamente el tipo
 * de dato que hace que un seller pierda una venta.
 */
export function fechasLimiteDeCompra(
  evento: EventoComercialCatalogo,
  plazoPorZona?: ReadonlyMap<string, number>,
): { zonaId: string; fecha: string }[] | null {
  if (!plazoPorZona || plazoPorZona.size === 0) return null;

  const vispera = sumarDiasCalendario(evento.inicio, -1);
  return [...plazoPorZona.entries()]
    .map(([zonaId, plazo]) => ({
      zonaId,
      fecha: sumarDiasCalendario(vispera, -Math.max(0, Math.round(plazo))),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.zonaId.localeCompare(b.zonaId));
}

/** Los cuatro hitos de preparación, con su cuenta regresiva ya resuelta. */
export function hitosDePreparacion(fechaEvento: string, hoy: string): HitoPreparacion[] {
  return DIAS_HITO.map((tMenos) => {
    const fechaLimite = sumarDiasCalendario(fechaEvento, -tMenos);
    return {
      id: `h-${tMenos}`,
      tMenosDias: tMenos,
      fechaLimite,
      titulo: TITULO_HITO[tMenos],
      // Solo vencido/pendiente: nadie puede marcar «hecho» todavía.
      estado: fechaLimite < hoy ? ('vencido' as const) : ('pendiente' as const),
    };
  });
}

/** Formato corto de fecha para copys. Expuesto porque lo usa el riel móvil. */
export function fechaCortaDeCivil(fecha: string): string {
  const [, mes, dia] = fecha.split('-').map(Number);
  return `${dia} ${MESES_CORTOS[mes - 1]}`;
}

// =============================================================================
// Línea base del courier — lo que hace que la proyección sea SUYA
// =============================================================================

/**
 * Volumen base por día de semana a partir de las fechas de compromiso de los
 * pedidos históricos.
 *
 * Se promedia **por día de semana y no en general** porque el negocio no es
 * plano: un sábado no mueve lo que un miércoles, y proyectar una ola sobre una
 * media global le atribuiría al evento la variación que solo era el calendario.
 *
 * El promedio se toma sobre los DÍAS con actividad, no sobre las semanas del
 * rango: si el courier no operó tres domingos, esos días no arrastran la media
 * del domingo hacia cero.
 */
export function volumenBasePorDiaSemana(
  fechasDeCompromiso: readonly string[],
): VolumenBasePorDiaSemana {
  const pedidosPorFecha = new Map<string, number>();
  for (const fecha of fechasDeCompromiso) {
    if (!fecha) continue;
    pedidosPorFecha.set(fecha, (pedidosPorFecha.get(fecha) ?? 0) + 1);
  }

  const acumulado = new Map<number, { total: number; dias: number }>();
  for (const [fecha, cantidad] of pedidosPorFecha) {
    const dia = diaSemanaDeFecha(fecha);
    const actual = acumulado.get(dia) ?? { total: 0, dias: 0 };
    actual.total += cantidad;
    actual.dias += 1;
    acumulado.set(dia, actual);
  }

  const base: Record<number, number> = {};
  for (const [dia, { total, dias }] of acumulado) base[dia] = total / dias;
  return base;
}

/** Pedido cerrado, con lo mínimo para medir su plazo. */
export interface PedidoConPlazo {
  comuna: string;
  /** Instante de ingreso del pedido (timestamptz). */
  creadoEn: string;
  /** Fecha civil comprometida. */
  fechaCompromiso: string;
}

/**
 * Plazo MEDIANO de entrega por zona, en días.
 *
 * Mediana y no promedio: un pedido con fecha de compromiso a tres semanas —un
 * reagendado, una preventa— arrastra la media y adelantaría la fecha límite de
 * compra de toda la zona. La mediana lo ignora, que es lo que corresponde con una
 * cola larga.
 *
 * La fecha de creación se lee en calendario de SANTIAGO, no del instante UTC: un
 * pedido ingresado a las 21:30 de un martes es de ese martes, no del miércoles.
 */
export function plazoMedianoPorZona(
  pedidos: readonly PedidoConPlazo[],
  comunaAZona: ReadonlyMap<string, string>,
  normalizar: (comuna: string) => string,
  fechaLocal: (instante: Date) => string,
): Map<string, number> {
  const plazosPorZona = new Map<string, number[]>();

  for (const pedido of pedidos) {
    const zonaId = comunaAZona.get(normalizar(pedido.comuna));
    if (!zonaId || !pedido.fechaCompromiso) continue;

    const creado = new Date(pedido.creadoEn);
    if (Number.isNaN(creado.getTime())) continue;

    const dias = diferenciaEnDiasCalendario(fechaLocal(creado), pedido.fechaCompromiso);
    // Un plazo negativo es un pedido cargado después de su propia fecha de
    // compromiso (una regularización): no dice nada del tiempo de entrega.
    if (dias < 0) continue;

    const lista = plazosPorZona.get(zonaId);
    if (lista) lista.push(dias);
    else plazosPorZona.set(zonaId, [dias]);
  }

  const medianas = new Map<string, number>();
  for (const [zonaId, plazos] of plazosPorZona) {
    plazos.sort((a, b) => a - b);
    const medio = Math.floor(plazos.length / 2);
    medianas.set(
      zonaId,
      plazos.length % 2 === 0 ? (plazos[medio - 1] + plazos[medio]) / 2 : plazos[medio],
    );
  }
  return medianas;
}
