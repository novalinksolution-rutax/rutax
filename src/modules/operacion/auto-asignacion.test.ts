/**
 * Pruebas del módulo de auto-asignación heurística (F6, ítem 1.3).
 *
 * Dos bloques:
 *   A. La heurística pura `elegirConductor` — sin I/O, sin mocks de Supabase.
 *      `marcarConductorNoDisponibleYRedistribuir` (la acción de servidor que
 *      la envuelve) requiere un doble de BD más complejo y se prueba en
 *      integración.
 *   B. `obtenerCargaPoolDelDia` — el conteo de carga que consume esa acción.
 *      Sí se prueba acá con un doble mínimo de Supabase porque es la única
 *      pieza con I/O que vale la pena aislar: antes de la corrección sumaba
 *      TODO el histórico de asignaciones activas (sin filtro de fecha ni de
 *      estado del pedido), no solo la carga real de hoy.
 *
 * Escenarios cubiertos en A:
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
import { elegirConductor, obtenerCargaPoolDelDia } from './auto-asignacion';
import type { ConductorCandidato, PedidoConZona } from './auto-asignacion';
import { ESTADOS_TERMINALES_PEDIDO } from './metricas';

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
    // Sin declarar: el vehículo NO entra en la heurística, así que los casos de
    // esta suite no lo fijan. Si algún día pesara, estas pruebas tendrían que
    // decir cuál lleva cada uno — y que hoy no haga falta es la prueba de que
    // no pesa.
    vehiculo: null,
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

// =============================================================================
// B. obtenerCargaPoolDelDia — doble mínimo de Supabase
// =============================================================================

interface FilaAsignacionFalsa {
  tenant_id: string;
  driver_id: string;
  pedido_id: string;
  activa: boolean;
}

interface FilaPedidoFalso {
  estado: string;
  fecha_compromiso: string;
}

type FiltroFalso =
  | { tipo: 'eq'; col: string; val: unknown }
  | { tipo: 'in'; col: string; val: readonly unknown[] }
  | { tipo: 'not-in'; col: string; val: readonly string[] };

/**
 * Doble mínimo de Supabase — SOLO soporta la consulta real de
 * `obtenerCargaPoolDelDia`: `.schema('operacion').from('asignaciones_pedido')
 * .select('driver_id, pedidos!inner(...)').eq().eq().in().eq().not()`.
 *
 * Simula `pedidos!inner(...)`: una asignación sin pedido casado en el seed
 * se descarta (igual que un INNER JOIN real), no se cuela con el embebido
 * en null como pasaría con un LEFT JOIN sin `!inner`.
 */
function crearClienteFalsoCarga(seed: {
  asignaciones: FilaAsignacionFalsa[];
  pedidos: Record<string, FilaPedidoFalso>;
}) {
  function valorDeColumna(fila: FilaAsignacionFalsa, col: string): unknown {
    switch (col) {
      case 'tenant_id':
        return fila.tenant_id;
      case 'activa':
        return fila.activa;
      case 'driver_id':
        return fila.driver_id;
      case 'pedidos.fecha_compromiso':
        return seed.pedidos[fila.pedido_id]?.fecha_compromiso;
      case 'pedidos.estado':
        return seed.pedidos[fila.pedido_id]?.estado;
      default:
        throw new Error(`Columna no soportada en el doble de prueba: ${col}`);
    }
  }

  function from(tabla: string) {
    if (tabla !== 'asignaciones_pedido') {
      throw new Error(`Tabla no soportada en el doble de prueba: ${tabla}`);
    }

    return {
      select(_cols: string) {
        const filtros: FiltroFalso[] = [];
        // La consulta real va PAGINADA (`leerTodasLasFilas`), porque PostgREST
        // corta en 1.000 filas sin avisar y una carga truncada subestima al
        // conductor saturado. El doble tiene que respetar el mismo troceo: si
        // devolviera siempre todo, la prueba pasaría con una implementación
        // que en producción se trunca en silencio.
        let rango: { desde: number; hasta: number } | null = null;

        const builder = {
          range(desde: number, hasta: number) {
            rango = { desde, hasta };
            return builder;
          },
          eq(col: string, val: unknown) {
            filtros.push({ tipo: 'eq', col, val });
            return builder;
          },
          in(col: string, val: readonly unknown[]) {
            filtros.push({ tipo: 'in', col, val });
            return builder;
          },
          not(col: string, op: string, val: string) {
            if (op !== 'in') throw new Error(`Operador not() no soportado en el doble: ${op}`);
            const lista = val.replace(/^\(/, '').replace(/\)$/, '').split(',');
            filtros.push({ tipo: 'not-in', col, val: lista });
            return builder;
          },
          then(resolve: (r: { data: Array<{ driver_id: string }>; error: null }) => void) {
            const filas = seed.asignaciones
              // pedidos!inner(...): descarta asignaciones sin pedido casado.
              .filter((a) => seed.pedidos[a.pedido_id] !== undefined)
              .filter((a) =>
                filtros.every((f) => {
                  const valor = valorDeColumna(a, f.col);
                  if (f.tipo === 'eq') return valor === f.val;
                  if (f.tipo === 'in') return f.val.includes(valor);
                  return !f.val.includes(String(valor));
                }),
              )
              .map((a) => ({ driver_id: a.driver_id }));

            // `range` es inclusivo en ambos extremos, como el de PostgREST.
            const ventana = rango ? filas.slice(rango.desde, rango.hasta + 1) : filas;
            // Y EL TOPE DE 1.000 FILAS, que es lo que hace honesta a la prueba:
            // sin esto, el doble devolvería todo de una y una implementación que
            // en producción se trunca en silencio pasaría igual de verde.
            resolve({ data: ventana.slice(0, 1000), error: null });
          },
        };

        return builder;
      },
    };
  }

  return { schema: (_esquema: string) => ({ from }) } as never;
}

const D1 = 'dddd0000-0000-0000-0000-000000000101';
const D2 = 'dddd0000-0000-0000-0000-000000000102';
const HOY = '2026-08-14';
const HACE_13_DIAS = '2026-08-01';

describe('obtenerCargaPoolDelDia', () => {
  it('no cuenta asignaciones activas de pedidos ya entregados en días pasados', async () => {
    const pedidoViejoEntregado = 'pppp0000-0000-0000-0000-000000000901';
    const pedidoHoyAsignado = 'pppp0000-0000-0000-0000-000000000902';

    const cliente = crearClienteFalsoCarga({
      asignaciones: [
        // Sigue activa=true (nunca se apaga al entregar — es la decisión
        // vigente, no una deuda) pero es de hace 13 días y ya se entregó.
        { tenant_id: TENANT, driver_id: D1, pedido_id: pedidoViejoEntregado, activa: true },
        // Del día que se está redistribuyendo, y realmente pendiente.
        { tenant_id: TENANT, driver_id: D1, pedido_id: pedidoHoyAsignado, activa: true },
      ],
      pedidos: {
        [pedidoViejoEntregado]: { estado: 'entregado', fecha_compromiso: HACE_13_DIAS },
        [pedidoHoyAsignado]: { estado: 'asignado', fecha_compromiso: HOY },
      },
    });

    const mapaCarga = await obtenerCargaPoolDelDia(cliente, TENANT, [D1, D2], HOY);

    // Antes del fix esto daba 2 (contaba también el pedido viejo entregado).
    expect(mapaCarga.get(D1)).toBe(1);
    expect(mapaCarga.get(D2)).toBeUndefined();
  });

  it('cuenta pedidos de hoy en cualquier estado abierto (pendiente_asignacion, asignado, en_ruta)', async () => {
    const pPendiente = 'pppp0000-0000-0000-0000-000000000903';
    const pAsignado = 'pppp0000-0000-0000-0000-000000000904';
    const pEnRuta = 'pppp0000-0000-0000-0000-000000000905';

    const cliente = crearClienteFalsoCarga({
      asignaciones: [
        { tenant_id: TENANT, driver_id: D1, pedido_id: pPendiente, activa: true },
        { tenant_id: TENANT, driver_id: D1, pedido_id: pAsignado, activa: true },
        { tenant_id: TENANT, driver_id: D1, pedido_id: pEnRuta, activa: true },
      ],
      pedidos: {
        [pPendiente]: { estado: 'pendiente_asignacion', fecha_compromiso: HOY },
        [pAsignado]: { estado: 'asignado', fecha_compromiso: HOY },
        [pEnRuta]: { estado: 'en_ruta', fecha_compromiso: HOY },
      },
    });

    const mapaCarga = await obtenerCargaPoolDelDia(cliente, TENANT, [D1], HOY);

    expect(mapaCarga.get(D1)).toBe(3);
  });

  it('no cuenta ningún estado de ESTADOS_TERMINALES_PEDIDO aunque sea de hoy', async () => {
    for (const estadoTerminal of ESTADOS_TERMINALES_PEDIDO) {
      const pedidoId = `pppp-terminal-${estadoTerminal}`;

      const cliente = crearClienteFalsoCarga({
        asignaciones: [{ tenant_id: TENANT, driver_id: D1, pedido_id: pedidoId, activa: true }],
        pedidos: { [pedidoId]: { estado: estadoTerminal, fecha_compromiso: HOY } },
      });

      const mapaCarga = await obtenerCargaPoolDelDia(cliente, TENANT, [D1], HOY);

      expect(mapaCarga.get(D1), `estado '${estadoTerminal}' no debería contar`).toBeUndefined();
    }
  });

  it('no cuenta pedidos de otra fecha aunque estén realmente pendientes', async () => {
    const pedidoManana = 'pppp0000-0000-0000-0000-000000000906';

    const cliente = crearClienteFalsoCarga({
      asignaciones: [{ tenant_id: TENANT, driver_id: D1, pedido_id: pedidoManana, activa: true }],
      pedidos: { [pedidoManana]: { estado: 'asignado', fecha_compromiso: '2026-08-15' } },
    });

    const mapaCarga = await obtenerCargaPoolDelDia(cliente, TENANT, [D1], HOY);

    expect(mapaCarga.get(D1)).toBeUndefined();
  });

  it('cuenta MÁS DE UNA PÁGINA: no se trunca en las 1.000 filas de PostgREST', async () => {
    // El tope de PostgREST es 1.000 filas y no avisa cuando corta. Una carga
    // truncada hace ver libre a un conductor saturado, y la redistribución le
    // encaja todavía más — el mismo defecto que esta función arregla, apareciendo
    // otra vez al volumen al que apunta el alcance (1.000+ pedidos/día).
    const TOTAL = 1001;
    const asignaciones: FilaAsignacionFalsa[] = [];
    const pedidos: Record<string, FilaPedidoFalso> = {};

    for (let i = 0; i < TOTAL; i++) {
      const pedidoId = `pppp0000-0000-0000-0000-${String(i).padStart(12, '0')}`;
      asignaciones.push({ tenant_id: TENANT, driver_id: D1, pedido_id: pedidoId, activa: true });
      pedidos[pedidoId] = { estado: 'asignado', fecha_compromiso: HOY };
    }

    const cliente = crearClienteFalsoCarga({ asignaciones, pedidos });
    const mapaCarga = await obtenerCargaPoolDelDia(cliente, TENANT, [D1], HOY);

    // Sin paginar, esto daría 1.000 y nadie se enteraría del que falta.
    expect(mapaCarga.get(D1)).toBe(TOTAL);
  });

  it('no cuenta asignaciones activas de otro tenant (aislamiento)', async () => {
    const OTRO_TENANT = 'bbbb2222-0000-0000-0000-000000000002';
    const pedidoOtroTenant = 'pppp0000-0000-0000-0000-000000000907';

    const cliente = crearClienteFalsoCarga({
      asignaciones: [
        { tenant_id: OTRO_TENANT, driver_id: D1, pedido_id: pedidoOtroTenant, activa: true },
      ],
      pedidos: { [pedidoOtroTenant]: { estado: 'asignado', fecha_compromiso: HOY } },
    });

    const mapaCarga = await obtenerCargaPoolDelDia(cliente, TENANT, [D1], HOY);

    expect(mapaCarga.get(D1)).toBeUndefined();
  });

  it('devuelve un mapa vacío sin consultar la BD cuando driverIds está vacío', async () => {
    const cliente = { schema: () => { throw new Error('no debería consultarse'); } } as never;

    const mapaCarga = await obtenerCargaPoolDelDia(cliente, TENANT, [], HOY);

    expect(mapaCarga.size).toBe(0);
  });
});
