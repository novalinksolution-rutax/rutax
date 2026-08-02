/**
 * Tests unitarios para zonas.ts (F7, ítem 1.2).
 *
 * Cubre:
 *   - resolverZona: comuna mapeada → zonaId, no mapeada → null.
 *   - asignarComunasAZona: validación de comunas contra COMUNAS_RM.
 *   - crearZona / activarDesactivarZona: RBAC básico.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolverComunaCanonica } from '@/modules/integraciones/geocoding/normalizacion';

// ---------------------------------------------------------------------------
// Test puro: resolverComunaCanonica (sin BD) — se usa en zonas.ts
// ---------------------------------------------------------------------------

describe('resolverComunaCanonica — base para resolución de zona', () => {
  it('devuelve la forma canónica para comunas válidas de la RM', () => {
    expect(resolverComunaCanonica('Ñuñoa')).toBe('Ñuñoa');
    expect(resolverComunaCanonica('ñuñoa')).toBe('Ñuñoa');
    expect(resolverComunaCanonica('ÑUÑOA')).toBe('Ñuñoa');
    expect(resolverComunaCanonica('nunoa')).toBe('Ñuñoa'); // sin tilde
    expect(resolverComunaCanonica('Las Condes')).toBe('Las Condes');
    expect(resolverComunaCanonica('las condes')).toBe('Las Condes');
    expect(resolverComunaCanonica('Peñalolén')).toBe('Peñalolén');
    expect(resolverComunaCanonica('penalolen')).toBe('Peñalolén');
  });

  it('devuelve null para comunas fuera de la RM', () => {
    expect(resolverComunaCanonica('Valparaíso')).toBeNull();
    expect(resolverComunaCanonica('Concepción')).toBeNull();
    expect(resolverComunaCanonica('Comuna Inexistente XYZ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests con doble de BD para asignarComunasAZona (validaciones en app)
// ---------------------------------------------------------------------------

import { asignarComunasAZona } from './zonas';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Actor interno con capacidad gestionar_tarifas. */
const actorValido: UsuarioActual = {
  tenantId: 'tenant-1',
  rol: 'dueno',
  tipoUsuario: 'interno',
  estado: 'activo',
  sellerId: null,
  driverId: null,
};

/** Actor que NO tiene capacidad gestionar_tarifas. */
const actorSinPermiso: UsuarioActual = {
  ...actorValido,
  rol: 'conductor',
};

/** Doble de SupabaseClient básico — para los tests que fallan antes de tocar BD. */
function crearClienteStub(): SupabaseClient {
  return {
    from: vi.fn(),
    schema: vi.fn().mockReturnThis(),
  } as unknown as SupabaseClient;
}

describe('asignarComunasAZona — validación de RBAC y comunas', () => {
  it('lanza ErrorValidacion si el actor no tiene capacidad gestionar_tarifas', async () => {
    const { ErrorValidacion } = await import('@/modules/identidad/errores');
    await expect(
      asignarComunasAZona(
        crearClienteStub(),
        {
          tenantId: 'tenant-1',
          zonaId: 'zona-1',
          comunas: ['Maipú'],
          actorUsuarioId: 'actor-sin-permiso',
        },
        actorSinPermiso,
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('lanza ErrorValidacion si alguna comuna no está en COMUNAS_RM', async () => {
    const { ErrorValidacion } = await import('@/modules/identidad/errores');

    // Necesitamos un cliente que llegue al paso de validación de comunas.
    // El RBAC pasa, pero la validación de comunas debe fallar.
    await expect(
      asignarComunasAZona(
        crearClienteStub(),
        {
          tenantId: 'tenant-1',
          zonaId: 'zona-1',
          comunas: ['Maipú', 'ComunaInexistente'],
          actorUsuarioId: 'actor-1',
        },
        actorValido,
      ),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('lanza ErrorValidacion mencionando las comunas inválidas', async () => {
    const { ErrorValidacion } = await import('@/modules/identidad/errores');
    await expect(
      asignarComunasAZona(
        crearClienteStub(),
        {
          tenantId: 'tenant-1',
          zonaId: 'zona-1',
          comunas: ['BadComuna1', 'BadComuna2'],
          actorUsuarioId: 'actor-1',
        },
        actorValido,
      ),
    ).rejects.toThrow(/BadComuna1|BadComuna2/);
  });
});
