/**
 * Pruebas de la heurística pura `elegirConductor` (F6, ítem 1.3).
 *
 * Solo se prueba la función pura — sin I/O, sin mocks de Supabase.
 * Las acciones de servidor (autoAsignarPendientesDelDia,
 * marcarConductorNoDisponibleYRedistribuir) requieren un doble de BD más
 * complejo y se prueban en integración.
 *
 * Escenarios cubiertos:
 *   1. Elige conductor con afinidad de zona cuando existe.
 *   2. Sin candidatos con zona → desciende a pool general.
 *   3. Desempate por menor ocupación dentro del mismo grupo.
 *   4. Desempate estable por id cuando hay empate de ocupación.
 *   5. Sin candidato disponible → motivo 'sin_conductor_disponible'.
 *   6. Hay candidatos disponibles pero todos sin cupo → motivo 'sin_cupo'.
 *   7. Sin zona mapeada en el pedido → no discrimina, elige por ocupación.
 *   8. Conductor inactivo no entra al pool aunque tenga zona preferente.
 */

import { describe, expect, it } from 'vitest';
import { elegirConductor } from './auto-asignacion';
import type { ConductorCandidato, PedidoConZona } from './auto-asignacion';

// =============================================================================
// Fixtures
// =============================================================================

const TENANT = 'aaaa1111-0000-0000-0000-000000000001';
const ZONA_NORTE = 'zona-norte-0000-0000-0000-000000000001';
const ZONA_SUR = 'zona-sur-0000-0000-0000-000000000002';

function conductor(overrides: Partial<ConductorCandidato> & { id: string }): ConductorCandidato {
  return {
    tenantId: TENANT,
    estado: 'activo',
    disponible: true,
    capacidadParadas: 30,
    nombre: `Conductor ${overrides.id}`,
    cargaActual: 0,
    zonasConductor: new Set(),
    ...overrides,
  };
}

function pedido(overrides: Partial<PedidoConZona> = {}): PedidoConZona {
  return {
    pedidoId: 'pedido-001',
    sellerId: 'seller-001',
    comunaDestino: 'Las Condes',
    zonaPedido: ZONA_NORTE,
    ...overrides,
  };
}

// =============================================================================
// 1. Afinidad de zona
// =============================================================================

describe('elegirConductor — afinidad de zona', () => {
  it('elige el conductor cuya zona preferente coincide con la zona del pedido', () => {
    const c1 = conductor({ id: 'c1', zonasConductor: new Set([ZONA_SUR]) }); // zona distinta
    const c2 = conductor({ id: 'c2', zonasConductor: new Set([ZONA_NORTE]) }); // zona correcta
    const c3 = conductor({ id: 'c3', zonasConductor: new Set() }); // sin zonas

    const res = elegirConductor(pedido(), [c1, c2, c3]);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.conductor.id).toBe('c2');
  });

  it('cuando ningún candidato tiene la zona del pedido, elige del pool general', () => {
    const c1 = conductor({ id: 'c1', zonasConductor: new Set([ZONA_SUR]) });
    const c2 = conductor({ id: 'c2', zonasConductor: new Set([ZONA_SUR]) });

    const res = elegirConductor(pedido({ zonaPedido: ZONA_NORTE }), [c1, c2]);

    // Ninguno tiene ZONA_NORTE → cae al pool general.
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Ambos tienen carga=0 → desempate estable por id: c1 < c2.
      expect(res.conductor.id).toBe('c1');
    }
  });
});

// =============================================================================
// 2. Desempate por ocupación
// =============================================================================

describe('elegirConductor — desempate por ocupación', () => {
  it('elige al conductor con menor ocupación cuando hay empate de zona', () => {
    const c1 = conductor({
      id: 'c1',
      zonasConductor: new Set([ZONA_NORTE]),
      cargaActual: 15,
      capacidadParadas: 30, // ocupación 0.50
    });
    const c2 = conductor({
      id: 'c2',
      zonasConductor: new Set([ZONA_NORTE]),
      cargaActual: 5,
      capacidadParadas: 30, // ocupación 0.17
    });

    const res = elegirConductor(pedido({ zonaPedido: ZONA_NORTE }), [c1, c2]);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.conductor.id).toBe('c2'); // menor ocupación
  });

  it('no supera la capacidad: conductor con cargaActual === capacidadParadas es inelegible', () => {
    const c1 = conductor({
      id: 'c1',
      cargaActual: 30,
      capacidadParadas: 30, // lleno
    });
    const c2 = conductor({
      id: 'c2',
      cargaActual: 20,
      capacidadParadas: 30, // con cupo
    });

    const res = elegirConductor(pedido(), [c1, c2]);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.conductor.id).toBe('c2');
  });
});

// =============================================================================
// 3. Desempate estable por id
// =============================================================================

describe('elegirConductor — desempate estable por id', () => {
  it('con igual ocupación y misma zona, elige el conductor con id lexicográficamente menor', () => {
    const cZ = conductor({
      id: 'z-ultimo',
      zonasConductor: new Set([ZONA_NORTE]),
      cargaActual: 5,
    });
    const cA = conductor({
      id: 'a-primero',
      zonasConductor: new Set([ZONA_NORTE]),
      cargaActual: 5,
    });
    const cM = conductor({
      id: 'm-medio',
      zonasConductor: new Set([ZONA_NORTE]),
      cargaActual: 5,
    });

    const res = elegirConductor(pedido({ zonaPedido: ZONA_NORTE }), [cZ, cA, cM]);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.conductor.id).toBe('a-primero');
  });
});

// =============================================================================
// 4. Sin conductor disponible
// =============================================================================

describe('elegirConductor — sin conductor disponible', () => {
  it('devuelve motivo sin_conductor_disponible cuando el pool está vacío', () => {
    const res = elegirConductor(pedido(), []);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.motivo).toBe('sin_conductor_disponible');
  });

  it('devuelve sin_conductor_disponible cuando todos están disponible=false', () => {
    const c1 = conductor({ id: 'c1', disponible: false });
    const c2 = conductor({ id: 'c2', disponible: false });

    const res = elegirConductor(pedido(), [c1, c2]);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.motivo).toBe('sin_conductor_disponible');
  });

  it('devuelve sin_conductor_disponible cuando todos están inactivos', () => {
    const c1 = conductor({ id: 'c1', estado: 'inactivo' });
    const c2 = conductor({ id: 'c2', estado: 'inactivo' });

    const res = elegirConductor(pedido(), [c1, c2]);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.motivo).toBe('sin_conductor_disponible');
  });
});

// =============================================================================
// 5. Sin cupo
// =============================================================================

describe('elegirConductor — sin cupo', () => {
  it('devuelve motivo sin_cupo cuando hay conductores disponibles pero todos llenos', () => {
    const c1 = conductor({ id: 'c1', disponible: true, cargaActual: 30, capacidadParadas: 30 });
    const c2 = conductor({ id: 'c2', disponible: true, cargaActual: 15, capacidadParadas: 15 });

    const res = elegirConductor(pedido(), [c1, c2]);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.motivo).toBe('sin_cupo');
  });
});

// =============================================================================
// 6. Sin zona mapeada en el pedido
// =============================================================================

describe('elegirConductor — pedido sin zona mapeada', () => {
  it('cuando zonaPedido=null, no discrimina por zona y elige por ocupación', () => {
    const c1 = conductor({
      id: 'c1',
      zonasConductor: new Set([ZONA_NORTE]),
      cargaActual: 10,
    });
    const c2 = conductor({
      id: 'c2',
      zonasConductor: new Set(),
      cargaActual: 3, // menor ocupación
    });

    const res = elegirConductor(pedido({ zonaPedido: null }), [c1, c2]);

    expect(res.ok).toBe(true);
    // Sin zona, elige por menor ocupación: c2 (3 < 10)
    if (res.ok) expect(res.conductor.id).toBe('c2');
  });

  it('con zonaPedido=null y todos con misma ocupación, desempate estable por id', () => {
    const c1 = conductor({ id: 'c-zzz', zonasConductor: new Set(), cargaActual: 0 });
    const c2 = conductor({ id: 'c-aaa', zonasConductor: new Set([ZONA_NORTE]), cargaActual: 0 });

    const res = elegirConductor(pedido({ zonaPedido: null }), [c1, c2]);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.conductor.id).toBe('c-aaa');
  });
});

// =============================================================================
// 7. Conductor inactivo con zona preferente no entra al pool
// =============================================================================

describe('elegirConductor — conductor inactivo excluido aunque tenga zona', () => {
  it('ignora un conductor inactivo aunque su zona coincida con la del pedido', () => {
    const inactivo = conductor({
      id: 'inactivo-con-zona',
      estado: 'inactivo',
      zonasConductor: new Set([ZONA_NORTE]),
    });
    const activo = conductor({
      id: 'activo-sin-zona',
      estado: 'activo',
      zonasConductor: new Set([ZONA_SUR]), // zona distinta
      cargaActual: 5,
    });

    const res = elegirConductor(pedido({ zonaPedido: ZONA_NORTE }), [inactivo, activo]);

    // El inactivo no califica — elige el activo aunque sea de otra zona.
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.conductor.id).toBe('activo-sin-zona');
  });
});

// =============================================================================
// 8. Verificar que no muta los candidatos recibidos
// =============================================================================

describe('elegirConductor — no muta los candidatos', () => {
  it('cargaActual del candidato no cambia después de llamar elegirConductor', () => {
    const c = conductor({ id: 'c1', cargaActual: 5 });
    const cargaAntes = c.cargaActual;

    elegirConductor(pedido(), [c]);

    expect(c.cargaActual).toBe(cargaAntes);
  });
});
