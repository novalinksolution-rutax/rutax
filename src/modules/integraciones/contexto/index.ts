/**
 * Puerto de contexto de la Torre de control.
 * =====================================================================
 *
 * Queda **uno solo**, siguiendo el patrón vigente del repo
 * (`integraciones/geocoding`): interfaz + tipos + adaptador real + adaptador
 * stub, y una fábrica que elige por variable de entorno.
 *
 *   contexto/calendario  → api.boostr.cl + cálculo GEC  (CONTEXTO_CALENDARIO_PROVIDER)
 *
 * Degrada y no revienta: `obtener*` devuelve `ResultadoContexto`, que sabe decir
 * "no pude" sin lanzar.
 *
 * -----------------------------------------------------------------------------
 * LOS PUERTOS DE CLIMA Y AIRE SE RETIRARON (2026-08-03)
 * -----------------------------------------------------------------------------
 * No se ocultaron: se apagaron. El rediseño v2 de la Torre sacó el clima y el
 * aire del producto entero —eran factores de un puntaje de riesgo que también se
 * retiró— y con ellos cayeron los adaptadores de OpenWeather, la grilla de 14
 * puntos de la RM y la atribución en pantalla. La decisión y su motivo están en
 * `docs/torre-de-control/alcance-v2.md` §3: el clima se ve desde el teléfono del
 * conductor y en terreno, no desde una consola.
 *
 * *Memoria útil por si el tema vuelve:* Open-Meteo se había descartado antes
 * porque su tier libre prohíbe el uso comercial y define como comercial «apps con
 * suscripciones» — exactamente lo que es Rutax.
 *
 * ESTE ARCHIVO NO CONTIENE JOBS NI CRONES.
 *
 * Lo que NO se construyó acá, con su razón, para que no se busque en vano:
 *   · `contexto/transito` (TomTom) — de pago, y el conductor ya ve la congestión
 *     en Waze.
 *   · `contexto/eventos` y `contexto/noticias` — pipeline de prensa muerto: Google
 *     News RSS prohíbe uso comercial, GDELT no cubre Chile y SENAPRED solo publica
 *     desastres naturales.
 *   · La restricción vehicular EXTRAORDINARIA por episodio — ver la nota larga en
 *     `calendario/puerto.ts`: los dígitos son "aleatorios" fijados por decreto, no
 *     derivables de ningún feed.
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
