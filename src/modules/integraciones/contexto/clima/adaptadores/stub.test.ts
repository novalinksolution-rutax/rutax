/**
 * Pruebas del adaptador STUB de clima.
 * =====================================================================
 * Determinismo (para que sirva en CI) y corte de día en Santiago (para que no
 * reintroduzca el bug de zona horaria).
 */

import { describe, it, expect } from 'vitest';
import { StubClimaAdapter } from './stub';
import { fechaLocalEnSantiago } from '@/lib/fecha-santiago';
import type { ComunaRM } from '@/lib/ui/comunas-rm';

const COMUNAS = ['Santiago', 'Providencia'] as ComunaRM[];

describe('StubClimaAdapter — determinismo', () => {
  it('la misma fecha base y las mismas comunas producen el mismo resultado', async () => {
    const a = new StubClimaAdapter('2026-07-26');
    const b = new StubClimaAdapter('2026-07-26');

    const ra = await a.obtenerPronostico({ comunas: COMUNAS, dias: 2 });
    const rb = await b.obtenerPronostico({ comunas: COMUNAS, dias: 2 });
    if (!ra.ok || !rb.ok) throw new Error('esperaba éxito');

    expect(ra.datos.horas).toEqual(rb.datos.horas);
  });

  it('nunca falla ni lanza: siempre devuelve datos', async () => {
    const res = await new StubClimaAdapter('2026-07-26').obtenerPronostico();
    expect(res.ok).toBe(true);
  });
});

describe('StubClimaAdapter — forma del resultado', () => {
  it('devuelve 24 filas por comuna y por día', async () => {
    const res = await new StubClimaAdapter('2026-07-26').obtenerPronostico({
      comunas: COMUNAS,
      dias: 3,
    });
    if (!res.ok) throw new Error('esperaba éxito');
    expect(res.datos.horas).toHaveLength(2 * 3 * 24);
    expect(res.datos.proveedor).toBe('stub');
  });

  it('sin comunas, cubre las 52 de la RM', async () => {
    const res = await new StubClimaAdapter('2026-07-26').obtenerPronostico({ dias: 1 });
    if (!res.ok) throw new Error('esperaba éxito');
    expect(res.datos.comunasResueltas).toHaveLength(52);
  });

  it('respeta los CHECK de contexto.clima_horario', async () => {
    const res = await new StubClimaAdapter('2026-07-26').obtenerPronostico({ dias: 2 });
    if (!res.ok) throw new Error('esperaba éxito');

    for (const h of res.datos.horas) {
      expect(h.precipitacionMm!).toBeGreaterThanOrEqual(0);
      expect(h.vientoKmh!).toBeGreaterThanOrEqual(0);
      expect(h.probPrecipitacion!).toBeGreaterThanOrEqual(0);
      expect(h.probPrecipitacion!).toBeLessThanOrEqual(100);
      expect(Number.isInteger(h.probPrecipitacion)).toBe(true);
    }
  });

  it('la clave (comuna, hora) es única — el PK del upsert no choca', async () => {
    const res = await new StubClimaAdapter('2026-07-26').obtenerPronostico({
      comunas: COMUNAS,
      dias: 3,
    });
    if (!res.ok) throw new Error('esperaba éxito');

    const claves = res.datos.horas.map((h) => `${h.comuna}|${h.hora.toISOString()}`);
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe('StubClimaAdapter — corte de día en Santiago', () => {
  it('la serie arranca a las 00:00 del día CIVIL de Santiago, no de UTC', async () => {
    const res = await new StubClimaAdapter('2026-07-26').obtenerPronostico({
      comunas: ['Santiago'] as ComunaRM[],
      dias: 1,
    });
    if (!res.ok) throw new Error('esperaba éxito');

    const primera = res.datos.horas[0].hora;
    // Julio = UTC-4 → las 00:00 de Santiago son las 04:00 UTC.
    expect(primera.toISOString()).toBe('2026-07-26T04:00:00.000Z');
    // Y visto desde Santiago, el día es el pedido.
    expect(fechaLocalEnSantiago(primera)).toBe('2026-07-26');
  });

  it('todas las horas de un día pertenecen a ese día civil de Santiago', async () => {
    const res = await new StubClimaAdapter('2026-07-26').obtenerPronostico({
      comunas: ['Santiago'] as ComunaRM[],
      dias: 1,
    });
    if (!res.ok) throw new Error('esperaba éxito');

    const dias = new Set(res.datos.horas.map((h) => fechaLocalEnSantiago(h.hora)));
    expect([...dias]).toEqual(['2026-07-26']);
  });

  it('funciona igual en horario de verano chileno (UTC-3)', async () => {
    const res = await new StubClimaAdapter('2026-01-15').obtenerPronostico({
      comunas: ['Santiago'] as ComunaRM[],
      dias: 1,
    });
    if (!res.ok) throw new Error('esperaba éxito');
    expect(res.datos.horas[0].hora.toISOString()).toBe('2026-01-15T03:00:00.000Z');
  });
});

describe('StubClimaAdapter — degradación', () => {
  it('una comuna fuera del catálogo degrada en vez de lanzar', async () => {
    const res = await new StubClimaAdapter('2026-07-26').obtenerPronostico({
      comunas: ['Concepción' as ComunaRM],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reintentable).toBe(false);
  });
});
