import { describe, expect, it } from 'vitest';

import { contarFoliosDisponibles, nivelFolios } from './folios-disponibles';
import { UMBRAL_FOLIOS } from './folios';

/**
 * El caso que motiva todo esto: `folio_actual === folio_hasta`.
 *
 * Ahí queda **un** folio utilizable —`reservarFolio` lo entrega, su guarda es
 * `folioActual > folioHasta`— y el dashboard, que contaba exclusivo, decía cero.
 * O sea: la pantalla mandaba a cargar un CAF nuevo mientras la emisión real
 * todavía habría pasado.
 */

describe('contarFoliosDisponibles · inclusivo', () => {
  it('con folio_actual === folio_hasta queda UNO, no cero', () => {
    expect(contarFoliosDisponibles({ folio_actual: 1050, folio_hasta: 1050 })).toBe(1);
  });

  it('cuenta el rango completo', () => {
    expect(contarFoliosDisponibles({ folio_actual: 1001, folio_hasta: 1100 })).toBe(100);
    expect(contarFoliosDisponibles({ folio_actual: 1042, folio_hasta: 1050 })).toBe(9);
  });

  it('nunca devuelve negativo, aunque el CAF ya se haya pasado', () => {
    expect(contarFoliosDisponibles({ folio_actual: 1051, folio_hasta: 1050 })).toBe(0);
    expect(contarFoliosDisponibles({ folio_actual: 2000, folio_hasta: 1050 })).toBe(0);
  });

  it('coincide con la guarda de `reservarFolio`', () => {
    // reservarFolio lanza cuando `folioActual > folioHasta`. Justo en el límite
    // todavía entrega, así que el conteo tiene que ser > 0.
    const enElLimite = { folio_actual: 1050, folio_hasta: 1050 };
    const pasado = { folio_actual: 1051, folio_hasta: 1050 };
    expect(contarFoliosDisponibles(enElLimite)).toBeGreaterThan(0);
    expect(contarFoliosDisponibles(pasado)).toBe(0);
  });
});

describe('nivelFolios · los tres estados del indicador', () => {
  it('cero o menos es agotados', () => {
    expect(nivelFolios(0)).toBe('agotados');
    expect(nivelFolios(-3)).toBe('agotados');
  });

  it('uno ya no es agotados: todavía se puede emitir una factura', () => {
    expect(nivelFolios(1)).toBe('pocos');
  });

  it('bajo el umbral es pocos, desde el umbral es normal', () => {
    expect(nivelFolios(UMBRAL_FOLIOS - 1)).toBe('pocos');
    expect(nivelFolios(UMBRAL_FOLIOS)).toBe('normal');
    expect(nivelFolios(UMBRAL_FOLIOS + 500)).toBe('normal');
  });

  it('usa el MISMO umbral que la verificación previa y el correo de aviso', () => {
    // Un tercer número acá volvería a partir la verdad en tres, que es
    // exactamente el problema que este módulo vino a cerrar.
    expect(UMBRAL_FOLIOS).toBe(50);
  });
});
