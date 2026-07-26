/**
 * Tests del catálogo de centroides.
 * =====================================================================
 *
 * El test que importa es el de sincronización: `CENTROIDES_RM` está tipado como
 * `Record<ComunaRM, …>`, así que TypeScript ya obliga a que tenga una clave por
 * comuna del catálogo. Lo que TypeScript NO puede detectar es que al catálogo
 * mismo le falte una comuna de la Región Metropolitana — que es exactamente lo
 * que pasó: `COMUNAS_RM` vivió con 51 comunas y sin Pedro Aguirre Cerda, y el
 * hueco se propagó a los centroides, al selector de zonas del courier y al
 * formulario de pedido del seller sin que nada fallara.
 *
 * De ahí el test de conteo: la RM tiene 52 comunas y ese número es un hecho
 * administrativo, no una preferencia. Si alguien vuelve a dejar una fuera, esto
 * falla.
 */

import { describe, it, expect } from 'vitest';
import { COMUNAS_RM } from '@/lib/ui/comunas-rm';
import { CENTROIDES_RM } from './centroides-rm';

/** Comunas de la Región Metropolitana de Santiago (6 provincias, DPA vigente). */
const TOTAL_COMUNAS_RM = 52;

describe('COMUNAS_RM — completitud del catálogo', () => {
  it('tiene las 52 comunas de la Región Metropolitana', () => {
    expect(COMUNAS_RM).toHaveLength(TOTAL_COMUNAS_RM);
  });

  it('no repite ninguna comuna', () => {
    expect(new Set(COMUNAS_RM).size).toBe(COMUNAS_RM.length);
  });

  it('está ordenado alfabéticamente en español', () => {
    const ordenado = [...COMUNAS_RM].sort((a, b) => a.localeCompare(b, 'es'));
    expect([...COMUNAS_RM]).toEqual(ordenado);
  });
});

describe('CENTROIDES_RM — sincronía con el catálogo', () => {
  it('tiene un centroide por cada comuna del catálogo, y ninguno de más', () => {
    expect(Object.keys(CENTROIDES_RM).sort()).toEqual([...COMUNAS_RM].sort());
  });

  it('todos los centroides caen dentro del rectángulo de la Región Metropolitana', () => {
    // Extremos generosos de la RM: Tiltil al norte, Paine/San Pedro al sur,
    // San José de Maipo al oriente, San Pedro/Melipilla al poniente.
    for (const [comuna, { lat, long }] of Object.entries(CENTROIDES_RM)) {
      expect(lat, `latitud de ${comuna}`).toBeGreaterThan(-34.4);
      expect(lat, `latitud de ${comuna}`).toBeLessThan(-32.9);
      expect(long, `longitud de ${comuna}`).toBeGreaterThan(-71.8);
      expect(long, `longitud de ${comuna}`).toBeLessThan(-70.0);
    }
  });

  it('no repite coordenadas entre comunas distintas', () => {
    const vistos = new Map<string, string>();
    for (const [comuna, { lat, long }] of Object.entries(CENTROIDES_RM)) {
      const clave = `${lat},${long}`;
      expect(vistos.get(clave), `${comuna} comparte centroide con ${vistos.get(clave)}`)
        .toBeUndefined();
      vistos.set(clave, comuna);
    }
  });
});
