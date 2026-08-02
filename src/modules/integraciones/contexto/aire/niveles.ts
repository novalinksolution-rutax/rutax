/**
 * Mapeo PM2.5 → nivel de episodio crítico. LÓGICA DE DOMINIO CHILENO.
 * =====================================================================
 *
 * Esto NO lo entrega la API: Open-Meteo devuelve µg/m³ y nada más. La
 * clasificación es normativa chilena y un umbral mal puesto tiene consecuencias
 * asimétricas — de más, convierte la alerta de preemergencia en ruido que el
 * coordinador aprende a ignorar; de menos, la silencia el día que importa.
 *
 * -----------------------------------------------------------------------------
 * FUENTE DE LOS CORTES (verificada 2026-07-26, documento primario)
 * -----------------------------------------------------------------------------
 * "Plan Operacional para la Gestión de Episodios Críticos de contaminación
 * atmosférica en la Región Metropolitana, año 2026" (SEREMI del Medio Ambiente
 * RM / MMA), §C.1 "Niveles que determinan episodios críticos de contaminación
 * para material particulado", Cuadro 1. PDF oficial:
 *   airerm.mma.gob.cl/wp-content/uploads/2026/04/01.-Plan-Operacional-GEC-2026_vf.pdf
 *
 * Cita literal del Cuadro 1 — MP2,5 (µg/m³) en 24 horas:
 *     Alerta            80 - 109
 *     Preemergencia    110 - 169
 *     Emergencia       170 o superior
 *
 * El mismo documento precisa el estadístico y esto es LO MÁS IMPORTANTE DE ESTE
 * ARCHIVO: *"el valor calculado como PROMEDIO MÓVIL DE 24 HORAS se encuentre en
 * el respectivo rango"*. Los niveles NO se comparan contra la concentración
 * horaria. Comparar la hora suelta contra 80 produciría preemergencias
 * fantasma casi todas las noches de invierno: en la medición real de Santiago
 * del 2026-07-26 la primera hora ya venía en 97,3 µg/m³ mientras el promedio
 * móvil de 24 h estaba muy por debajo del umbral de emergencia. Por eso
 * `clasificarSerie()` calcula la media móvil antes de clasificar, y el adaptador
 * pide 24 h de historia (`past_days=1`) para que la primera hora pronosticada ya
 * tenga ventana completa.
 *
 * Los rangos los establece el D.S. N° 12/2011 del MMA (norma primaria de calidad
 * ambiental para MP2,5), citado por el propio Plan Operacional.
 *
 * -----------------------------------------------------------------------------
 * LOS DOS CORTES QUE **NO** SON NORMA DE EPISODIOS ('bueno' y 'regular')
 * -----------------------------------------------------------------------------
 * El enum del contrato (`NivelAire`, y el enum `contexto.nivel_aire` de la BD)
 * tiene cinco valores, pero el MMA solo define TRES niveles de episodio. Debajo
 * de 80 µg/m³ no hay episodio y la norma no distingue nada.
 *
 * El corte 'bueno' / 'regular' es por tanto una DECISIÓN DE PRODUCTO, y se ancla
 * en el único número oficial que existe en esa franja: la norma primaria diaria
 * de MP2,5 del D.S. N° 12/2011 — **50 µg/m³N como concentración de 24 horas**
 * (y 20 µg/m³N anual). Es decir:
 *     bueno    < 50   → bajo la norma primaria diaria
 *     regular  50–79  → sobre la norma diaria, pero sin episodio declarable
 * Queda dicho explícitamente para que nadie lo lea como si fuera normativo: los
 * cortes 80/110/170 son ley; el corte 50 es criterio, con fuente.
 *
 * -----------------------------------------------------------------------------
 * DOS COSAS QUE HAY QUE REVISAR EN SU MOMENTO (no inventadas: verificadas a
 * medias, y por eso quedan escritas en vez de resueltas)
 * -----------------------------------------------------------------------------
 * 1. En diciembre de 2025 el Consejo de Ministros para la Sustentabilidad
 *    aprobó una NUEVA norma primaria de MP2,5 que reduce los rangos de episodio,
 *    con un período de transición de cinco años desde su publicación. El Plan
 *    Operacional GEC **2026** —publicado en abril de 2026, o sea posterior— sigue
 *    citando el D.S. 12/2011 y el cuadro 80/110/170, así que esos son los
 *    vigentes para esta temporada. Circulan en prensa secundaria los valores
 *    68–97 / 98–157 / ≥158 como los nuevos; NO se pudieron confirmar contra el
 *    decreto publicado y por eso NO se usan. Revisar antes de la temporada 2027.
 * 2. La declaración de un episodio es un ACTO ADMINISTRATIVO de la Delegación
 *    Presidencial, no un cálculo. Lo que produce este archivo es una ESTIMACIÓN
 *    a partir del pronóstico — de ahí el nombre de la columna
 *    (`nivel_estimado`) y el campo `esProyeccion` del contrato. La UI no debe
 *    presentarlo como decreto.
 */

import type { NivelAire } from './tipos';

/**
 * Cortes inferiores de cada nivel, en µg/m³ de PM2.5 como promedio móvil de
 * 24 horas. Un solo lugar que editar si cambia la norma; los tests se apoyan en
 * esta constante para que un cambio de umbral no pase inadvertido.
 */
export const UMBRALES_PM25 = {
  /** D.S. 12/2011, norma primaria diaria de MP2,5. Criterio de producto. */
  regular: 50,
  /** Plan Operacional GEC 2026, Cuadro 1. Normativo. */
  alerta: 80,
  /** Plan Operacional GEC 2026, Cuadro 1. Normativo. */
  preemergencia: 110,
  /** Plan Operacional GEC 2026, Cuadro 1. Normativo. */
  emergencia: 170,
} as const;

/** Horas de la ventana del promedio móvil que exige la norma. */
export const VENTANA_MOVIL_HORAS = 24;

/**
 * Clasifica un valor de PM2.5 **ya expresado como promedio de 24 h**.
 *
 * No acepta una concentración horaria: si le pasas una, el resultado es
 * técnicamente incorrecto aunque el tipo calce. Para una serie horaria usa
 * `clasificarSerie()`, que hace la media móvil primero.
 */
export function nivelDesdePm25Media24h(pm25: number): NivelAire {
  if (!Number.isFinite(pm25) || pm25 < 0) return 'bueno';
  if (pm25 >= UMBRALES_PM25.emergencia) return 'emergencia';
  if (pm25 >= UMBRALES_PM25.preemergencia) return 'preemergencia';
  if (pm25 >= UMBRALES_PM25.alerta) return 'alerta';
  if (pm25 >= UMBRALES_PM25.regular) return 'regular';
  return 'bueno';
}

/**
 * Promedio móvil de las últimas `ventana` horas terminando en cada índice.
 *
 * Los `null` (horas sin dato del modelo) se IGNORAN en vez de contar como cero:
 * un cero falso arrastraría la media hacia abajo y podría silenciar un episodio.
 * Si toda la ventana está vacía, el resultado de esa hora es `null`.
 */
export function promedioMovil(
  serie: ReadonlyArray<number | null>,
  ventana: number = VENTANA_MOVIL_HORAS,
): Array<number | null> {
  if (ventana < 1) throw new RangeError('la ventana debe ser >= 1');

  return serie.map((_, i) => {
    const desde = Math.max(0, i - ventana + 1);
    let suma = 0;
    let n = 0;
    for (let j = desde; j <= i; j += 1) {
      const v = serie[j];
      if (v !== null && Number.isFinite(v)) {
        suma += v;
        n += 1;
      }
    }
    return n === 0 ? null : suma / n;
  });
}

/**
 * Convierte una serie horaria de PM2.5 en la media móvil de 24 h y su nivel.
 *
 * Devuelve un elemento por hora de entrada, en el mismo orden. Cuando no hay
 * ningún dato en la ventana, `media24h` es `null` y el nivel cae a `'bueno'`
 * — la columna `contexto.aire_horario.nivel_estimado` es `not null`, así que
 * hay que elegir algo; se elige el valor que NO gatilla alerta, porque inventar
 * una preemergencia por ausencia de dato sería mentir hacia el lado caro.
 * El `null` en `media24h` es la señal honesta de "no hay dato".
 */
export function clasificarSerie(
  pm25PorHora: ReadonlyArray<number | null>,
  ventana: number = VENTANA_MOVIL_HORAS,
): Array<{ media24h: number | null; nivel: NivelAire }> {
  return promedioMovil(pm25PorHora, ventana).map((media) => ({
    media24h: media,
    nivel: media === null ? 'bueno' : nivelDesdePm25Media24h(media),
  }));
}

/** Orden de severidad, para agregar por día (`max`) en el composer. */
export const ORDEN_NIVEL_AIRE: Record<NivelAire, number> = {
  bueno: 0,
  regular: 1,
  alerta: 2,
  preemergencia: 3,
  emergencia: 4,
};

/** El más severo de dos niveles. Útil al agregar horas → día. */
export function nivelMasSevero(a: NivelAire, b: NivelAire): NivelAire {
  return ORDEN_NIVEL_AIRE[a] >= ORDEN_NIVEL_AIRE[b] ? a : b;
}
