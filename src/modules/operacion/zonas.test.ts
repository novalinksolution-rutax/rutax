/**
 * Tests unitarios para zonas.ts (F7, ítem 1.2).
 *
 * Cubre:
 *   - resolverComunaCanonica: la normalización en la que se apoya el resto.
 *   - guardarZonaConComunas: el guardado atómico — RBAC, normalización,
 *     bitácora antes del efecto y traducción de los errores de Postgres.
 *   - Un candado sobre la migración que sostiene esa atomicidad.
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
// Andamiaje compartido
// ---------------------------------------------------------------------------

import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Actor interno con capacidad gestionar_tarifas. */
const actorValido: UsuarioActual = {
  tenantId: 'tenant-1',
  rol: 'dueno',
  tipoUsuario: 'interno',
  estado: 'activo',
  areasHabilitadas: [...AREAS_PRODUCTO],
  sellerId: null,
  driverId: null,
};

/** Actor que NO tiene capacidad gestionar_tarifas. */
const actorSinPermiso: UsuarioActual = {
  ...actorValido,
  rol: 'conductor',
};

// ---------------------------------------------------------------------------
// guardarZonaConComunas — el guardado atómico
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { guardarZonaConComunas } from './zonas';
import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";

/**
 * Doble que registra lo que pasó: qué se escribió en bitácora y con qué
 * parámetros se llamó a la función de Postgres.
 */
function crearClienteEspia(
  respuestaRpc: { data?: unknown; error?: { code?: string; message: string } | null } = {},
) {
  const bitacora: Record<string, unknown>[] = [];
  const rpcs: { nombre: string; params: Record<string, unknown> }[] = [];
  const cliente = {
    from: vi.fn(() => ({
      insert: vi.fn((fila: Record<string, unknown>) => {
        bitacora.push(fila);
        return Promise.resolve({ error: null });
      }),
    })),
    schema: vi.fn(() => ({
      rpc: vi.fn((nombre: string, params: Record<string, unknown>) => {
        rpcs.push({ nombre, params });
        return Promise.resolve({
          data: respuestaRpc.data ?? {
            id: 'zona-nueva',
            tenant_id: 'tenant-1',
            nombre: 'Norte',
            activa: true,
            creado_en: '2026-08-25T00:00:00Z',
            actualizado_en: '2026-08-25T00:00:00Z',
          },
          error: respuestaRpc.error ?? null,
        });
      }),
    })),
  } as unknown as SupabaseClient;
  return { cliente, bitacora, rpcs };
}

describe('guardarZonaConComunas', () => {
  it('🔴 escribe TODO en una sola llamada al servidor', async () => {
    // Es el punto entero del cambio. Antes eran dos acciones —crear la zona y
    // asignarle comunas— y un fallo en la segunda dejaba la zona creada y
    // vacía. Si alguien vuelve a partirlo en dos, esto lo caza.
    const { cliente, rpcs } = crearClienteEspia();
    await guardarZonaConComunas(
      cliente,
      {
        tenantId: 'tenant-1',
        zonaId: null,
        nombre: 'Norte',
        comunas: ['Maipú', 'Ñuñoa'],
        actorUsuarioId: 'actor-1',
      },
      actorValido,
    );
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].nombre).toBe('guardar_zona_con_comunas');
  });

  it('normaliza las comunas antes de mandarlas, y eso se queda en TypeScript', async () => {
    // El catálogo de alias («nunoa» → «Ñuñoa») vive acá; duplicarlo en plpgsql
    // sería tener dos verdades sobre el mismo nombre.
    const { cliente, rpcs } = crearClienteEspia();
    await guardarZonaConComunas(
      cliente,
      {
        tenantId: 'tenant-1',
        zonaId: null,
        nombre: '  Norte  ',
        comunas: ['nunoa', 'LAS CONDES'],
        actorUsuarioId: 'actor-1',
      },
      actorValido,
    );
    expect(rpcs[0].params.p_comunas).toEqual(['Ñuñoa', 'Las Condes']);
    expect(rpcs[0].params.p_nombre).toBe('Norte');
  });

  it('la bitácora va ANTES del efecto, y distingue alta de reasignación', async () => {
    const alta = crearClienteEspia();
    await guardarZonaConComunas(
      alta.cliente,
      {
        tenantId: 'tenant-1',
        zonaId: null,
        nombre: 'Norte',
        comunas: [],
        actorUsuarioId: 'actor-1',
      },
      actorValido,
    );
    expect(alta.bitacora[0].accion).toBe('zona.creada');
    expect(alta.bitacora[0].actor_usuario_id).toBe('actor-1');

    const edicion = crearClienteEspia();
    await guardarZonaConComunas(
      edicion.cliente,
      {
        tenantId: 'tenant-1',
        zonaId: 'zona-9',
        nombre: 'Norte',
        comunas: [],
        actorUsuarioId: 'actor-1',
      },
      actorValido,
    );
    expect(edicion.bitacora[0].accion).toBe('zona.comunas_reasignadas');
    expect(edicion.bitacora[0].entidad_id).toBe('zona-9');
  });

  it('no toca nada si el actor no tiene capacidad', async () => {
    const { ErrorValidacion } = await import('@/modules/identidad/errores');
    const { cliente, bitacora, rpcs } = crearClienteEspia();
    await expect(
      guardarZonaConComunas(
        cliente,
        { tenantId: 'tenant-1', zonaId: null, nombre: 'Norte', comunas: [], actorUsuarioId: 'x' },
        actorSinPermiso,
      ),
    ).rejects.toThrow(ErrorValidacion);
    expect(bitacora).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it('una comuna fuera de la RM corta antes de escribir bitácora', async () => {
    const { cliente, bitacora, rpcs } = crearClienteEspia();
    await expect(
      guardarZonaConComunas(
        cliente,
        {
          tenantId: 'tenant-1',
          zonaId: null,
          nombre: 'Norte',
          comunas: ['Maipú', 'Valparaíso'],
          actorUsuarioId: 'x',
        },
        actorValido,
      ),
    ).rejects.toThrow(/Valparaíso/);
    expect(bitacora).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it('el nombre vacío se rechaza acá, sin viaje al servidor', async () => {
    const { cliente, rpcs } = crearClienteEspia();
    await expect(
      guardarZonaConComunas(
        cliente,
        { tenantId: 'tenant-1', zonaId: null, nombre: '   ', comunas: [], actorUsuarioId: 'x' },
        actorValido,
      ),
    ).rejects.toThrow(/nombre/i);
    expect(rpcs).toHaveLength(0);
  });

  it('🔴 el choque de unicidad se traduce a la salida concreta', async () => {
    // «23505» no le dice nada a nadie. La persona necesita saber que hay una
    // comuna que ya es de otra zona y que la salida es desmarcarla.
    const { cliente } = crearClienteEspia({ error: { code: '23505', message: 'duplicate key' } });
    await expect(
      guardarZonaConComunas(
        cliente,
        {
          tenantId: 'tenant-1',
          zonaId: null,
          nombre: 'Norte',
          comunas: ['Maipú'],
          actorUsuarioId: 'x',
        },
        actorValido,
      ),
    ).rejects.toThrow(/ya están asignadas a otra zona/);
  });

  it('una zona de otro courier se reporta como inexistente', async () => {
    // La función filtra por `tenant_id` en el WHERE: pedir una zona ajena no
    // devuelve fila y sale por «P0002». El mensaje NO confirma que exista.
    const { cliente } = crearClienteEspia({ error: { code: 'P0002', message: 'no existe' } });
    await expect(
      guardarZonaConComunas(
        cliente,
        {
          tenantId: 'tenant-1',
          zonaId: 'zona-ajena',
          nombre: 'Norte',
          comunas: [],
          actorUsuarioId: 'x',
        },
        actorValido,
      ),
    ).rejects.toThrow(/no existe en este courier/);
  });
});

describe('candado: la migración del guardado atómico', () => {
  const sql = readFileSync(
    'supabase/migrations/20260825000001_identidad_guardar_zona_con_comunas.sql',
    'utf8',
  );

  it('🔴 el borrado y la inserción de comunas viven en el MISMO cuerpo', () => {
    // La atomicidad es exactamente eso: si el insert falla, el delete se
    // deshace y la zona conserva sus comunas. Sacar una de las dos de la
    // función devuelve el bug de la zona vaciada en silencio.
    const cuerpo = sql.slice(sql.indexOf('as $' + '$'), sql.indexOf('$' + '$;'));
    expect(cuerpo).toMatch(/delete\s+from\s+identidad\.zona_comunas/i);
    expect(cuerpo).toMatch(/insert\s+into\s+identidad\.zona_comunas/i);
  });

  it('filtra por tenant_id en las escrituras', () => {
    // Corre como `service_role`, o sea sin RLS que lo respalde: el aislamiento
    // multi-tenant lo impone el WHERE y nada más.
    expect(sql).toMatch(/update\s+identidad\.zonas[\s\S]*?and\s+tenant_id\s*=\s*p_tenant_id/i);
    expect(sql).toMatch(
      /delete\s+from\s+identidad\.zona_comunas\s+where\s+tenant_id\s*=\s*p_tenant_id/i,
    );
  });

  it('solo `service_role` puede ejecutarla', () => {
    expect(sql).toMatch(/revoke all on function[\s\S]*from public/i);
    expect(sql).toMatch(/revoke all on function[\s\S]*from authenticated/i);
    expect(sql).toMatch(/revoke all on function[\s\S]*from anon/i);
    expect(sql).toMatch(/grant execute on function[\s\S]*to service_role/i);
  });

  it('no es `security definer`: quien la llama ya pasa por encima de RLS', () => {
    expect(sql).not.toMatch(/security\s+definer/i);
  });
});
