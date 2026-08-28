/**
 * `actualizarVehiculoConductor` — el vehículo del conductor (moto o auto).
 *
 * Lo que se fija acá, y por qué cada cosa importa:
 *
 * · **RBAC**: exige `asignar_y_reasignar_pedidos`. Es la misma capacidad que
 *   gobierna el cupo y las zonas, porque es la misma decisión: con qué reparte
 *   el coordinador. `administracion` NO la tiene.
 *
 * · **Bitácora ANTES del efecto**, y con autor. No es una acción financiera,
 *   pero es una afirmación del courier sobre una persona —«este anda en
 *   moto»— y la regla del proyecto es que ese «quién» quede escrito.
 *
 * · **Las DOS condiciones en el `update`.** Corre con `service_role`, así que
 *   la RLS no está de respaldo: sin el `tenant_id`, un id de conductor de otro
 *   courier bastaría para escribirle encima.
 *
 * · **`null` es un valor legítimo**, no un fallo de validación. Es «sin
 *   declarar», y se puede volver a él: un `auto` marcado por error tiene que
 *   poder deshacerse, no solo cambiarse por otro valor equivocado.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { actualizarVehiculoConductor, esVehiculoConductor } from './conductores';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import { ErrorValidacion } from '@/modules/identidad/errores';
import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";

const coordinador: UsuarioActual = {
  tenantId: 'tenant-a',
  rol: 'coordinador',
  tipoUsuario: 'interno',
  estado: 'activo',
  areasHabilitadas: [...AREAS_PRODUCTO],
  sellerId: null,
  driverId: null,
};

const administracion: UsuarioActual = { ...coordinador, rol: 'administracion' };

/** Doble encadenable con un `.update(…).eq().eq().select().maybeSingle()`. */
function crearClienteStub(respuesta: { data: unknown; error: unknown }) {
  const updates: unknown[] = [];
  const filtros: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {
    schema: vi.fn(() => builder),
    from: vi.fn(() => builder),
    update: vi.fn((payload: unknown) => {
      updates.push(payload);
      return builder;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      filtros.push([col, val]);
      return builder;
    }),
    select: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(respuesta)),
  };
  return { cliente: builder as unknown as SupabaseClient, updates, filtros };
}

const OK = { data: { id: 'cond-1' }, error: null };

describe('actualizarVehiculoConductor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rechaza a quien no puede asignar, y no toca nada', async () => {
    const { cliente, updates } = crearClienteStub(OK);

    await expect(
      actualizarVehiculoConductor(cliente, 'tenant-a', 'cond-1', 'moto', 'user-1', administracion),
    ).rejects.toThrow(ErrorValidacion);

    expect(registrarEnBitacora).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('escribe el vehículo filtrando por conductor Y por tenant', async () => {
    const { cliente, updates, filtros } = crearClienteStub(OK);

    await actualizarVehiculoConductor(cliente, 'tenant-a', 'cond-1', 'auto', 'user-1', coordinador);

    expect(updates).toEqual([{ vehiculo: 'auto' }]);
    // La contraprueba de la barrera: si alguien quita el `.eq('tenant_id')`
    // este test cae, y sin él un id de otro courier se escribiría igual.
    expect(filtros).toEqual([
      ['id', 'cond-1'],
      ['tenant_id', 'tenant-a'],
    ]);
  });

  it('`null` borra la declaración, y no es un error de validación', async () => {
    const { cliente, updates } = crearClienteStub(OK);

    await actualizarVehiculoConductor(cliente, 'tenant-a', 'cond-1', null, 'user-1', coordinador);

    expect(updates).toEqual([{ vehiculo: null }]);
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({ accion: 'conductor.vehiculo_borrado' }),
    );
  });

  it('deja el «quién» en la bitácora, ANTES de escribir', async () => {
    const orden: string[] = [];
    vi.mocked(registrarEnBitacora).mockImplementation(async () => {
      orden.push('bitacora');
    });
    const { cliente } = crearClienteStub(OK);
    (cliente as unknown as { update: ReturnType<typeof vi.fn> }).update = vi.fn(() => {
      orden.push('update');
      return cliente;
    });

    await actualizarVehiculoConductor(cliente, 'tenant-a', 'cond-1', 'moto', 'user-9', coordinador);

    expect(orden).toEqual(['bitacora', 'update']);
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({
        actorUsuarioId: 'user-9',
        accion: 'conductor.vehiculo_actualizado',
        entidadId: 'cond-1',
      }),
    );
  });

  it('un conductor de otro courier no existe: 0 filas es rechazo, no éxito silencioso', async () => {
    // El `update` de PostgREST que no toca nada NO devuelve error. Sin esta
    // comprobación la pantalla diría «guardado» y el dato no estaría.
    const { cliente } = crearClienteStub({ data: null, error: null });

    await expect(
      actualizarVehiculoConductor(cliente, 'tenant-a', 'cond-de-b', 'moto', 'user-1', coordinador),
    ).rejects.toThrow(/no existe en este courier/i);
  });

  it('un valor inventado se rechaza antes de llegar a la base', async () => {
    const { cliente, updates } = crearClienteStub(OK);

    await expect(
      actualizarVehiculoConductor(
        cliente,
        'tenant-a',
        'cond-1',
        // @ts-expect-error — valor inválido deliberado: el enum de la base lo
        // rechazaría igual, pero con un 22P02 crudo en vez de un mensaje.
        'camion',
        'user-1',
        coordinador,
      ),
    ).rejects.toThrow(ErrorValidacion);

    expect(updates).toHaveLength(0);
  });
});

describe('esVehiculoConductor', () => {
  it('acepta los dos valores y nada más', () => {
    expect(esVehiculoConductor('moto')).toBe(true);
    expect(esVehiculoConductor('auto')).toBe(true);
    expect(esVehiculoConductor('camion')).toBe(false);
    expect(esVehiculoConductor('')).toBe(false);
    expect(esVehiculoConductor(null)).toBe(false);
    expect(esVehiculoConductor(undefined)).toBe(false);
  });
});
