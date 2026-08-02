/**
 * Tests de `consultarBitacoraPlataforma` (gap 5 — visor de bitácora de
 * plataforma). Cubre:
 * - Resolución de nombres: super-admin conocido, fallback a
 *   `identidad.usuarios_perfil` para actores `usuario`, `null` si no se
 *   resuelve ninguno (p. ej. actor `sistema`).
 * - Resolución de `nombreFantasiaTenant` para filas con tenant.
 * - Filtros (tenantId/accion/actorUsuarioId/desde/hasta) llegan como `.eq()`/
 *   `.gte()`/`.lte()` a la query de la bitácora.
 * - Guard rails de paginación (límite clamped a [1, 500], offset >= 0).
 * - Camino vacío: sin filas, no se disparan las queries de resolución de
 *   nombres (evita 2 queries innecesarias).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { consultarBitacoraPlataforma } from './bitacora-consulta';

interface Respuesta {
  data: unknown;
  error: unknown;
  count?: number;
}

/** Cliente falso que enruta por nombre de tabla (independiente del schema) y
 *  registra cada llamada de filtro/orden/paginación para poder inspeccionarla. */
function crearClienteMultiTabla(respuestas: Record<string, Respuesta>) {
  const llamadas: Record<string, Array<{ metodo: string; args: unknown[] }>> = {};

  const cliente = {
    schema: vi.fn(() => ({
      from: vi.fn((tabla: string) => {
        const respuesta = respuestas[tabla] ?? { data: [], error: null };
        const registrar = (metodo: string, args: unknown[]) => {
          llamadas[tabla] = llamadas[tabla] ?? [];
          llamadas[tabla]!.push({ metodo, args });
        };
        const builder: Record<string, unknown> = {
          select: vi.fn((...args: unknown[]) => {
            registrar('select', args);
            return builder;
          }),
          eq: vi.fn((...args: unknown[]) => {
            registrar('eq', args);
            return builder;
          }),
          gte: vi.fn((...args: unknown[]) => {
            registrar('gte', args);
            return builder;
          }),
          lte: vi.fn((...args: unknown[]) => {
            registrar('lte', args);
            return builder;
          }),
          in: vi.fn((...args: unknown[]) => {
            registrar('in', args);
            return builder;
          }),
          order: vi.fn((...args: unknown[]) => {
            registrar('order', args);
            return builder;
          }),
          range: vi.fn((...args: unknown[]) => {
            registrar('range', args);
            return Promise.resolve(respuesta);
          }),
          // Fallback para queries que NO terminan en `.range()` (las de
          // resolución de nombres, que terminan en `.in()`).
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(respuesta).then(resolve, reject),
        };
        return builder;
      }),
    })),
  };

  return { cliente, llamadas };
}

const FILA_BASE = {
  id: 1,
  tenant_id: 'tenant-a',
  actor_usuario_id: 'ad000000-0000-0000-0000-000000000001',
  actor_tipo: 'super_admin',
  accion: 'plataforma.suscripcion_activada',
  entidad_tipo: 'suscripcion',
  entidad_id: 'susc-1',
  detalle: { estado_anterior: 'trial' },
  creado_en: '2026-07-11T10:00:00.000Z',
};

describe('consultarBitacoraPlataforma', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin filas: devuelve vacío y NO dispara las queries de resolución de nombres/tenants', async () => {
    const { cliente, llamadas } = crearClienteMultiTabla({
      bitacora_auditoria: { data: [], error: null, count: 0 },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await consultarBitacoraPlataforma();

    expect(resultado).toEqual({ filas: [], total: 0 });
    expect(llamadas.super_admins).toBeUndefined();
    expect(llamadas.tenants).toBeUndefined();
  });

  it('resuelve el nombre del actor cuando es un super-admin conocido, y el nombre_fantasia del tenant', async () => {
    const { cliente } = crearClienteMultiTabla({
      bitacora_auditoria: { data: [FILA_BASE], error: null, count: 1 },
      super_admins: {
        data: [{ usuario_id: 'ad000000-0000-0000-0000-000000000001', nombre: 'Fundador Rutax' }],
        error: null,
      },
      tenants: { data: [{ id: 'tenant-a', nombre_fantasia: 'Despachos del Centro' }], error: null },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await consultarBitacoraPlataforma();

    expect(resultado.total).toBe(1);
    expect(resultado.filas).toHaveLength(1);
    expect(resultado.filas[0]).toMatchObject({
      id: 1,
      accion: 'plataforma.suscripcion_activada',
      actorTipo: 'super_admin',
      actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
      actorNombre: 'Fundador Rutax',
      tenantId: 'tenant-a',
      nombreFantasiaTenant: 'Despachos del Centro',
      detalle: { estado_anterior: 'trial' },
    });
  });

  it('actor NO encontrado en super_admins pero SÍ en usuarios_perfil (actor usuario interno) → fallback resuelto', async () => {
    const filaUsuario = {
      ...FILA_BASE,
      id: 2,
      actor_usuario_id: 'user-interno-1',
      actor_tipo: 'usuario',
      accion: 'tenant.usuario_invitado',
    };
    const { cliente } = crearClienteMultiTabla({
      bitacora_auditoria: { data: [filaUsuario], error: null, count: 1 },
      super_admins: { data: [], error: null }, // no coincide
      usuarios_perfil: { data: [{ id: 'user-interno-1', nombre_completo: 'Ana Pérez' }], error: null },
      tenants: { data: [{ id: 'tenant-a', nombre_fantasia: 'Despachos del Centro' }], error: null },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await consultarBitacoraPlataforma();

    expect(resultado.filas[0]!.actorNombre).toBe('Ana Pérez');
  });

  it('actor sistema (actor_usuario_id null) → actorNombre null, sin tocar las tablas de nombres', async () => {
    const filaSistema = {
      ...FILA_BASE,
      id: 3,
      tenant_id: null,
      actor_usuario_id: null,
      actor_tipo: 'sistema',
      accion: 'plataforma.pago_suscripcion_confirmado',
    };
    const { cliente, llamadas } = crearClienteMultiTabla({
      bitacora_auditoria: { data: [filaSistema], error: null, count: 1 },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await consultarBitacoraPlataforma();

    expect(resultado.filas[0]!.actorNombre).toBeNull();
    expect(resultado.filas[0]!.tenantId).toBeNull();
    expect(resultado.filas[0]!.nombreFantasiaTenant).toBeNull();
    // Sin actores/tenants que resolver → no debería consultar esas tablas.
    expect(llamadas.super_admins).toBeUndefined();
    expect(llamadas.usuarios_perfil).toBeUndefined();
    expect(llamadas.tenants).toBeUndefined();
  });

  it('aplica los filtros tenantId/accion/actorUsuarioId/desde/hasta como eq/gte/lte sobre la bitácora', async () => {
    const { cliente, llamadas } = crearClienteMultiTabla({
      bitacora_auditoria: { data: [], error: null, count: 0 },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    await consultarBitacoraPlataforma({
      tenantId: 'tenant-a',
      accion: 'plataforma.plan_asignado',
      actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
      desde: '2026-07-01',
      hasta: '2026-07-31',
    });

    const llamadasBitacora = llamadas.bitacora_auditoria ?? [];
    expect(llamadasBitacora).toContainEqual({ metodo: 'eq', args: ['tenant_id', 'tenant-a'] });
    expect(llamadasBitacora).toContainEqual({ metodo: 'eq', args: ['accion', 'plataforma.plan_asignado'] });
    expect(llamadasBitacora).toContainEqual({
      metodo: 'eq',
      args: ['actor_usuario_id', 'ad000000-0000-0000-0000-000000000001'],
    });
    expect(llamadasBitacora).toContainEqual({ metodo: 'gte', args: ['creado_en', '2026-07-01'] });
    expect(llamadasBitacora).toContainEqual({ metodo: 'lte', args: ['creado_en', '2026-07-31'] });
  });

  it('guard rails de paginación: límite se acota a [1, 500] y offset a >= 0', async () => {
    const { cliente, llamadas } = crearClienteMultiTabla({
      bitacora_auditoria: { data: [], error: null, count: 0 },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    await consultarBitacoraPlataforma({ limite: 10_000, offset: -5 });

    const rangeCall = (llamadas.bitacora_auditoria ?? []).find((l) => l.metodo === 'range');
    expect(rangeCall?.args).toEqual([0, 499]); // offset clamped a 0, límite clamped a 500 → range(0, 499)
  });

  it('límite por defecto es 100 y offset por defecto es 0', async () => {
    const { cliente, llamadas } = crearClienteMultiTabla({
      bitacora_auditoria: { data: [], error: null, count: 0 },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    await consultarBitacoraPlataforma();

    const rangeCall = (llamadas.bitacora_auditoria ?? []).find((l) => l.metodo === 'range');
    expect(rangeCall?.args).toEqual([0, 99]);
  });

  it('error al leer la bitácora → lanza', async () => {
    const { cliente } = crearClienteMultiTabla({
      bitacora_auditoria: { data: null, error: { message: 'boom' } },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    await expect(consultarBitacoraPlataforma()).rejects.toThrow(/error al consultar bitácora/i);
  });

  it('no re-filtra `detalle` (ya viene saneado del escritor) — lo pasa tal cual', async () => {
    const filaConDetalle = { ...FILA_BASE, id: 4, detalle: { monto_clp: 19990, metodo: 'transferencia_manual' } };
    const { cliente } = crearClienteMultiTabla({
      bitacora_auditoria: { data: [filaConDetalle], error: null, count: 1 },
      super_admins: {
        data: [{ usuario_id: 'ad000000-0000-0000-0000-000000000001', nombre: 'Fundador Rutax' }],
        error: null,
      },
      tenants: { data: [{ id: 'tenant-a', nombre_fantasia: 'Despachos del Centro' }], error: null },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente as unknown as ReturnType<typeof crearClienteServiceRole>);

    const resultado = await consultarBitacoraPlataforma();

    expect(resultado.filas[0]!.detalle).toEqual({ monto_clp: 19990, metodo: 'transferencia_manual' });
  });
});
