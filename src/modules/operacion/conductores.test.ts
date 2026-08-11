/**
 * Tests de `crearConductor` (F2 "Ola 1", ítem G2 — chokepoint del gate
 * `conductores_max` del plan).
 *
 * Cubre:
 * - RBAC: rechaza sin `asignar_y_reasignar_pedidos`.
 * - Validación: RUT inválido (formato/DV), nombre vacío, tipo_relacion inválido.
 * - Gate de límite: bloqueo tipado (NO throw) cuando el plan está en su tope;
 *   alta permitida cuando hay cupo, cuando el límite es `null` (ilimitado) y
 *   cuando el tenant no tiene suscripción (fail-open).
 * - Bitácora ANTES del INSERT, con `actorUsuarioId`.
 * - Bitácora escrita con el cliente `service_role` y NO con el cliente RLS de la
 *   sesión (bug de producción 2026-08-11: "permission denied for view
 *   bitacora_auditoria" — la bitácora es append-only y ningún rol de cliente
 *   tiene INSERT sobre ella). El INSERT del conductor, en cambio, SÍ debe seguir
 *   yendo por el cliente RLS: su aislamiento de tenant lo impone la policy
 *   `conductores_insert_interno`, no la aplicación.
 * - Minimización de PII en la bitácora (Ley 21.431): `entidadId` es el id del
 *   conductor (no el RUT), y `detalle` no lleva el RUT completo ni el nombre
 *   completo.
 * - Conflicto de RUT duplicado (23505) se traduce a `ErrorValidacion`.
 *
 * `verificarLimite` se mockea entero — su propia lógica ya está cubierta en
 * `enforcement.test.ts`; aquí solo importa que `crearConductor` reaccione
 * correctamente a cada resultado posible.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/plataforma/enforcement', () => ({
  verificarLimite: vi.fn(),
}));

// Cliente service_role falso, distinguible del cliente RLS de la sesión: es lo
// que permite afirmar CUÁL de los dos se usa para cada escritura. Se crea dentro
// de la fábrica del mock (no en un const del módulo) porque `vi.mock` se iza por
// sobre las importaciones y una referencia externa quedaría en zona muerta.
vi.mock('@/lib/supabase/service-role', () => {
  const clienteFalso = { esServiceRole: true };
  return { crearClienteServiceRole: vi.fn(() => clienteFalso) };
});

import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { verificarLimite } from '@/modules/plataforma/enforcement';
import { crearConductor } from './conductores';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';
import { ErrorValidacion } from '@/modules/identidad/errores';

const actorConCapacidad: UsuarioActual = {
  tenantId: 'tenant-a',
  rol: 'dueno',
  tipoUsuario: 'interno',
  estado: 'activo',
  sellerId: null,
  driverId: null,
};

const actorSinCapacidad: UsuarioActual = {
  ...actorConCapacidad,
  rol: 'administracion', // financiero, sin `asignar_y_reasignar_pedidos`
};

const DATOS_VALIDOS = {
  nombreCompleto: 'Juan Pérez Soto',
  rut: '12345678-5',
  tipoRelacion: 'independiente' as const,
};

/** Doble encadenable de `SupabaseClient` — un único `.insert()` terminal. */
function crearClienteStub(respuestaInsert: { data: unknown; error: unknown }) {
  const insertPayloads: unknown[] = [];
  const builder: Record<string, unknown> = {
    schema: vi.fn(() => builder),
    from: vi.fn(() => builder),
    insert: vi.fn((payload: unknown) => {
      insertPayloads.push(payload);
      return builder;
    }),
    select: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(respuestaInsert)),
  };
  return { cliente: builder as unknown as SupabaseClient, insertPayloads };
}

describe('crearConductor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rechaza (throw) si el actor no tiene asignar_y_reasignar_pedidos', async () => {
    const { cliente } = crearClienteStub({ data: null, error: null });

    await expect(
      crearConductor(cliente, 'tenant-a', DATOS_VALIDOS, 'user-1', actorSinCapacidad),
    ).rejects.toThrow(ErrorValidacion);

    expect(verificarLimite).not.toHaveBeenCalled();
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it('rechaza (throw) un RUT con dígito verificador inválido', async () => {
    const { cliente } = crearClienteStub({ data: null, error: null });

    await expect(
      crearConductor(
        cliente,
        'tenant-a',
        { ...DATOS_VALIDOS, rut: '12345678-9' }, // DV incorrecto (el correcto es -5)
        'user-1',
        actorConCapacidad,
      ),
    ).rejects.toThrow(/no es válido/i);

    expect(verificarLimite).not.toHaveBeenCalled();
  });

  it('rechaza (throw) nombre vacío/demasiado corto', async () => {
    const { cliente } = crearClienteStub({ data: null, error: null });

    await expect(
      crearConductor(cliente, 'tenant-a', { ...DATOS_VALIDOS, nombreCompleto: 'A' }, 'user-1', actorConCapacidad),
    ).rejects.toThrow(/al menos 2 caracteres/i);
  });

  it('rechaza (throw) tipo_relacion inválido', async () => {
    const { cliente } = crearClienteStub({ data: null, error: null });

    await expect(
      crearConductor(
        cliente,
        'tenant-a',
        // @ts-expect-error — valor inválido deliberado para el test
        { ...DATOS_VALIDOS, tipoRelacion: 'freelance' },
        'user-1',
        actorConCapacidad,
      ),
    ).rejects.toThrow(/dependiente.*independiente/i);
  });

  it('gate de límite: plan en su tope → resultado tipado {ok:false}, SIN throw, SIN bitácora, SIN insert', async () => {
    vi.mocked(verificarLimite).mockResolvedValue({
      permitido: false,
      motivo: 'limite_alcanzado',
      usoActual: 5,
      limite: 5,
      porcentaje: 100,
    });
    const { cliente, insertPayloads } = crearClienteStub({ data: null, error: null });

    const resultado = await crearConductor(cliente, 'tenant-a', DATOS_VALIDOS, 'user-1', actorConCapacidad);

    expect(resultado).toEqual({
      ok: false,
      motivo: 'limite_alcanzado',
      mensaje: expect.stringMatching(/máximo de conductores.*\(5\).*Actualiza tu plan/i),
      usoActual: 5,
      limite: 5,
    });
    expect(registrarEnBitacora).not.toHaveBeenCalled();
    expect(insertPayloads).toHaveLength(0);
  });

  it('con cupo disponible: crea el conductor, bitácora ANTES del insert, con actorUsuarioId', async () => {
    vi.mocked(verificarLimite).mockResolvedValue({
      permitido: true,
      motivo: 'ok',
      usoActual: 2,
      limite: 5,
      porcentaje: 40,
    });
    const filaCreada = {
      id: 'conductor-nuevo',
      tenant_id: 'tenant-a',
      estado: 'activo',
      disponible: true,
      capacidad_paradas: 30,
      nombre_completo: 'Juan Pérez Soto',
      banco: null,
      tipo_cuenta: null,
      numero_cuenta: null,
    };
    const { cliente, insertPayloads } = crearClienteStub({ data: filaCreada, error: null });

    const resultado = await crearConductor(cliente, 'tenant-a', DATOS_VALIDOS, 'user-1', actorConCapacidad);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.conductor.id).toBe('conductor-nuevo');
      expect(resultado.conductor.nombre).toBe('Juan Pérez Soto');
    }

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      // service_role, NO el cliente RLS de la sesión (ver el test de regresión
      // "escribe la bitácora con service_role…" más abajo).
      crearClienteServiceRole(),
      expect.objectContaining({
        tenantId: 'tenant-a',
        actorUsuarioId: 'user-1',
        actorTipo: 'usuario',
        accion: 'conductor.alta',
        entidadTipo: 'conductor',
        // Minimización de PII (Ley 21.431): entidadId es el id generado del
        // conductor (UUID), NO el RUT — la bitácora es visible al super-admin
        // de Rutax cross-tenant en /admin/bitacora.
        entidadId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
        detalle: expect.objectContaining({
          tipo_relacion: 'independiente',
          // Iniciales, no el nombre completo.
          nombre_iniciales: 'J.P.S.',
          // RUT enmascarado, no el RUT completo en claro.
          rut_mascara: '****5678-5',
        }),
      }),
    );

    // Ni el RUT completo ni el nombre completo deben aparecer en la bitácora.
    const [, entradaBitacora] = vi.mocked(registrarEnBitacora).mock.calls[0];
    expect(entradaBitacora.entidadId).not.toBe(DATOS_VALIDOS.rut);
    const detalleSerializado = JSON.stringify(entradaBitacora.detalle);
    expect(detalleSerializado).not.toContain('Juan Pérez Soto');
    expect(detalleSerializado).not.toContain(DATOS_VALIDOS.rut);

    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0]).toMatchObject({
      id: entradaBitacora.entidadId,
      tenant_id: 'tenant-a',
      nombre_completo: 'Juan Pérez Soto',
      rut: '12345678-5',
      tipo_relacion: 'independiente',
    });
  });

  it('escribe la bitácora con service_role y el conductor con el cliente RLS (regresión: "permission denied for view bitacora_auditoria")', async () => {
    // Bug de producción 2026-08-11: el alta pasaba el cliente de la sesión a
    // `registrarEnBitacora`. `bitacora_auditoria` es append-only y `authenticated`
    // no tiene INSERT sobre ella (ni sobre la vista espejo de `public`), así que
    // el alta moría antes de crear al conductor. La corrección NO fue conceder
    // ese INSERT —eso permitiría fabricar auditoría desde el navegador— sino
    // traer el cliente correcto solo para la bitácora.
    vi.mocked(verificarLimite).mockResolvedValue({
      permitido: true,
      motivo: 'ok',
      usoActual: 1,
      limite: 5,
      porcentaje: 20,
    });
    const { cliente, insertPayloads } = crearClienteStub({
      data: {
        id: 'conductor-4',
        tenant_id: 'tenant-a',
        estado: 'activo',
        disponible: true,
        capacidad_paradas: 30,
        nombre_completo: 'Juan Pérez Soto',
        banco: null,
        tipo_cuenta: null,
        numero_cuenta: null,
      },
      error: null,
    });

    await crearConductor(cliente, 'tenant-a', DATOS_VALIDOS, 'user-1', actorConCapacidad);

    const [clienteUsadoEnBitacora] = vi.mocked(registrarEnBitacora).mock.calls[0];
    expect(clienteUsadoEnBitacora).toBe(crearClienteServiceRole());
    expect(clienteUsadoEnBitacora).not.toBe(cliente);

    // Contrapartida no negociable: el INSERT del conductor sigue yendo por el
    // cliente RLS, para que el aislamiento de tenant lo imponga la policy
    // `conductores_insert_interno` y no esta función.
    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0]).toMatchObject({ tenant_id: 'tenant-a' });
  });

  it('límite null (ilimitado): permite el alta igual', async () => {
    vi.mocked(verificarLimite).mockResolvedValue({
      permitido: true,
      motivo: 'ilimitado',
      usoActual: 40,
      limite: null,
      porcentaje: null,
    });
    const { cliente } = crearClienteStub({
      data: {
        id: 'conductor-2',
        tenant_id: 'tenant-a',
        estado: 'activo',
        disponible: true,
        capacidad_paradas: 30,
        nombre_completo: 'Juan Pérez Soto',
        banco: null,
        tipo_cuenta: null,
        numero_cuenta: null,
      },
      error: null,
    });

    const resultado = await crearConductor(cliente, 'tenant-a', DATOS_VALIDOS, 'user-1', actorConCapacidad);
    expect(resultado.ok).toBe(true);
  });

  it('sin suscripción (fail-open): permite el alta igual', async () => {
    vi.mocked(verificarLimite).mockResolvedValue({
      permitido: true,
      motivo: 'sin_suscripcion',
      usoActual: 3,
      limite: null,
      porcentaje: null,
    });
    const { cliente } = crearClienteStub({
      data: {
        id: 'conductor-3',
        tenant_id: 'tenant-a',
        estado: 'activo',
        disponible: true,
        capacidad_paradas: 30,
        nombre_completo: 'Juan Pérez Soto',
        banco: null,
        tipo_cuenta: null,
        numero_cuenta: null,
      },
      error: null,
    });

    const resultado = await crearConductor(cliente, 'tenant-a', DATOS_VALIDOS, 'user-1', actorConCapacidad);
    expect(resultado.ok).toBe(true);
  });

  it('RUT duplicado en el tenant (23505) → ErrorValidacion con mensaje claro', async () => {
    vi.mocked(verificarLimite).mockResolvedValue({
      permitido: true,
      motivo: 'ok',
      usoActual: 2,
      limite: 5,
      porcentaje: 40,
    });
    const { cliente } = crearClienteStub({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    await expect(
      crearConductor(cliente, 'tenant-a', DATOS_VALIDOS, 'user-1', actorConCapacidad),
    ).rejects.toThrow(/ya existe un conductor con ese rut/i);
  });
});
