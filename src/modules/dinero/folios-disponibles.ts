import { UMBRAL_FOLIOS } from './folios';

/**
 * El conteo canónico de folios disponibles de un CAF.
 *
 * POR QUÉ EXISTE
 * ---------------------------------------------------------------------------
 * El mismo número se calculaba de **tres formas distintas** en tres pantallas, y
 * dos de ellas estaban mal:
 *
 * · La **verificación previa** lo hacía bien: inclusivo y filtrando por tipo de
 *   documento.
 * · El **dashboard** contaba `folio_hasta − folio_actual`, **sin el `+1`**, y
 *   además leía «un CAF vigente cualquiera» sin filtrar el tipo. O sea: podía
 *   decir «agotado» quedando un folio usable, y podía estar alertando sobre el
 *   CAF de notas de crédito mientras el de facturas estaba lleno.
 * · El **panel de onboarding** muestra folios *usados*, no disponibles, con otro
 *   umbral (85 % del rango) — es otra pregunta y está bien que difiera, pero no
 *   compartía nada con las otras dos.
 *
 * POR QUÉ INCLUSIVO
 * ---------------------------------------------------------------------------
 * `folio_actual` es el **próximo folio a consumir**, todavía no gastado. Cuando
 * `folio_actual === folio_hasta` queda exactamente **uno** utilizable, y es el
 * que `reservarFolio` sí entrega — su guarda es `folioActual > folioHasta`, no
 * `>=`. Contar exclusivo bloquea un folio antes de que esté agotado: la pantalla
 * diría «sube un CAF nuevo» mientras la emisión real todavía habría pasado.
 */

export interface RangoCaf {
  folio_actual: number;
  folio_hasta: number;
}

/** Cuántos folios quedan de verdad. Inclusivo, nunca negativo. */
export function contarFoliosDisponibles(caf: RangoCaf): number {
  return Math.max(0, Number(caf.folio_hasta) - Number(caf.folio_actual) + 1);
}

export type NivelFolios = 'normal' | 'pocos' | 'agotados';

/**
 * Los tres estados del `indicador de folio disponible`.
 *
 * El umbral es `UMBRAL_FOLIOS` (50), el mismo que usa la verificación previa
 * para advertir y el que dispara el correo de «folios por agotarse». Un tercer
 * número aquí volvería a partir la verdad en tres.
 */
export function nivelFolios(restantes: number): NivelFolios {
  if (restantes <= 0) return 'agotados';
  if (restantes < UMBRAL_FOLIOS) return 'pocos';
  return 'normal';
}
