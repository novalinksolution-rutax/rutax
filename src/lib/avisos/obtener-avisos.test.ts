/**
 * Tests de `obtenerAvisos` — enfocados en `avisosConsumoPlan` (F2 "Ola 1",
 * banner G), la única fuente nueva de este archivo. El resto de fuentes
 * (conexiones caídas, folios, incidencias, conciliación) no se re-testea aquí
 * — no cambiaron.
 *
 * `crearClienteServiceRole` se mockea para que TODAS las fuentes que no son
 * `avisosConsumoPlan` devuelvan `data: []`/`null` (silenciosas, sin avisos) —
 * así cada test queda enfocado exclusivamente en el banner de consumo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/modules/plataforma/enforcement', () => ({
  verificarLimite: vi.fn(),
}));

vi.mock('@/modules/plataforma/comunicaciones', () => ({
  obtenerComunicacionesActivasParaCourier: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { verificarLimite } from '@/modules/plataforma/enforcement';
import { obtenerComunicacionesActivasParaCourier } from '@/modules/plataforma/comunicaciones';
import { obtenerAvisos, type Aviso } from './obtener-avisos';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import type { ResultadoLimite } from '@/modules/plataforma/enforcement';

/** Doble de Supabase silencioso: cualquier query resuelve vacío, sin lanzar. */
function crearClienteSilencioso() {
  const builder: Record<string, unknown> = {
    schema: vi.fn(() => builder),
    from: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    in: vi.fn(() => builder),
    not: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
  };
  return builder;
}

const dueno: UsuarioActual = {
  tenantId: 'tenant-a',
  rol: 'dueno',
  tipoUsuario: 'interno',
  estado: 'activo',
  sellerId: null,
  driverId: null,
};

/** Supervisor: NO tiene `gestionar_suscripcion` — no debe disparar el banner. */
const supervisor: UsuarioActual = { ...dueno, rol: 'supervisor' };

function resultadoLimite(overrides: Partial<ResultadoLimite> = {}): ResultadoLimite {
  return { permitido: true, motivo: 'ok', usoActual: 0, limite: null, porcentaje: null, ...overrides };
}

describe('obtenerAvisos — avisosConsumoPlan (F2 "Ola 1", banner G)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearClienteSilencioso() as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    // Silenciosa por defecto — cada test de comunicaciones la sobrescribe.
    vi.mocked(obtenerComunicacionesActivasParaCourier).mockResolvedValue([]);
  });

  it('gateado en gestionar_suscripcion: un rol sin esa capacidad NO dispara verificarLimite ni el banner', async () => {
    const avisos = await obtenerAvisos('tenant-a', supervisor, 'user-1');

    expect(verificarLimite).not.toHaveBeenCalled();
    expect(avisos.find((a) => a.id.startsWith('consumo-plan-'))).toBeUndefined();
  });

  it('por debajo del 80%: sin aviso', async () => {
    vi.mocked(verificarLimite).mockImplementation(async (_tenantId, recurso) =>
      recurso === 'pedidos_mes'
        ? resultadoLimite({ usoActual: 100, limite: 500, porcentaje: 20 })
        : resultadoLimite({ usoActual: 1, limite: 5, porcentaje: 20 }),
    );

    const avisos = await obtenerAvisos('tenant-a', dueno, 'user-1');
    expect(avisos.find((a) => a.id.startsWith('consumo-plan-'))).toBeUndefined();
  });

  it('pedidos_mes al 80-99%: aviso "importante", href a /configuracion/plan', async () => {
    vi.mocked(verificarLimite).mockImplementation(async (_tenantId, recurso) =>
      recurso === 'pedidos_mes'
        ? resultadoLimite({ usoActual: 425, limite: 500, porcentaje: 85 })
        : resultadoLimite({ usoActual: 1, limite: 5, porcentaje: 20 }),
    );

    const avisos = await obtenerAvisos('tenant-a', dueno, 'user-1');
    const aviso = avisos.find((a) => a.id === 'consumo-plan-pedidos-80');

    expect(aviso).toBeDefined();
    expect(aviso).toMatchObject({ urgencia: 'importante', href: '/configuracion/plan' });
  });

  it('pedidos_mes en/sobre el 100%: aviso "urgente" (reemplaza al de 80%, no ambos)', async () => {
    vi.mocked(verificarLimite).mockImplementation(async (_tenantId, recurso) =>
      recurso === 'pedidos_mes'
        ? resultadoLimite({ usoActual: 600, limite: 500, porcentaje: 120 })
        : resultadoLimite({ usoActual: 1, limite: 5, porcentaje: 20 }),
    );

    const avisos = await obtenerAvisos('tenant-a', dueno, 'user-1');
    const consumoAvisos = avisos.filter((a) => a.id.startsWith('consumo-plan-pedidos'));

    expect(consumoAvisos).toHaveLength(1);
    expect(consumoAvisos[0]).toMatchObject({ id: 'consumo-plan-pedidos-100', urgencia: 'urgente' });
  });

  it('conductores al 100%: aviso "urgente" propio, independiente del de pedidos', async () => {
    vi.mocked(verificarLimite).mockImplementation(async (_tenantId, recurso) =>
      recurso === 'conductores'
        ? resultadoLimite({ usoActual: 5, limite: 5, porcentaje: 100 })
        : resultadoLimite({ usoActual: 10, limite: 500, porcentaje: 2 }),
    );

    const avisos = await obtenerAvisos('tenant-a', dueno, 'user-1');
    const aviso = avisos.find((a) => a.id === 'consumo-plan-conductores-100');

    expect(aviso).toBeDefined();
    expect(aviso).toMatchObject({ urgencia: 'urgente', href: '/configuracion/plan' });
  });

  it('límite null (ilimitado) o sin suscripción: nunca dispara el banner', async () => {
    vi.mocked(verificarLimite).mockResolvedValue(
      resultadoLimite({ motivo: 'sin_suscripcion', limite: null, porcentaje: null }),
    );

    const avisos = await obtenerAvisos('tenant-a', dueno, 'user-1');
    expect(avisos.find((a) => a.id.startsWith('consumo-plan-'))).toBeUndefined();
  });

  it('si verificarLimite lanza, el banner se omite silenciosamente (no tumba el resto de avisos)', async () => {
    vi.mocked(verificarLimite).mockRejectedValue(new Error('boom'));

    await expect(obtenerAvisos('tenant-a', dueno, 'user-1')).resolves.toEqual([]);
  });
});

describe('obtenerAvisos — comunicaciones de Rutax (F3, Gap 7)', () => {
  const comunicacionMock: Aviso = {
    id: 'comunicacion-com-1',
    urgencia: 'urgente',
    titulo: 'Mantención el sábado',
    descripcion: 'De 02:00 a 04:00.',
    href: '#',
    accion: 'Entendido',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearClienteSilencioso() as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
  });

  it('incluye las comunicaciones activas SIN gate de capacidad (rol supervisor también las ve)', async () => {
    vi.mocked(obtenerComunicacionesActivasParaCourier).mockResolvedValue([comunicacionMock]);

    const avisosDueno = await obtenerAvisos('tenant-a', dueno, 'user-1');
    const avisosSupervisor = await obtenerAvisos('tenant-a', supervisor, 'user-1');

    expect(avisosDueno).toContainEqual(comunicacionMock);
    expect(avisosSupervisor).toContainEqual(comunicacionMock);
  });

  it('sin comunicaciones activas → no agrega nada (la fuente ya es defensiva por su cuenta)', async () => {
    vi.mocked(obtenerComunicacionesActivasParaCourier).mockResolvedValue([]);

    const avisos = await obtenerAvisos('tenant-a', dueno, 'user-1');
    expect(avisos.find((a) => a.id.startsWith('comunicacion-'))).toBeUndefined();
  });
});
