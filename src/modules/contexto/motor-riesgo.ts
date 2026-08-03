/**
 * Motor de riesgo de la Torre de control — función pura, determinística y
 * explicable (§7 de `docs/arquitectura/torre-de-control.md`).
 * =====================================================================
 *
 * Misma disciplina que `src/modules/dinero/motor.ts`: SIN BD, SIN Inngest, SIN
 * `Date.now()`/`new Date()` interno. Todo lo que varía con el reloj (fecha,
 * hora "ahora") entra por parámetro, calculado por el llamador con
 * `src/lib/fecha-santiago.ts`. Eso es lo que permite testear cada franja, cada
 * nivel y el caso de las 22:00 sin mocks ni infraestructura — y es lo que hace
 * el motor auditable: mismo input, mismo output, siempre.
 *
 * -----------------------------------------------------------------------------
 * REDISTRIBUCIÓN DE LOS PESOS SIN FUENTE (TRÁNSITO 15 % + EVENTOS 10 %)
 * -----------------------------------------------------------------------------
 * §7 fija seis factores cuyos pesos suman 1 (35/20/15/15/10/5). Dos de ellos no
 * tienen fuente y no la van a tener:
 *
 *   - **Tránsito** requiere TomTom, que es de pago y quedó FUERA DE ALCANCE: el
 *     conductor ya ve la congestión en Waze mejor que nosotros, y el
 *     coordinador no puede accionar sobre ella.
 *   - **Eventos de ciudad** dependía del pipeline de señales de prensa (§13),
 *     que está parado. `contexto.eventos_ciudad` no la escribe ningún job.
 *
 * Un factor sin fuente conserva su peso pero aporta SIEMPRE valor 0, y eso no
 * es neutro: arrastra el puntaje hacia abajo. Con eventos en 11,76 % efectivo,
 * una zona que debía leerse "medio" se mostraba "bajo" — la Torre decía que
 * había menos riesgo del que había. Por eso los dos van a peso 0 explícito.
 *
 * Se redistribuye PROPORCIONALMENTE entre los cuatro factores restantes: cada
 * peso nominal se divide por (1 − 0.15 − 0.10) = 0.75. Cada factor activo
 * conserva la MISMA importancia relativa que tenía en el diseño original
 * (presión operativa sigue pesando 2.33× lo que aire, igual que 35/15) — no se
 * privilegia ni se penaliza a ninguno. Las alternativas descartadas:
 *   - Repartir los 25 puntos en partes iguales: rompería la jerarquía que §7
 *     estableció a propósito (presión y clima dejarían de dominar).
 *   - Dárselo todo a "histórico propio": inflaría un factor que hoy vale 0 por
 *     falta de historia.
 *   - Dárselo todo a "presión operativa": pasaría a pesar ~47 % y cambiaría el
 *     carácter del modelo sin que el diseño lo pida.
 *
 * Resultado (exacto, en fracciones de /75 para que la suma dé 1 sin arrastre de
 * redondeo): presión 35/75 ≈ 0.4667 · clima 20/75 ≈ 0.2667 · aire 15/75 = 0.20
 * · histórico 5/75 ≈ 0.0667 · tránsito 0 · eventos 0.
 *
 * `desglose.factores` SIEMPRE incluye la fila de `transito` y la de `eventos`,
 * con `peso: 0` y `valor: 0` — nunca con su peso nominal. Es la forma honesta
 * de cumplir "que el desglose lo refleje con honestidad": 0 es exactamente lo
 * que aportaron al puntaje. Ocultarlas también sería razonable, pero mostrarlas
 * en 0 dice explícitamente "este factor existe, hoy no cuenta, y por qué" —
 * más informativo para el coordinador que un factor que simplemente no aparece.
 *
 * -----------------------------------------------------------------------------
 * COLAPSO POR FRANJA — MÁXIMO, NO PROMEDIO
 * -----------------------------------------------------------------------------
 * `calcularRiesgoZona` calcula el puntaje de UNA franja (mañana/tarde/punta)
 * de UNA zona. `colapsarRiesgoPorFranjas` reduce las (hasta) tres franjas de un
 * día al `Zona.riesgo` único que ve el coordinador: el MÁXIMO, nunca el
 * promedio (§7: "el riesgo es el peor momento de la ventana"). El
 * `desglose.factores` que queda es el de la franja que ganó, no un promedio de
 * las tres — mostrar un nivel 1 de 81 con un nivel 2 que suma 54 es
 * exactamente el tipo de inconsistencia que hace que el coordinador deje de
 * confiar en el módulo.
 *
 * Para horizonte 'hoy', las franjas cuya ventana YA TERMINÓ (respecto de
 * `ahora`) se descartan antes de tomar el máximo: una mala mañana que ya pasó
 * es historia, no riesgo. A las 22:00 de Santiago las tres franjas del día ya
 * terminaron (punta cierra a las 21:00) — el resultado es, a propósito, calmo/
 * 0/sin franja dominante: no hay nada que anticipar de un día que ya pasó.
 */

import type { NivelAire } from '@/modules/integraciones/contexto/aire/tipos';
import type { Franja, FactorRiesgo, FactorRiesgoId, HorizonteRiesgo, NivelRiesgo } from './tipos';
import { FRANJAS } from './tipos';

// =============================================================================
// Utilidades puras internas
// =============================================================================

function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

function redondear1Decimal(valor: number): number {
  return Math.round(valor * 10) / 10;
}

// =============================================================================
// Pesos — nominales (§7) y efectivamente usados en F1 (redistribuidos)
// =============================================================================

/** Pesos NOMINALES de §7. Suman 1. Referencia, no lo que se usa en F1. */
export const PESOS_NOMINALES: Readonly<Record<FactorRiesgoId, number>> = {
  presion_operativa: 0.35,
  clima: 0.20,
  aire: 0.15,
  transito: 0.15,
  eventos: 0.10,
  historico: 0.05,
};

/**
 * Factores SIN FUENTE, cuyo peso no se aplica y se redistribuye.
 *
 * `transito` está fuera de alcance (TomTom es de pago) y `eventos` se quedó sin
 * fuente al parar el pipeline de señales: `contexto.eventos_ciudad` no la
 * escribe ningún job. Si alguno recupera fuente, se saca de esta lista y la
 * renormalización se ajusta sola.
 */
const FACTORES_SIN_FUENTE = ['transito', 'eventos'] as const satisfies readonly FactorRiesgoId[];

const PESO_SIN_FUENTE = FACTORES_SIN_FUENTE.reduce(
  (suma, id) => suma + PESOS_NOMINALES[id],
  0,
);
const FACTOR_RENORMALIZACION = 1 / (1 - PESO_SIN_FUENTE);

/**
 * Pesos EFECTIVAMENTE usados por `calcularRiesgoZona` en F1: los cuatro activos
 * renormalizados (ver cabecera del archivo) + tránsito y eventos en 0.
 * Exportado para que los tests puedan verificar la suma y para que el composer
 * explique la redistribución sin duplicar el cálculo.
 */
export const PESOS_EFECTIVOS_F1: Readonly<Record<FactorRiesgoId, number>> = {
  presion_operativa: PESOS_NOMINALES.presion_operativa * FACTOR_RENORMALIZACION,
  clima: PESOS_NOMINALES.clima * FACTOR_RENORMALIZACION,
  aire: PESOS_NOMINALES.aire * FACTOR_RENORMALIZACION,
  historico: PESOS_NOMINALES.historico * FACTOR_RENORMALIZACION,
  transito: 0,
  eventos: 0,
};

// =============================================================================
// Niveles de riesgo — bordes de §7
// =============================================================================

/** calmo 0–20 · bajo 21–40 · medio 41–60 · alto 61–75 · crítico 76–100. */
export function nivelDesdePuntaje(puntaje: number): NivelRiesgo {
  if (puntaje <= 20) return 'calmo';
  if (puntaje <= 40) return 'bajo';
  if (puntaje <= 60) return 'medio';
  if (puntaje <= 75) return 'alto';
  return 'critico';
}

// =============================================================================
// Factor 1 · Presión operativa (35 % nominal → ~41.18 % efectivo)
// =============================================================================

export interface EntradaPresionOperativa {
  /** Pedidos en estados no terminales, dentro de la ventana evaluada. */
  pedidosPendientes: number;
  /** Conductores disponibles de la zona × su capacidad de paradas. */
  capacidadEstimada: number;
  /**
   * Minutos que faltan para la ventana de corte de la zona, relativos al
   * "ahora" del llamador. Negativo = el corte ya venció. `null` = sin ventana
   * de corte conocida para la zona/horizonte (p. ej. horizontes futuros, donde
   * "minutos hasta el corte" no es una noción con sentido — el corte es de
   * HOY, no de un día futuro).
   */
  minutosHastaCorte: number | null;
}

/** A partir de aquí la urgencia del corte empieza a sumar puntaje. */
const UMBRAL_URGENCIA_CORTE_MINUTOS = 240;

export function calcularFactorPresionOperativa(entrada: EntradaPresionOperativa): FactorRiesgo {
  const pedidos = Math.max(0, Math.round(entrada.pedidosPendientes));
  const capacidad = Math.max(0, entrada.capacidadEstimada);

  // Sin capacidad configurada (cero conductores disponibles) con pedidos
  // pendientes es el caso más grave posible: se satura el ratio en vez de
  // dividir por cero (que en JS da Infinity y rompería el clamp más abajo).
  const ratio = capacidad > 0 ? pedidos / capacidad : pedidos > 0 ? 2 : 0;

  const valorBase = clamp(Math.round(ratio * 60), 0, 100);

  let bonusUrgencia = 0;
  let notaUrgencia = '';
  const minutos = entrada.minutosHastaCorte;
  if (minutos !== null) {
    if (minutos <= 0) {
      bonusUrgencia = 25;
      notaUrgencia = ' La ventana de corte ya venció.';
    } else if (minutos < 60) {
      bonusUrgencia = 15;
      notaUrgencia = ` Quedan ${minutos} min para el corte.`;
    } else if (minutos < UMBRAL_URGENCIA_CORTE_MINUTOS) {
      bonusUrgencia = 8;
      notaUrgencia = ` Quedan ${redondear1Decimal(minutos / 60)} h para el corte.`;
    }
  }

  const valor = clamp(valorBase + bonusUrgencia, 0, 100);

  return {
    id: 'presion_operativa',
    etiqueta: 'Presión operativa',
    valor,
    peso: PESOS_EFECTIVOS_F1.presion_operativa,
    explicacion: `${pedidos} pedidos pendientes contra capacidad de ${capacidad}.${notaUrgencia}`,
  };
}

// =============================================================================
// Factor 2 · Clima (20 % nominal → ~23.53 % efectivo)
// =============================================================================

export interface EntradaClima {
  /** Peor precipitación (mm/h) pronosticada DENTRO de la ventana de reparto. */
  precipitacionMaximaMmHora: number;
  /** Peor viento (km/h) pronosticado dentro de la misma ventana. */
  vientoMaximoKmh: number | null;
  /** 'HH:MM' locales de Santiago — solo para la explicación en prosa. */
  ventanaInicioLocal: string;
  ventanaFinLocal: string;
}

const UMBRAL_VIENTO_ALTO_KMH = 60;
const UMBRAL_VIENTO_MODERADO_KMH = 40;

export function calcularFactorClima(entrada: EntradaClima): FactorRiesgo {
  const precipitacion = Math.max(0, entrada.precipitacionMaximaMmHora);
  const viento = entrada.vientoMaximoKmh ?? 0;

  const valorLluvia = clamp(Math.round(precipitacion * 11), 0, 100);
  const valorViento =
    viento >= UMBRAL_VIENTO_ALTO_KMH ? 20 : viento >= UMBRAL_VIENTO_MODERADO_KMH ? 10 : 0;
  const valor = clamp(valorLluvia + valorViento, 0, 100);

  let explicacion: string;
  if (precipitacion > 0) {
    explicacion =
      `Lluvia de ${redondear1Decimal(precipitacion)} mm/h entre ${entrada.ventanaInicioLocal} y ` +
      `${entrada.ventanaFinLocal}, dentro de la ventana de reparto.`;
  } else if (valorViento > 0) {
    explicacion =
      `Viento de ${redondear1Decimal(viento)} km/h entre ${entrada.ventanaInicioLocal} y ` +
      `${entrada.ventanaFinLocal}, dentro de la ventana de reparto.`;
  } else {
    explicacion = 'Sin precipitación ni viento relevante pronosticados en la ventana de reparto.';
  }

  return { id: 'clima', etiqueta: 'Clima', valor, peso: PESOS_EFECTIVOS_F1.clima, explicacion };
}

// =============================================================================
// Factor 3 · Aire y restricción (15 % nominal → ~17.65 % efectivo)
// =============================================================================

/**
 * El nivel YA CLASIFICADO (bueno/regular/alerta/preemergencia/emergencia) para
 * la ventana evaluada — el más severo entre las horas que caen dentro de ella
 * (`nivelMasSevero`, `@/modules/integraciones/contexto/aire/niveles`). El
 * motor NO reclasifica desde PM2.5 crudo: la clasificación normativa chilena
 * (Cuadro 1 del Plan Operacional GEC) vive en una sola fuente de verdad
 * (`aire/niveles.ts`) y el motor la reutiliza en vez de duplicarla.
 */
export interface EntradaAire {
  /** 'bueno' si no hay episodio o si la fuente está degradada (sin dato). */
  nivelPeorEnVentana: NivelAire;
  /** ¿Hay restricción vehicular (permanente o extraordinaria) vigente hoy? */
  restriccionVigenteHoy: boolean;
}

const VALOR_BASE_POR_NIVEL_AIRE: Readonly<Record<NivelAire, number>> = {
  bueno: 8,
  regular: 30,
  alerta: 55,
  preemergencia: 80,
  emergencia: 100,
};

const BONUS_RESTRICCION_VIGENTE = 15;

const TEXTO_NIVEL_AIRE: Readonly<Record<NivelAire, string>> = {
  bueno: 'bueno',
  regular: 'regular',
  alerta: 'de alerta',
  preemergencia: 'de preemergencia',
  emergencia: 'de emergencia',
};

export function calcularFactorAire(entrada: EntradaAire): FactorRiesgo {
  const valorNivel = VALOR_BASE_POR_NIVEL_AIRE[entrada.nivelPeorEnVentana];
  const valor = clamp(
    valorNivel + (entrada.restriccionVigenteHoy ? BONUS_RESTRICCION_VIGENTE : 0),
    0,
    100,
  );

  const notaRestriccion = entrada.restriccionVigenteHoy
    ? ' Restricción vehicular vigente hoy.'
    : ' Sin restricción extraordinaria vigente.';

  return {
    id: 'aire',
    etiqueta: 'Aire y restricción',
    valor,
    peso: PESOS_EFECTIVOS_F1.aire,
    explicacion: `PM2.5 en rango ${TEXTO_NIVEL_AIRE[entrada.nivelPeorEnVentana]}.${notaRestriccion}`,
  };
}

// =============================================================================
// Factor 4 · Tránsito — F2, no computado. Peso 0 REAL (ver cabecera).
// =============================================================================

export function calcularFactorTransitoPendiente(): FactorRiesgo {
  return {
    id: 'transito',
    etiqueta: 'Tránsito',
    valor: 0,
    peso: PESOS_EFECTIVOS_F1.transito,
    explicacion:
      'Tránsito es F2 (requiere TomTom, aún no integrado): su peso nominal de 15 % se ' +
      'redistribuyó proporcionalmente entre los otros cinco factores. Este factor no aporta ' +
      'puntaje todavía.',
  };
}

// =============================================================================
// Factor 5 · Eventos (10 % nominal → ~11.76 % efectivo)
// =============================================================================

export interface EventoEnVentana {
  nombre: string;
  /** `null` si la fuente no estimó asistencia. */
  asistenciaEstimada: number | null;
}

export interface EntradaEventos {
  /**
   * Eventos cuyo radio de influencia intersecta la zona Y cuya ventana se
   * solapa con la ventana de reparto evaluada. El filtro geográfico/temporal
   * lo hace el llamador (composer/job) — el motor solo pondera lo que ya
   * calificó como relevante.
   */
  eventos: readonly EventoEnVentana[];
}

const UMBRAL_ASISTENCIA_ALTA = 30_000;
const UMBRAL_ASISTENCIA_MEDIA = 10_000;
/** Tope del bonus por múltiples eventos simultáneos en la misma ventana. */
const BONUS_MULTIPLE_EVENTOS_TOPE = 10;

export function calcularFactorEventos(entrada: EntradaEventos): FactorRiesgo {
  const eventos = entrada.eventos;

  if (eventos.length === 0) {
    return {
      id: 'eventos',
      etiqueta: 'Eventos',
      valor: 0,
      peso: PESOS_EFECTIVOS_F1.eventos,
      explicacion: 'Sin eventos relevantes en la ventana de reparto.',
    };
  }

  const principal = eventos.reduce((mayor, actual) =>
    (actual.asistenciaEstimada ?? 0) > (mayor.asistenciaEstimada ?? 0) ? actual : mayor,
  );
  const asistencia = principal.asistenciaEstimada;

  let valorBase: number;
  if (asistencia === null) {
    valorBase = 25;
  } else if (asistencia >= UMBRAL_ASISTENCIA_ALTA) {
    valorBase = 80;
  } else if (asistencia >= UMBRAL_ASISTENCIA_MEDIA) {
    valorBase = 55;
  } else {
    valorBase = 35;
  }

  const bonusMultiple =
    eventos.length > 1 ? Math.min(BONUS_MULTIPLE_EVENTOS_TOPE, (eventos.length - 1) * 5) : 0;
  const valor = clamp(valorBase + bonusMultiple, 0, 100);

  const explicacion =
    asistencia !== null
      ? `${principal.nombre}, con asistencia estimada de ${Math.round(asistencia)}, dentro de la ventana de reparto.`
      : `${principal.nombre}, dentro de la ventana de reparto.`;

  return { id: 'eventos', etiqueta: 'Eventos', valor, peso: PESOS_EFECTIVOS_F1.eventos, explicacion };
}

// =============================================================================
// Factor 6 · Histórico propio (5 % nominal → ~5.88 % efectivo)
// =============================================================================

export interface EntradaHistorico {
  /** `null` o `<= 0` = sin historia suficiente (siempre, mientras no exista F3). */
  tasaFallidosPct: number | null;
}

/** Escala la tasa de fallidos (%) a un valor 0–100. Ver nota de calibración abajo. */
const MULTIPLICADOR_TASA_FALLIDOS = 4;

export function calcularFactorHistorico(entrada: EntradaHistorico): FactorRiesgo {
  const tasa = entrada.tasaFallidosPct;

  if (tasa === null || tasa <= 0) {
    return {
      id: 'historico',
      etiqueta: 'Histórico propio',
      valor: 0,
      peso: PESOS_EFECTIVOS_F1.historico,
      explicacion:
        'Sin historia suficiente todavía: el histórico propio no aporta información (F3, §12.5).',
    };
  }

  const valor = clamp(Math.round(tasa * MULTIPLICADOR_TASA_FALLIDOS), 0, 100);
  return {
    id: 'historico',
    etiqueta: 'Histórico propio',
    valor,
    peso: PESOS_EFECTIVOS_F1.historico,
    explicacion: `Tasa de fallidos histórica de ${redondear1Decimal(tasa)}% en condiciones similares.`,
  };
}

// =============================================================================
// calcularRiesgoZona — combina los seis factores de UNA zona + UNA franja
// =============================================================================

export interface EntradaRiesgoZona {
  presionOperativa: EntradaPresionOperativa;
  clima: EntradaClima;
  aire: EntradaAire;
  eventos: EntradaEventos;
  historico: EntradaHistorico;
}

export interface DesgloseRiesgo {
  /** Orden fijo: presion_operativa, clima, aire, transito, eventos, historico. */
  factores: FactorRiesgo[];
}

export interface ResultadoRiesgoZona {
  /** 0–100, entero. Suma ponderada de los seis factores. */
  puntaje: number;
  nivel: NivelRiesgo;
  desglose: DesgloseRiesgo;
}

/**
 * Calcula el riesgo de UNA zona en UNA franja horaria. Función pura: mismo
 * input, mismo output. No decide franja ni colapsa entre franjas — eso es
 * `colapsarRiesgoPorFranjas`, más abajo.
 */
export function calcularRiesgoZona(entrada: EntradaRiesgoZona): ResultadoRiesgoZona {
  const presion = calcularFactorPresionOperativa(entrada.presionOperativa);
  const clima = calcularFactorClima(entrada.clima);
  const aire = calcularFactorAire(entrada.aire);
  const transito = calcularFactorTransitoPendiente();
  const eventos = calcularFactorEventos(entrada.eventos);
  const historico = calcularFactorHistorico(entrada.historico);

  const factores: FactorRiesgo[] = [presion, clima, aire, transito, eventos, historico];

  // Guard de honestidad: si algún día se agrega/quita un factor sin ajustar
  // los pesos, esto avisa en tests/desarrollo en vez de fallar en silencio en
  // producción con un puntaje que ya no representa lo que el diseño pactó.
  const sumaPesos = factores.reduce((acc, f) => acc + f.peso, 0);
  if (Math.abs(sumaPesos - 1) > 0.001) {
    throw new Error(
      `calcularRiesgoZona: los pesos de los factores deben sumar 1 (suman ${sumaPesos}).`,
    );
  }

  const puntajeCrudo = factores.reduce((acc, f) => acc + f.valor * f.peso, 0);
  const puntaje = clamp(Math.round(puntajeCrudo), 0, 100);

  return { puntaje, nivel: nivelDesdePuntaje(puntaje), desglose: { factores } };
}

// =============================================================================
// colapsarRiesgoPorFranjas — MÁXIMO entre franjas, con descarte de vencidas
// =============================================================================

/** Fin de cada franja en minutos desde medianoche, hora local Santiago. */
const FIN_FRANJA_MINUTOS: Readonly<Record<Franja, number>> = {
  manana: 12 * 60,
  tarde: 17 * 60,
  punta: 21 * 60,
};

/**
 * El "ahora" de Santiago, ya descompuesto — lo arma el llamador con
 * `ahoraEnSantiago()` + `horaAMinutos()` de `src/lib/fecha-santiago.ts`. El
 * motor nunca llama a `Date.now()` por su cuenta.
 */
export interface AhoraSantiago {
  /** 'YYYY-MM-DD' — el día de "ahora" en Santiago. */
  fecha: string;
  /** Minutos desde medianoche, hora local Santiago. */
  horaMinutos: number;
}

export interface DesgloseZonaColapsado extends DesgloseRiesgo {
  /** La franja cuyo desglose quedó en `factores`. `null` si no quedó ninguna. */
  franjaDominante: Franja | null;
}

export interface ResultadoRiesgoZonaColapsado {
  puntaje: number;
  nivel: NivelRiesgo;
  desglose: DesgloseZonaColapsado;
}

/**
 * Colapsa los resultados (hasta 3, uno por franja) de UN día de UNA zona al
 * puntaje único que ve el coordinador: el MÁXIMO, nunca el promedio.
 *
 * PRECONDICIÓN: cuando `horizonte === 'hoy'`, `porFranja` debe ser el día de
 * `opciones.ahora.fecha` (el llamador nunca pide horizonte 'hoy' para otro
 * día) — esta función no vuelve a validar la fecha, solo filtra por hora.
 * Para 'manana' y '72h' no se filtra por hora: el día completo es futuro, así
 * que ninguna franja "ya terminó" en el sentido de §7.
 */
export function colapsarRiesgoPorFranjas(
  porFranja: Partial<Record<Franja, ResultadoRiesgoZona>>,
  opciones: { horizonte: HorizonteRiesgo; ahora: AhoraSantiago },
): ResultadoRiesgoZonaColapsado {
  const franjasConsideradas = FRANJAS.filter((franja) => {
    if (opciones.horizonte !== 'hoy') return true;
    return opciones.ahora.horaMinutos < FIN_FRANJA_MINUTOS[franja];
  });

  let mejorPuntaje = -1;
  let mejorResultado: ResultadoRiesgoZona | null = null;
  let mejorFranja: Franja | null = null;

  for (const franja of franjasConsideradas) {
    const resultado = porFranja[franja];
    if (!resultado) continue;
    if (resultado.puntaje > mejorPuntaje) {
      mejorPuntaje = resultado.puntaje;
      mejorResultado = resultado;
      mejorFranja = franja;
    }
  }

  if (!mejorResultado || mejorFranja === null) {
    // Nada que anticipar: o no llegó ningún resultado, o (horizonte 'hoy' a
    // las 22:00+) las tres franjas del día ya terminaron.
    return {
      puntaje: 0,
      nivel: 'calmo',
      desglose: { factores: [], franjaDominante: null },
    };
  }

  return {
    puntaje: mejorResultado.puntaje,
    nivel: mejorResultado.nivel,
    desglose: { factores: mejorResultado.desglose.factores, franjaDominante: mejorFranja },
  };
}
