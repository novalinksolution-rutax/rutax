/**
 * Tipos del puerto de CLIMA.
 * =====================================================================
 *
 * El núcleo (`operacion`, `dinero`) no importa nada de aquí. Estos tipos son el
 * contrato del puerto y la forma normalizada que todo adaptador (stub / real)
 * devuelve — el job de A4 nunca ve la respuesta cruda del proveedor.
 *
 * ESPEJO CON LA BD: `PronosticoHoraComuna` calza campo a campo con
 * `contexto.clima_horario` (migración 20260725000001):
 *
 *   comuna              → comuna              text
 *   hora                → hora                timestamptz   ← instante ABSOLUTO
 *   precipitacionMm     → precipitacion_mm    numeric(6,2)
 *   probPrecipitacion   → prob_precipitacion  smallint 0–100
 *   vientoKmh           → viento_kmh          numeric(6,2)
 *   tempC               → temp_c              numeric(5,2)
 *
 * `hora` es un `Date` (instante), NO una fecha civil. La conversión desde la
 * hora local naive de Open-Meteo la hace el adaptador con
 * `combinarFechaHoraSantiago` — ver el encabezado de `../open-meteo-comun.ts`.
 *
 * RELACIÓN CON EL CONTRATO CONGELADO (`docs/torre-de-control/datos-dummy.ts`):
 * el tipo `CeldaClima` (círculo con `intensidadMmHora`, `ventana` y
 * `zonasAfectadas`) NO lo produce este puerto: es una AGREGACIÓN visual que el
 * composer arma cruzando estas filas con las zonas del tenant. El puerto entrega
 * el insumo — precipitación por comuna y hora—; quién dibuja el círculo es
 * decisión del composer, que es el único que conoce las zonas del courier.
 */

import type { ComunaRM } from '@/lib/ui/comunas-rm';

/** Proveedor que produjo el pronóstico. */
export type ProveedorClima = 'openweather' | 'stub';

/** Una hora de pronóstico para una comuna. Una fila de `contexto.clima_horario`. */
export interface PronosticoHoraComuna {
  comuna: ComunaRM;
  /** Instante absoluto de la hora pronosticada (timestamptz). */
  hora: Date;
  /** Precipitación acumulada en la hora, en mm. `null` si el modelo no la da. */
  precipitacionMm: number | null;
  /** Probabilidad de precipitación 0–100. */
  probPrecipitacion: number | null;
  /** Viento a 10 m, en km/h. */
  vientoKmh: number | null;
  /** Temperatura a 2 m, en °C. */
  tempC: number | null;
}

/** Insumos de la consulta. */
export interface ParametrosClima {
  /**
   * Comunas a consultar. Por defecto, las 52 de la RM — que es el caso normal
   * del job (`contexto/clima.refrescar`) y el que aprovecha la multicoordenada.
   */
  comunas?: readonly ComunaRM[];
  /**
   * Días de horizonte. Por defecto 3, que cubre Hoy / Mañana / 72 h (§8.1).
   * Open-Meteo admite hasta 16.
   */
  dias?: number;
}

/** Resultado normalizado del puerto. */
export interface PronosticoClima {
  proveedor: ProveedorClima;
  /** Filas listas para upsert en `contexto.clima_horario`, sin agrupar. */
  horas: PronosticoHoraComuna[];
  /** Comunas efectivamente resueltas. Útil para detectar cobertura parcial. */
  comunasResueltas: ComunaRM[];
}
