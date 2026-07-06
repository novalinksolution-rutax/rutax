/**
 * Tests de normalización + hash del cache de geocoding.
 * =====================================================================
 *
 * El `clave_hash` es la columna UNIQUE de `integraciones.geocoding_cache`: si su
 * algoritmo cambia, el cache global queda invalidado. Estos tests fijan el
 * contrato observable:
 *   - misma dirección con distinto casing/espacios/acentos → mismo hash,
 *   - direcciones distintas → hashes distintos (sin colisión por concatenación),
 *   - la comuna canónica se resuelve tolerante a acentos/casing.
 *
 * Puros: solo crypto local, sin red ni Supabase.
 */

import { describe, it, expect } from 'vitest';
import {
  calcularClaveHash,
  resolverComunaCanonica,
  normalizarDireccion,
} from './normalizacion';

describe('calcularClaveHash — estabilidad ante casing/espacios/acentos', () => {
  it('mismo input con distinto casing → mismo hash', () => {
    const a = calcularClaveHash('Av. Providencia 1234', 'Providencia');
    const b = calcularClaveHash('AV. PROVIDENCIA 1234', 'PROVIDENCIA');
    expect(a.claveHash).toBe(b.claveHash);
  });

  it('espacios extra (internos y en extremos) no cambian el hash', () => {
    const a = calcularClaveHash('Av.  Providencia   1234', '  Providencia ');
    const b = calcularClaveHash('Av. Providencia 1234', 'Providencia');
    expect(a.claveHash).toBe(b.claveHash);
  });

  it('acentos no cambian el hash (NFD + strip diacríticos)', () => {
    const a = calcularClaveHash('Calle Nuñoa 1', 'Ñuñoa');
    const b = calcularClaveHash('Calle Nunoa 1', 'Nunoa');
    expect(a.claveHash).toBe(b.claveHash);
  });

  it('el hash es hex de 64 chars (sha256) y determinista', () => {
    const a = calcularClaveHash('Av. Matta 100', 'Santiago');
    const b = calcularClaveHash('Av. Matta 100', 'Santiago');
    expect(a.claveHash).toBe(b.claveHash);
    expect(a.claveHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('calcularClaveHash — direcciones distintas → hashes distintos', () => {
  it('dos direcciones diferentes producen hashes diferentes', () => {
    const a = calcularClaveHash('Av. Providencia 1234', 'Providencia');
    const b = calcularClaveHash('Av. Providencia 1235', 'Providencia');
    expect(a.claveHash).not.toBe(b.claveHash);
  });

  it('misma dirección, comuna distinta → hashes distintos', () => {
    const a = calcularClaveHash('Av. Principal 10', 'Maipú');
    const b = calcularClaveHash('Av. Principal 10', 'Puente Alto');
    expect(a.claveHash).not.toBe(b.claveHash);
  });

  it('el separador | evita colisiones entre (ab,c) y (a,bc)', () => {
    const a = calcularClaveHash('ab', 'c');
    const b = calcularClaveHash('a', 'bc');
    expect(a.claveHash).not.toBe(b.claveHash);
  });
});

describe('resolverComunaCanonica', () => {
  it('comuna del catálogo (con acentos/casing) → forma canónica exacta', () => {
    expect(resolverComunaCanonica('nunoa')).toBe('Ñuñoa');
    expect(resolverComunaCanonica('PENALOLEN')).toBe('Peñalolén');
    expect(resolverComunaCanonica('  las condes ')).toBe('Las Condes');
  });

  it('comuna fuera de la RM → null', () => {
    expect(resolverComunaCanonica('Valparaíso')).toBeNull();
    expect(resolverComunaCanonica('Comuna Inexistente')).toBeNull();
  });
});

describe('normalizarDireccion', () => {
  it('minúsculas, sin acentos, espacios colapsados, recortado', () => {
    expect(normalizarDireccion('  Av.  ÑUÑOA   123 ')).toBe('av. nunoa 123');
  });
});
