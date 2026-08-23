/**
 * Recuperar un movimiento descartado. Las guardas.
 *
 * La que importa: **vuelve a `sin_atribuir`, no al estado que tenía antes**.
 * Un movimiento que estuvo `parcial` o `atribuido` y se descartó ya perdió su
 * atribución; restaurar ese estado lo haría figurar imputado a un período sin
 * nada que lo respalde.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorValidacion } from '@/modules/identidad/errores';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/lib/inngest/cliente', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { recuperarPagoDescartado } from './acciones';

const MOTIVO = 'Era una cobranza, la descarté por error';

function usuarioConRol(rol: UsuarioActual['rol']): UsuarioActual {
  return {
    tenantId: 'tenant-a',
    tipoUsuario: 'interno',
    sellerId: null,
    driverId: null,
    rol,
    estado: 'activo',
  };
}

function crearMock(estadoMatch: string | null) {
  const update = vi.fn().mockReturnThis();
  return {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update,
    maybeSingle: vi.fn().mockResolvedValue({
      data:
        estadoMatch === null
          ? null
          : { id: 'pago-1', tenant_id: 'tenant-a', estado_match: estadoMatch },
      error: null,
    }),
  };
}

function montar(mock: ReturnType<typeof crearMock>) {
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    mock as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
}

describe('recuperarPagoDescartado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('el conductor no puede: es capacidad de conciliación', async () => {
    montar(crearMock('descartado'));
    await expect(
      recuperarPagoDescartado('tenant-a', 'pago-1', MOTIVO, usuarioConRol('conductor'), 'actor-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('sin motivo no se recupera', async () => {
    montar(crearMock('descartado'));
    await expect(
      recuperarPagoDescartado('tenant-a', 'pago-1', '   ', usuarioConRol('dueno'), 'actor-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('un movimiento que NO está descartado no se toca', async () => {
    const mock = crearMock('conciliado');
    montar(mock);
    await expect(
      recuperarPagoDescartado('tenant-a', 'pago-1', MOTIVO, usuarioConRol('dueno'), 'actor-1'),
    ).rejects.toThrow(/no está descartado/i);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('un pago de otro tenant no existe', async () => {
    montar(crearMock(null));
    await expect(
      recuperarPagoDescartado('tenant-a', 'pago-1', MOTIVO, usuarioConRol('dueno'), 'actor-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('vuelve a `sin_atribuir`, NUNCA al estado anterior', async () => {
    const mock = crearMock('descartado');
    montar(mock);
    await recuperarPagoDescartado('tenant-a', 'pago-1', MOTIVO, usuarioConRol('dueno'), 'actor-1');
    expect(mock.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado_match: 'sin_atribuir' }),
    );
    // La guarda de carrera también en la BD.
    expect(mock.eq).toHaveBeenCalledWith('estado_match', 'descartado');
  });

  it('la bitácora queda ANTES de escribir el estado, con el motivo', async () => {
    const mock = crearMock('descartado');
    montar(mock);
    const orden: string[] = [];
    vi.mocked(registrarEnBitacora).mockImplementation(async () => {
      orden.push('bitacora');
    });
    mock.update.mockImplementation(() => {
      orden.push('update');
      return mock;
    });

    await recuperarPagoDescartado('tenant-a', 'pago-1', MOTIVO, usuarioConRol('dueno'), 'actor-1');

    expect(orden).toEqual(['bitacora', 'update']);
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accion: 'dinero.pago_recuperado',
        entidadTipo: 'pago_recibido',
        detalle: expect.objectContaining({ motivo: MOTIVO }),
      }),
    );
  });
});
