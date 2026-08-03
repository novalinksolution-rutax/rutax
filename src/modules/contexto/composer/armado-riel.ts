/**
 * Armado del riel: métricas, excepciones, señales y estado de pantalla.
 * =====================================================================
 *
 * Puro. Es la parte del composer que REDACTA, y por eso la que más cuidado
 * pide: una excepción es una frase que un coordinador va a leer a las nueve de
 * la mañana para decidir si mueve conductores. Tres reglas la gobiernan:
 *
 * 1. **Nada que no se pueda sostener con el dato.** El monto se llama
 *    «comprometido», no «pérdida esperada»: es lo expuesto, no una predicción.
 *
 * 2. **Ninguna acción que no haga algo.** La ficha de excepción solo sabe
 *    ejecutar dos cosas de verdad: abrir la lista de pedidos filtrada y revelar
 *    en el sitio por qué la flota expuesta todavía no se puede calcular. Las
 *    acciones con confirmación («adelantar el corte», «reasignar conductores»)
 *    completan el flujo pero NO ejecutan nada contra el backend, así que aquí no
 *    se emiten: un botón que confirma y no hace nada es peor que su ausencia.
 *    Cuando se decida dónde se cablean, se agregan aquí.
 *
 * 3. **Silencio por defecto.** Sin riesgo no se rellena el riel con tarjetas
 *    informativas. Se dice en una línea y la pantalla se calla.
 */

import { sumarDiasCalendario } from '@/lib/fecha-santiago';
import { RANGO_FRANJA } from '../agregacion';
import type { Franja } from '../tipos';
import type {
  AccionSugerida,
  EstadoPantalla,
  Excepcion,
  FrescuraFuente,
  MetricaResumen,
  PronosticoAire,
  Zona,
} from '../contrato-torre';
import { franjaDominanteDesdeDesglose, type RiesgoDeFranja } from './armado-zonas';
import { instanteSantiago } from './armado-mapa';

// =============================================================================
// Formato (no se importa el del cliente: `src/modules` no depende de `src/app`)
// =============================================================================

/** `486200` → `"$486.200"`. Mismo criterio que `clpTorre` de la consola. */
export function clp(valor: number): string {
  return `$${Math.round(valor).toLocaleString('es-CL')}`;
}

function entero(valor: number): string {
  return Math.round(valor).toLocaleString('es-CL');
}

/** Variación porcentual contra una base. `null` cuando no hay con qué comparar. */
export function variacionContra(actual: number, base: number): number | null {
  if (base === 0) return null;
  return Math.round(((actual - base) / base) * 1000) / 10;
}

// =============================================================================
// Métricas
// =============================================================================

/** Minutos de corte bajo los cuales un pendiente se considera sin tiempo. */
export const MINUTOS_SIN_TIEMPO = 60;

export interface EntradaMetricas {
  zonas: readonly Zona[];
  /** Etiqueta de la primera métrica, según el horizonte: «Pedidos hoy», etc. */
  etiquetaPedidos: string;
  totalPedidos: number;
  totalSemanaAnterior: number;
  montoSemanaAnteriorClp: number;
  /** Pendientes con compromiso anterior a hoy: llegaron tarde y siguen abiertos. */
  atrasados: number;
  sinGeocodificar: number;
}

/**
 * Las cuatro métricas del riel.
 *
 * **«SLA en riesgo» se define por lo que el modelo puede sostener.** El dummy lo
 * describía como «pedidos cuyo compromiso vence antes del cierre de la zona»,
 * pero `pedidos.fecha_compromiso` es una FECHA, no un instante: no existe una
 * hora de compromiso que comparar contra el corte. Lo que sí se puede afirmar
 * son dos cosas, y son las que cuenta esta métrica:
 *   · los **atrasados** — pendientes cuyo día de compromiso ya pasó, y
 *   · los **sin tiempo** — pendientes en zonas cuyo corte ya venció o vence
 *     dentro de una hora.
 * El detalle lo dice literal, para que nadie lea otra cosa.
 *
 * Sin un solo pedido en la fecha devuelve `[]`: es el estado `sin_pedidos`, y
 * cuatro ceros con variaciones nulas serían ruido, no información.
 */
export function armarMetricas(entrada: EntradaMetricas): MetricaResumen[] {
  if (entrada.totalPedidos === 0) return [];

  const pendientes = entrada.zonas.reduce((suma, z) => suma + z.pedidosPendientes, 0);
  const entregados = entrada.zonas.reduce((suma, z) => suma + z.pedidosEntregados, 0);
  const monto = entrada.zonas.reduce((suma, z) => suma + z.montoComprometidoClp, 0);

  const sinTiempo = entrada.zonas
    .filter((z) => z.ventanaCorte.minutosRestantes <= MINUTOS_SIN_TIEMPO)
    .reduce((suma, z) => suma + z.pedidosPendientes, 0);
  const slaEnRiesgo = entrada.atrasados + sinTiempo;

  return [
    {
      id: 'pedidos-hoy',
      etiqueta: entrada.etiquetaPedidos,
      valor: entero(entrada.totalPedidos),
      valorCrudo: entrada.totalPedidos,
      variacionPorcentual: variacionContra(entrada.totalPedidos, entrada.totalSemanaAnterior),
      detalle: `${entero(entregados)} entregados · ${entero(pendientes)} pendientes`,
    },
    {
      id: 'monto-comprometido',
      etiqueta: 'Comprometido',
      valor: clp(monto),
      valorCrudo: monto,
      variacionPorcentual: variacionContra(monto, entrada.montoSemanaAnteriorClp),
      detalle: 'Cobro asociado a los pedidos aún no entregados',
    },
    {
      id: 'sla-en-riesgo',
      etiqueta: 'SLA en riesgo',
      valor: entero(slaEnRiesgo),
      valorCrudo: slaEnRiesgo,
      variacionPorcentual: null,
      detalle: 'Pendientes atrasados o en zonas cuyo corte vence dentro de una hora',
    },
    {
      id: 'sin-geocodificar',
      etiqueta: 'Sin ubicar',
      valor: entero(entrada.sinGeocodificar),
      valorCrudo: entrada.sinGeocodificar,
      variacionPorcentual: null,
      detalle: 'No aparecen en el mapa. Requieren revisión de dirección',
    },
  ];
}

// =============================================================================
// Señales de prensa
// =============================================================================

// =============================================================================
// Excepciones
// =============================================================================

/** Puntaje desde el cual una zona genera excepción. Borde de `alto` en §7. */
export const UMBRAL_EXCEPCION = 61;

const TITULO_POR_FACTOR: Readonly<Record<string, (zona: string) => string>> = {
  presion_operativa: (zona) => `${zona} sin holgura`,
  clima: (zona) => `Lluvia sobre ${zona}`,
  aire: (zona) => `Aire cargado sobre ${zona}`,
  transito: (zona) => `Tránsito cargado sobre ${zona}`,
  eventos: (zona) => `Evento masivo sobre ${zona}`,
  historico: (zona) => `${zona} con historial de fallidos`,
};

export interface EntradaExcepciones {
  zonas: readonly Zona[];
  /** Filas de riesgo de la fecha, para leer la franja dominante y el instante. */
  riesgo: readonly RiesgoDeFranja[];
  pronosticoAire: readonly PronosticoAire[];
  /** Fecha civil del horizonte. */
  fecha: string;
  /** Instante ISO de «ahora». Se usa como `detectadaEn`. */
  ahoraIso: string;
}

/**
 * Las excepciones del riel, de más grave a menos.
 *
 * Tres orígenes, y ninguno inventa:
 *   · `motor` — una zona que cruzó el umbral de riesgo. El título sale del
 *     factor que más aporta, y el cuerpo de su propia explicación: el mismo
 *     texto que el coordinador verá si abre el desglose de nivel 2. Que
 *     coincidan no es redundancia, es la jerarquía de tres niveles.
 *   · `motor` — un episodio de aire proyectado dentro del horizonte. Va sin
 *     zona: una preemergencia no es de una zona, es de la ciudad.
 *   · `senal` — prensa. Hoy siempre vacío (bloque D pendiente).
 */
export function armarExcepciones(entrada: EntradaExcepciones): Excepcion[] {
  const excepciones: Excepcion[] = [];
  const franjaPorZona = new Map<string, Franja | null>();
  for (const fila of entrada.riesgo) {
    if (!franjaPorZona.has(fila.zonaId)) {
      franjaPorZona.set(fila.zonaId, franjaDominanteDesdeDesglose(fila.desglose));
    }
  }

  for (const zona of entrada.zonas) {
    if (zona.riesgo < UMBRAL_EXCEPCION) continue;

    const dominante = factorDominante(zona);
    const titulo = (TITULO_POR_FACTOR[dominante?.id ?? 'presion_operativa'] ??
      TITULO_POR_FACTOR.presion_operativa)(zona.nombre);

    const holgura = zona.capacidadEstimada - zona.pedidosPendientes;
    const cuerpo = [
      `${entero(zona.pedidosPendientes)} pedidos pendientes contra una capacidad de ${entero(zona.capacidadEstimada)}` +
        (holgura < 0 ? ` (faltan ${entero(-holgura)} paradas).` : '.'),
      `Corte a las ${zona.ventanaCorte.hora}, con ${zona.conductoresDisponibles} de ${zona.conductoresAsignados} conductores disponibles.`,
      dominante?.explicacion ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    const franja = franjaPorZona.get(zona.id) ?? null;
    const acciones: AccionSugerida[] =
      zona.pedidosPendientes > 0
        ? [
            {
              id: `ver-pedidos-${zona.id}`,
              // La etiqueta ES el contrato de comportamiento de la ficha: la
              // reconoce por su forma («Ver los N pedidos») y la convierte en un
              // enlace real a la lista filtrada. Cambiarla la vuelve un botón mudo.
              etiqueta: `Ver los ${entero(zona.pedidosPendientes)} pedidos`,
              descripcion: 'Abre la lista de pedidos de esa fecha.',
            },
          ]
        : [];

    excepciones.push({
      id: `exc-zona-${zona.id}-${entrada.fecha}`,
      severidad: zona.nivel === 'critico' ? 'critica' : 'alta',
      titulo,
      cuerpo,
      zonaId: zona.id,
      ventana: ventanaDeFranja(entrada.fecha, franja),
      pedidosAfectados: zona.pedidosPendientes,
      montoAfectadoClp: zona.montoComprometidoClp,
      acciones,
      origen: 'motor',
      detectadaEn: entrada.ahoraIso,
    });
  }

  const episodio = entrada.pronosticoAire.find(
    (p) => p.fecha >= entrada.fecha && (p.nivel === 'preemergencia' || p.nivel === 'emergencia'),
  );
  if (episodio) {
    const esEmergencia = episodio.nivel === 'emergencia';
    excepciones.push({
      id: `exc-aire-${episodio.fecha}`,
      severidad: esEmergencia ? 'critica' : 'alta',
      titulo: esEmergencia ? 'Emergencia ambiental proyectada' : 'Preemergencia proyectada',
      cuerpo:
        `El PM2.5 proyectado para el ${episodio.fecha} llega a ${episodio.pm25Maximo} µg/m³. ` +
        'Una restricción extraordinaria dejaría fuera del anillo Vespucio a los vehículos sin sello verde.',
      zonaId: null,
      ventana: {
        inicio: instanteSantiago(episodio.fecha, '00:00'),
        fin: instanteSantiago(episodio.fecha, '23:59'),
      },
      // Sin pedidos afectados: el modelo no guarda patentes, así que no se puede
      // saber cuántos vehículos del courier quedan restringidos. Cero es la cifra
      // honesta; la ficha lo muestra como «sin pedidos afectados todavía».
      pedidosAfectados: 0,
      montoAfectadoClp: 0,
      acciones: [
        {
          id: `ver-flota-expuesta-${episodio.fecha}`,
          etiqueta: 'Ver flota expuesta',
          descripcion: 'Lista de conductores cuyo vehículo quedaría restringido.',
        },
      ],
      origen: 'motor',
      detectadaEn: entrada.ahoraIso,
    });
  }

  const ORDEN: Record<Excepcion['severidad'], number> = {
    critica: 0,
    alta: 1,
    media: 2,
    informativa: 3,
  };
  return excepciones.sort(
    (a, b) => ORDEN[a.severidad] - ORDEN[b.severidad] || b.montoAfectadoClp - a.montoAfectadoClp,
  );
}

/** El factor que más aporta al puntaje (valor × peso), no el de mayor valor. */
function factorDominante(zona: Zona): Zona['factores'][number] | null {
  let mejor: Zona['factores'][number] | null = null;
  let mejorAporte = -1;
  for (const factor of zona.factores) {
    const aporte = factor.valor * factor.peso;
    if (aporte > mejorAporte) {
      mejorAporte = aporte;
      mejor = factor;
    }
  }
  return mejorAporte > 0 ? mejor : null;
}

/** Ventana horaria de la franja dominante. Sin franja, la jornada completa. */
function ventanaDeFranja(fecha: string, franja: Franja | null) {
  const rango = franja ? RANGO_FRANJA[franja] : { desde: '08:00', hasta: '21:00' };
  return {
    inicio: instanteSantiago(fecha, rango.desde),
    fin: instanteSantiago(fecha, rango.hasta),
  };
}

// =============================================================================
// Estado de pantalla
// =============================================================================

export interface EntradaEstadoPantalla {
  /** false cuando el courier no configuró zonas y se usa el fallback de la RM. */
  tieneZonasPropias: boolean;
  totalPedidos: number;
  hayExcepciones: boolean;
  frescura: readonly FrescuraFuente[];
}

/**
 * El estado que gobierna qué regiones existen.
 *
 * El orden de precedencia es el del handoff, leído de fuera hacia dentro: qué
 * tan bien está CONFIGURADO el tablero manda sobre qué tan cargado está el día,
 * y eso manda sobre la salud de las fuentes. Un courier sin zonas no necesita
 * enterarse de que el feed de aire está atrasado: necesita configurar sus zonas.
 *
 * `con_excepciones` gana a `degradado` a propósito: si hay algo que atender, la
 * banda no puede ocuparla un aviso de infraestructura. La fuente caída sigue
 * marcada en la barra superior, que es donde vive esa información.
 *
 * `cargando` NO se decide aquí: es la ausencia de datos, y la resuelve el
 * `<Suspense>` de cada región.
 */
export function resolverEstadoPantalla(entrada: EntradaEstadoPantalla): EstadoPantalla {
  if (!entrada.tieneZonasPropias) return 'sin_zonas';
  if (entrada.totalPedidos === 0) return 'sin_pedidos';
  if (entrada.hayExcepciones) return 'con_excepciones';
  if (entrada.frescura.some((f) => f.estado === 'caida')) return 'degradado';
  return 'tranquilo';
}

// =============================================================================
// Etiquetas de horizonte
// =============================================================================

/** Etiqueta de la métrica de volumen según el horizonte que se está mirando. */
export function etiquetaPedidosDeHorizonte(horizonte: 'hoy' | 'manana' | '72h'): string {
  if (horizonte === 'hoy') return 'Pedidos hoy';
  if (horizonte === 'manana') return 'Pedidos mañana';
  return 'Pedidos a 72 h';
}

/** Fecha civil de cada horizonte a partir de la base. */
export function fechaDeHorizonte(fechaBase: string, horizonte: 'hoy' | 'manana' | '72h'): string {
  const offset = horizonte === 'hoy' ? 0 : horizonte === 'manana' ? 1 : 2;
  return sumarDiasCalendario(fechaBase, offset);
}
