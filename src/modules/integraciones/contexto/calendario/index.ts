/**
 * Superficie pública del puerto de CALENDARIO / RESTRICCIÓN.
 * =====================================================================
 *
 * Exporta dos cosas de naturaleza distinta y conviene tenerlo claro:
 *   · el PUERTO de feriados, que habla con una API externa y puede degradar;
 *   · el CÁLCULO de restricción vehicular, que es una función pura, siempre
 *     disponible, sin red y sin modo degradado posible. Por eso no está detrás
 *     del puerto ni tiene stub: no hay nada que simular en una función que ya es
 *     determinística.
 */

export { obtenerPuertoCalendario } from './puerto';
export type { PuertoCalendario } from './puerto';

export type {
  CalendarioFeriados,
  Feriado,
  ParametrosCalendario,
  ProveedorCalendario,
} from './tipos';

export { anioActualEnSantiago } from './anio';

export {
  calcularRestriccionPermanente,
  calcularRestriccionesEnRango,
  diaDeLaSemana,
  estaEnTemporadaGEC,
  TEMPORADA_GEC,
} from './restriccion-gec';
export type {
  RestriccionPermanenteCalculada,
  RestriccionPorTipologia,
  TipologiaVehiculo,
} from './restriccion-gec';
