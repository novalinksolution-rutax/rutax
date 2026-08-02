/**
 * Pruebas del adaptador STUB de calidad del aire.
 * =====================================================================
 * Lo importante: el stub usa EL MISMO clasificador que producción, así que si el
 * mapeo PM2.5 → nivel se rompiera, estos tests también lo verían.
 */

import { describe, it, expect } from 'vitest';
import { StubAireAdapter } from './stub';
import { nivelDesdePm25Media24h } from '../niveles';
import { fechaLocalEnSantiago } from '@/lib/fecha-santiago';
import type { ComunaRM } from '@/lib/ui/comunas-rm';

const COMUNAS = ['Santiago', 'Puente Alto'] as ComunaRM[];

describe('StubAireAdapter — determinismo', () => {
  it('la misma fecha base produce el mismo resultado', async () => {
    const a = await new StubAireAdapter('2026-07-26').obtenerPronostico({
      comunas: COMUNAS,
      dias: 2,
    });
    const b = await new StubAireAdapter('2026-07-26').obtenerPronostico({
      comunas: COMUNAS,
      dias: 2,
    });
    if (!a.ok || !b.ok) throw new Error('esperaba éxito');
    expect(a.datos.horas).toEqual(b.datos.horas);
  });
});

describe('StubAireAdapter — coherencia con el clasificador de producción', () => {
  it('nivelEstimado siempre corresponde a la media24hPm25 de la fila', async () => {
    const res = await new StubAireAdapter('2026-07-26').obtenerPronostico({
      comunas: COMUNAS,
      dias: 2,
    });
    if (!res.ok) throw new Error('esperaba éxito');

    for (const f of res.datos.horas) {
      const esperado =
        f.media24hPm25 === null ? 'bueno' : nivelDesdePm25Media24h(f.media24hPm25);
      expect(f.nivelEstimado).toBe(esperado);
    }
  });

  it('incluye 24 h de historia para que la ventana móvil esté completa', async () => {
    const res = await new StubAireAdapter('2026-07-26').obtenerPronostico({
      comunas: ['Santiago'] as ComunaRM[],
      dias: 1,
    });
    if (!res.ok) throw new Error('esperaba éxito');

    const dias = [...new Set(res.datos.horas.map((h) => fechaLocalEnSantiago(h.hora)))];
    expect(dias).toContain('2026-07-25'); // historia
    expect(dias).toContain('2026-07-26'); // el día pedido
  });

  it('produce valores de PM2.5 en un rango plausible para Santiago', async () => {
    const res = await new StubAireAdapter('2026-07-26').obtenerPronostico({ dias: 1 });
    if (!res.ok) throw new Error('esperaba éxito');

    for (const f of res.datos.horas) {
      expect(f.pm25!).toBeGreaterThan(0);
      expect(f.pm25!).toBeLessThan(200);
      expect(f.pm10!).toBeGreaterThanOrEqual(f.pm25!);
    }
  });

  it('la clave (comuna, hora) es única', async () => {
    const res = await new StubAireAdapter('2026-07-26').obtenerPronostico({
      comunas: COMUNAS,
      dias: 3,
    });
    if (!res.ok) throw new Error('esperaba éxito');
    const claves = res.datos.horas.map((h) => `${h.comuna}|${h.hora.toISOString()}`);
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe('StubAireAdapter — degradación', () => {
  it('una comuna fuera del catálogo degrada en vez de lanzar', async () => {
    const res = await new StubAireAdapter('2026-07-26').obtenerPronostico({
      comunas: ['Antofagasta' as ComunaRM],
    });
    expect(res.ok).toBe(false);
  });
});
