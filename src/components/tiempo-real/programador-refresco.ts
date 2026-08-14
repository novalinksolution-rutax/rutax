/**
 * Programador de refrescos EN VIVO — debounce CON TOPE MÁXIMO DE ESPERA.
 * =====================================================================
 * Agrupa una ráfaga de eventos de Realtime en un solo `router.refresh()`, pero
 * **garantiza que el refresco ocurra**, cosa que un debounce puro no hace.
 *
 * EL DEFECTO QUE ESTO ARREGLA (vivo hasta 2026-08-13). El programador anterior
 * vivía inline en `indicador-en-vivo.tsx` y era un debounce puro: cada evento
 * cancelaba el temporizador del anterior y volvía a esperar 800 ms. Con eventos
 * llegando SOSTENIDAMENTE a menos de 800 ms de distancia, el temporizador se
 * reprograma para siempre y **la pantalla no se actualiza nunca**. No es una
 * hipótesis de laboratorio: es exactamente el retiro en bodega de la etapa 5 —
 * diez conductores escaneando en ráfaga, lotes de hasta 50 bultos entrando uno
 * tras otro. La pantalla que existe para mirar eso en vivo era justamente la que
 * se quedaba congelada mientras ocurría.
 *
 * Y falla de la peor manera: el indicador sigue diciendo "En vivo" (el canal
 * está suscrito de verdad, los eventos llegan de verdad), así que el coordinador
 * mira una cifra vieja convencido de que es la de ahora.
 *
 * CÓMO SE ARREGLA. Se conserva el debounce —agrupar la ráfaga es correcto y es
 * lo que evita refrescar 50 veces por lote— y se le pone un techo: desde el
 * PRIMER evento de una ráfaga, el refresco ocurre a más tardar `maxEsperaMs`
 * después, aunque los eventos no paren. El resultado es "agrupa hasta 800 ms de
 * calma, pero nunca se atrasa más de 4 s".
 *
 * POR QUÉ ES UN MÓDULO APARTE Y NO SIGUE INLINE EN EL COMPONENTE. Vitest corre
 * en entorno `node` y solo recoge `src/**´/*.test.ts` (ver `vitest.config.ts`):
 * no hay DOM ni render de React, así que un defecto que viviera dentro del
 * componente **no se puede probar**. Sacarlo a una función pura con reloj
 * inyectable lo vuelve verificable con temporizadores falsos, y la prueba de la
 * ráfaga sostenida es la que habría atrapado esto desde el principio.
 */

/** Calma que se espera antes de refrescar, tras el último evento. */
export const DEBOUNCE_MS = 800;

/**
 * Techo desde el PRIMER evento de la ráfaga. 4 s es un compromiso deliberado:
 * suficiente para que un lote de 50 escaneos entre en un solo refresco, y lo
 * bastante corto para que el coordinador nunca mire una cifra que ya cambió —
 * el reparto arranca a las 16:00 y la asignación se hace contra estos números.
 */
export const MAX_ESPERA_MS = 4_000;

export interface OpcionesProgramador {
  debounceMs?: number;
  maxEsperaMs?: number;
  /** Reloj inyectable. Solo lo usan las pruebas; en producción es `Date.now`. */
  ahora?: () => number;
}

export interface ProgramadorRefresco {
  /** Registra un evento. Programa (o adelanta) el refresco según las dos reglas. */
  programar: () => void;
  /** Descarta el refresco pendiente y cierra la ventana. Para el desmontaje. */
  cancelar: () => void;
}

export function crearProgramadorRefresco(
  ejecutar: () => void,
  opciones: OpcionesProgramador = {},
): ProgramadorRefresco {
  const debounceMs = opciones.debounceMs ?? DEBOUNCE_MS;
  const maxEsperaMs = opciones.maxEsperaMs ?? MAX_ESPERA_MS;
  const ahora = opciones.ahora ?? Date.now;

  let temporizador: ReturnType<typeof setTimeout> | null = null;
  // Marca del primer evento de la ráfaga EN CURSO. `null` = no hay ráfaga
  // abierta. Es lo que hace que el techo se mida desde el principio de la
  // ráfaga y no desde el último evento (que es justo el bug de origen).
  let primerEventoEn: number | null = null;

  const disparar = () => {
    temporizador = null;
    primerEventoEn = null;
    ejecutar();
  };

  return {
    programar() {
      const instante = ahora();
      if (primerEventoEn === null) primerEventoEn = instante;

      // Nunca esperar más allá del techo de la ráfaga. Cuando el resto es
      // negativo (la ráfaga ya se pasó del techo) la espera queda en 0 y el
      // refresco sale en el siguiente tick, no se pierde.
      const restanteHastaElTope = maxEsperaMs - (instante - primerEventoEn);
      const espera = Math.max(0, Math.min(debounceMs, restanteHastaElTope));

      if (temporizador) clearTimeout(temporizador);
      temporizador = setTimeout(disparar, espera);
    },

    cancelar() {
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
      primerEventoEn = null;
    },
  };
}
