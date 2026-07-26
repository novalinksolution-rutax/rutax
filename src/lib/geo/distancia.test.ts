/**
 * Tests de la geometría mínima.
 * =====================================================================
 *
 * Es la función que decide si un pedido cae dentro del perímetro de un corte de
 * tránsito o bajo una celda de lluvia. Un error acá no rompe nada visiblemente:
 * simplemente deja pedidos fuera de una alerta que sí los tocaba. Por eso se
 * prueba contra distancias verificables, no contra el resultado que devuelva la
 * implementación.
 */

import { describe, it, expect } from 'vitest';
import { distanciaEnMetros, estaDentroDelRadio } from './distancia';
import { CENTROIDES_RM } from './centroides-rm';

/** Un grado de latitud sobre la esfera IUGG: π·R/180. */
const GRADO_LATITUD_M = 111_194.93;

describe('distanciaEnMetros', () => {
  it('un punto consigo mismo da exactamente 0', () => {
    const p = CENTROIDES_RM['Santiago'];
    expect(distanciaEnMetros(p, p)).toBe(0);
  });

  it('es simétrica', () => {
    const a = CENTROIDES_RM['Santiago'];
    const b = CENTROIDES_RM['Puente Alto'];
    expect(distanciaEnMetros(a, b)).toBeCloseTo(distanciaEnMetros(b, a), 9);
  });

  it('un grado de latitud mide ~111,19 km', () => {
    const d = distanciaEnMetros({ lat: -33, long: -70.6 }, { lat: -34, long: -70.6 });
    expect(d).toBeCloseTo(GRADO_LATITUD_M, 0);
  });

  it('un grado de longitud se acorta por el coseno de la latitud', () => {
    // A -33,45° un grado de longitud mide cos(33,45°) ≈ 0,8343 de uno de latitud.
    const d = distanciaEnMetros({ lat: -33.45, long: -70.0 }, { lat: -33.45, long: -71.0 });
    const esperado = GRADO_LATITUD_M * Math.cos((33.45 * Math.PI) / 180);
    expect(d / esperado).toBeCloseTo(1, 3);
  });

  it('Santiago–Las Condes está en el orden de los 10 km', () => {
    const d = distanciaEnMetros(CENTROIDES_RM['Santiago'], CENTROIDES_RM['Las Condes']);
    expect(d).toBeGreaterThan(9_000);
    expect(d).toBeLessThan(12_000);
  });
});

describe('estaDentroDelRadio', () => {
  const centro = CENTROIDES_RM['Ñuñoa'];

  it('el propio centro está dentro', () => {
    expect(estaDentroDelRadio(centro, centro, 1_800)).toBe(true);
  });

  it('el borde cuenta como dentro', () => {
    // Un punto a un grado de latitud exacto, con el radio justo a esa distancia.
    const punto = { lat: centro.lat - 1, long: centro.long };
    const radio = distanciaEnMetros(punto, centro);
    expect(estaDentroDelRadio(punto, centro, radio)).toBe(true);
  });

  it('un punto claramente afuera queda afuera', () => {
    // El perímetro del Estadio Nacional (1,8 km) no alcanza a Maipú.
    expect(estaDentroDelRadio(CENTROIDES_RM['Maipú'], centro, 1_800)).toBe(false);
  });

  it('un radio de 0 o negativo no contiene a nadie, ni al propio centro', () => {
    expect(estaDentroDelRadio(centro, centro, 0)).toBe(false);
    expect(estaDentroDelRadio(centro, centro, -100)).toBe(false);
  });
});
