/**
 * Puertos de CONTEXTO EXTERNO de la Torre de control.
 * =====================================================================
 *
 * Tres puertos aislados, uno por fuente, siguiendo el patrón vigente del repo
 * (`integraciones/geocoding`): interfaz + tipos + adaptador real + adaptador
 * stub, y una fábrica que elige por variable de entorno.
 *
 *   contexto/clima       → Open-Meteo Forecast          (CONTEXTO_CLIMA_PROVIDER)
 *   contexto/aire        → Open-Meteo Air Quality       (CONTEXTO_AIRE_PROVIDER)
 *   contexto/calendario  → api.boostr.cl + cálculo GEC  (CONTEXTO_CALENDARIO_PROVIDER)
 *
 * Los tres degradan y ninguno revienta: `obtener*` devuelve `ResultadoContexto`,
 * que sabe decir "no pude" sin lanzar. El job de A4 traduce ese "no pude" a una
 * fila de `contexto.fuentes_estado` y sigue con las demás capas.
 *
 * ESTE ARCHIVO NO CONTIENE JOBS NI CRONES. Los puertos son invocables; quién los
 * invoca y con qué cadencia es trabajo del paso siguiente (§6 del diseño).
 *
 * Lo que NO se construyó aquí, con su razón, para que no se busque en vano:
 *   · `contexto/transito` (TomTom) — es F2 por decisión de fases.
 *   · `contexto/eventos` y `contexto/noticias` — §13, con su propio pipeline.
 *   · La restricción vehicular EXTRAORDINARIA por episodio — ver la nota larga
 *     en `calendario/puerto.ts`: los dígitos son "aleatorios" fijados por
 *     decreto, no derivables de ningún feed.
 */

// ---- Contrato de degradación, compartido por los tres puertos ---------------
export type {
  ContextoOk,
  ContextoFallo,
  ResultadoContexto,
} from './resultado';
export {
  degradarDesdeError,
  exito,
  fallo,
  MOTIVOS_DEGRADACION,
  sanearParaMensaje,
} from './resultado';

export {
  ErrorContexto,
  ErrorContextoConfig,
  ErrorContextoProveedor,
  ErrorContextoRespuesta,
} from './errores';

// ---- Puertos ----------------------------------------------------------------
export { obtenerPuertoClima } from './clima';
export type {
  PuertoClima,
  ParametrosClima,
  PronosticoClima,
  PronosticoHoraComuna,
} from './clima';

export { obtenerPuertoAire, nivelMasSevero, UMBRALES_PM25 } from './aire';
export type {
  PuertoAire,
  ParametrosAire,
  PronosticoAireHorario,
  PronosticoHoraAire,
  NivelAire,
} from './aire';

export {
  obtenerPuertoCalendario,
  calcularRestriccionPermanente,
  calcularRestriccionesEnRango,
  estaEnTemporadaGEC,
} from './calendario';
export type {
  PuertoCalendario,
  ParametrosCalendario,
  CalendarioFeriados,
  Feriado,
  RestriccionPermanenteCalculada,
} from './calendario';
