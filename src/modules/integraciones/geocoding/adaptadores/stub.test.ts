/**
 * Tests del adaptador STUB de geocoding.
 * =====================================================================
 *
 * El stub es determinista y sin red, así que estos tests son puros (no tocan
 * Supabase, ni la red, ni variables de entorno):
 *   - misma entrada → misma salida (determinismo, lo que lo hace apto para CI),
 *   - comuna en `COMUNAS_RM` → `estado: 'resuelto'` con el centroide de la comuna,
 *   - comuna fuera del catálogo → `estado: 'no_resuelto'` (lat/long/confianza null).
 */

import { describe, it, expect } from 'vitest';
import { StubGeocodingAdapter } from './stub';
import { CENTROIDES_RM } from '../centroides-rm';
import type { ComunaRM } from '@/lib/ui/comunas-rm';

const adapter = new StubGeocodingAdapter();

describe('StubGeocodingAdapter — determinismo', () => {
  it('misma entrada produce exactamente la misma salida', async () => {
    const entrada = { direccion: 'Av. Providencia 1234', comuna: 'Providencia' };
    const a = await adapter.geocodificar(entrada);
    const b = await adapter.geocodificar(entrada);
    expect(a).toEqual(b);
  });

  it('el resultado no depende de la dirección (a nivel comuna)', async () => {
    const r1 = await adapter.geocodificar({ direccion: 'Calle A 1', comuna: 'Ñuñoa' });
    const r2 = await adapter.geocodificar({ direccion: 'Otra Calle 999', comuna: 'Ñuñoa' });
    expect(r1.lat).toBe(r2.lat);
    expect(r1.long).toBe(r2.long);
    expect(r1.estado).toBe(r2.estado);
  });
});

describe('StubGeocodingAdapter — comuna en COMUNAS_RM', () => {
  it("comuna del catálogo → estado 'resuelto' con el centroide de la comuna", async () => {
    const res = await adapter.geocodificar({
      direccion: 'Av. Apoquindo 4000',
      comuna: 'Las Condes',
    });

    const centroide = CENTROIDES_RM['Las Condes' as ComunaRM];
    expect(res.estado).toBe('resuelto');
    expect(res.resuelto).toBe(true);
    expect(res.lat).toBe(centroide.lat);
    expect(res.long).toBe(centroide.long);
    expect(res.confianza).toBe(0.5);
    expect(res.comunaResuelta).toBe('Las Condes');
    expect(res.proveedor).toBe('stub');
  });

  it('comuna con acentos/casing distinto resuelve a la canónica del catálogo', async () => {
    const res = await adapter.geocodificar({ direccion: 'X', comuna: 'NUNOA' });
    const centroide = CENTROIDES_RM['Ñuñoa' as ComunaRM];
    expect(res.estado).toBe('resuelto');
    expect(res.comunaResuelta).toBe('Ñuñoa');
    expect(res.lat).toBe(centroide.lat);
  });
});

describe('StubGeocodingAdapter — comuna fuera del catálogo', () => {
  it("comuna que no existe en la RM → estado 'no_resuelto' con campos null", async () => {
    const res = await adapter.geocodificar({
      direccion: 'Calle Falsa 123',
      comuna: 'Valparaíso',
    });

    expect(res.estado).toBe('no_resuelto');
    expect(res.resuelto).toBe(false);
    expect(res.lat).toBeNull();
    expect(res.long).toBeNull();
    expect(res.confianza).toBeNull();
    expect(res.comunaResuelta).toBeNull();
    expect(res.proveedor).toBe('stub');
  });

  it('comuna inventada → no_resuelto (no inventa coordenadas)', async () => {
    const res = await adapter.geocodificar({ direccion: 'Y', comuna: 'Comuna Inexistente' });
    expect(res.estado).toBe('no_resuelto');
    expect(res.lat).toBeNull();
  });
});
