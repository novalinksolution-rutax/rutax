/**
 * Tipos del puerto de CALIDAD DEL AIRE.
 * =====================================================================
 *
 * ESPEJO CON LA BD: `PronosticoHoraAire` calza con `contexto.aire_horario`:
 *
 *   comuna        → comuna          text
 *   hora          → hora            timestamptz   ← instante ABSOLUTO
 *   pm25          → pm25            numeric(6,2)
 *   pm10          → pm10            numeric(6,2)
 *   nivelEstimado → nivel_estimado  contexto.nivel_aire  NOT NULL
 *
 * `media24hPm25` NO tiene columna: es el insumo del que sale `nivelEstimado` y
 * se expone para que el job/composer pueda explicarlo ("¿por qué preemergencia
 * si el PM2.5 de esa hora era 90?"). Si más adelante se quiere persistir, es una
 * columna nueva, no un cambio de este contrato.
 *
 * RELACIÓN CON EL CONTRATO CONGELADO (`docs/torre-de-control/datos-dummy.ts`):
 * el tipo `PronosticoAire` de la UI —`{ fecha, pm25Maximo, nivel, esProyeccion }`—
 * es una AGREGACIÓN POR DÍA que el composer deriva de estas filas, tal como
 * anticipa el COMMENT de la tabla en la migración: máximo de `pm25` y máximo de
 * `nivelEstimado` (con `nivelMasSevero`) sobre las horas de una misma fecha de
 * Santiago. Este puerto no la calcula: no le corresponde decidir el corte de día.
 */

import type { ComunaRM } from '@/lib/ui/comunas-rm';

/**
 * Nivel de episodio. Espeja el enum `contexto.nivel_aire` y el tipo `NivelAire`
 * del contrato congelado — los cinco valores, en ese orden de severidad.
 */
export type NivelAire = 'bueno' | 'regular' | 'alerta' | 'preemergencia' | 'emergencia';

export type ProveedorAire = 'open-meteo' | 'stub';

/** Una hora de pronóstico de aire para una comuna. */
export interface PronosticoHoraAire {
  comuna: ComunaRM;
  /** Instante absoluto (timestamptz). */
  hora: Date;
  /** PM2.5 de esa hora, µg/m³. `null` si el modelo no lo entrega. */
  pm25: number | null;
  /** PM10 de esa hora, µg/m³. */
  pm10: number | null;
  /**
   * Promedio móvil de PM2.5 de las últimas 24 h terminando en `hora`. Es el
   * estadístico que la norma usa para definir episodios — ver `niveles.ts`.
   * `null` si no hubo ningún dato en la ventana.
   */
  media24hPm25: number | null;
  /**
   * Nivel ESTIMADO a partir de `media24hPm25`. No es un decreto: la declaración
   * de episodio es un acto de la Delegación Presidencial.
   */
  nivelEstimado: NivelAire;
  /**
   * `false` solo cuando la hora es pasado observado (`past_days`); `true` cuando
   * es pronóstico. Alimenta `PronosticoAire.esProyeccion` del contrato.
   */
  esProyeccion: boolean;
}

export interface ParametrosAire {
  /** Por defecto, las 52 comunas de la RM. */
  comunas?: readonly ComunaRM[];
  /**
   * Días de pronóstico. Por defecto 3 (las 72 h que §4 documenta para esta
   * fuente). Open-Meteo Air Quality admite 0–7.
   */
  dias?: number;
}

export interface PronosticoAireHorario {
  proveedor: ProveedorAire;
  /** Filas listas para upsert en `contexto.aire_horario`. */
  horas: PronosticoHoraAire[];
  comunasResueltas: ComunaRM[];
}
