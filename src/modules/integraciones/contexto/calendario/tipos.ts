/**
 * Tipos del puerto de CALENDARIO / RESTRICCIÓN.
 * =====================================================================
 *
 * ESPEJO CON LA BD: `Feriado` calza con `contexto.calendario`:
 *   fecha         → fecha          date     (calendario de Santiago)
 *   nombre        → nombre         text
 *   tipo          → tipo           text     (SIN check: lo fija la fuente)
 *   irrenunciable → irrenunciable  boolean
 *
 * `tipo` es `string` y no una unión cerrada, a propósito y por la misma razón
 * que la columna no tiene CHECK: los valores los pone la fuente (boostr.cl
 * devuelve "Civil" y "Religioso") y el calendario cívico estático del repo
 * agregará los suyos. Una unión de TypeScript aquí obligaría a un cambio de
 * código cada vez que una fuente reetiquete algo.
 *
 * La restricción vive en `restriccion-gec.ts` — es cálculo puro, no consulta.
 */

/** Un feriado o fecha cívica del calendario chileno. */
export interface Feriado {
  /** 'YYYY-MM-DD' en calendario de Santiago. */
  fecha: string;
  nombre: string;
  /** Etiqueta de la fuente ("Civil", "Religioso", …). */
  tipo: string;
  /**
   * Feriado irrenunciable (comercio cerrado). Afecta directamente si se puede
   * repartir, así que no es un adorno: es el dato que hace útil esta fuente
   * para un courier.
   */
  irrenunciable: boolean;
}

export type ProveedorCalendario = 'boostr' | 'stub';

export interface ParametrosCalendario {
  /**
   * Años a consultar. Por defecto, el año en curso EN SANTIAGO (no en UTC: el
   * 31 de diciembre a las 21:00 de Santiago ya es 1 de enero en UTC y traería
   * el calendario del año equivocado).
   */
  anios?: readonly number[];
}

export interface CalendarioFeriados {
  proveedor: ProveedorCalendario;
  feriados: Feriado[];
  /** Años efectivamente resueltos. */
  aniosResueltos: number[];
}
