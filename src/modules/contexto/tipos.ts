/**
 * Tipos compartidos del módulo `contexto` (Torre de control).
 * =====================================================================
 *
 * Estos tipos son el vocabulario común entre el motor de riesgo
 * (`motor-riesgo.ts`), los jobs (`jobs/`) y — más adelante — el composer que
 * arma `EstadoTorre` para la pantalla. Mantenerlos aquí (y no repetidos en cada
 * archivo) es lo que permite que `motor-riesgo.ts` no dependa de nada más que
 * de sí mismo: sigue siendo una función pura, sin BD, sin Inngest.
 *
 * Relación con el contrato congelado (`docs/torre-de-control/datos-dummy.ts`):
 * `FactorRiesgo` y `NivelRiesgo` calzan campo a campo con los tipos del mismo
 * nombre en el contrato — es intencional, para que el futuro composer no tenga
 * que traducir entre dos formas distintas. No se importa el contrato
 * directamente (vive en `docs/`, no es código de producción): se mirror aquí.
 */

/**
 * Franja horaria del motor de riesgo, hora LOCAL de Santiago. Enum cerrado —
 * espeja `contexto.franja` de la migración 20260725000001: manana (08–12) ·
 * tarde (12–17) · punta (17–21). Tres filas por zona por día, no una grilla
 * horaria.
 */
export type Franja = 'manana' | 'tarde' | 'punta';

/** Las tres franjas, en orden cronológico del día. */
export const FRANJAS: readonly Franja[] = ['manana', 'tarde', 'punta'];

/**
 * Horizonte temporal que gobierna el recálculo de riesgo. Subconjunto del
 * `Horizonte` del contrato congelado (ese además incluye `'olas'`, que no es
 * un horizonte del motor de riesgo — es la proyección de volumen del
 * calendario comercial, §12, con su propio mecanismo).
 */
export type HorizonteRiesgo = 'hoy' | 'manana' | '72h';

/**
 * Nivel de riesgo derivado del puntaje 0–100. Bordes de §7:
 * calmo 0–20 · bajo 21–40 · medio 41–60 · alto 61–75 · crítico 76–100.
 */
export type NivelRiesgo = 'calmo' | 'bajo' | 'medio' | 'alto' | 'critico';

/** Identificador estable de cada uno de los seis factores de §7. */
export type FactorRiesgoId =
  | 'presion_operativa'
  | 'clima'
  | 'aire'
  | 'transito'
  | 'eventos'
  | 'historico';

/**
 * Un factor del puntaje de riesgo, con su aporte explicado. Calza con
 * `FactorRiesgo` del contrato congelado. `peso` es el peso EFECTIVAMENTE
 * usado (ya redistribuido en F1 — ver `motor-riesgo.ts`), nunca el nominal de
 * §7 si ese no es el que se aplicó: la UI muestra "peso X%" literal por
 * factor, y mostrar un peso que no se usó sería mentirle al coordinador.
 */
export interface FactorRiesgo {
  id: FactorRiesgoId;
  etiqueta: string;
  /** 0–100. Qué tan malo está este factor. */
  valor: number;
  /** 0–1. Peso efectivamente usado en la suma ponderada. */
  peso: number;
  /** Frase corta, en prosa, que un coordinador puede leer sin traducir números. */
  explicacion: string;
}
