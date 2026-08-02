/**
 * Tests de `acciones.ts` — enfocados en el hilo de `actorUsuarioId` hacia la
 * bitácora (gap 3, F2-mínimo): retrocompatibilidad (sin `actorUsuarioId` →
 * `null`, comportamiento previo intacto) y el camino nuevo (con
 * `actorUsuarioId` → llega EXACTO a `registrarEnBitacora`).
 *
 * No re-testea toda la lógica de negocio de cada acción (upsert/estados) —
 * eso no cambió; solo el hilo del autor, que es lo que se tocó.
 *
 * Mismo patrón de mocks que `mandato.test.ts`/`superficie-courier.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/integraciones/pagos', () => ({
  obtenerPuertoCheckout: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import {
  asignarPlan,
  activarSuscripcion,
  crearPlan,
  actualizarPlan,
  activarDesactivarPlan,
  establecerCaracteristicasOverride,
  establecerEmisionDteReal,
} from './acciones';

const SECRETO = 'secreto-de-prueba-suficientemente-largo-para-timingSafeEqual';

/** Builder que soporta tanto `.single()`/`.maybeSingle()` como un `await` bare
 *  (sin terminal explícito) — cubre tanto `asignarPlan` (upsert().select().single())
 *  como `activarSuscripcion` (maybeSingle() de lectura + update().eq() bare). */
function crearMockSupabase(secuencia: Array<{ data: unknown; error: unknown }>) {
  let i = 0;
  const siguiente = () => secuencia[i++] ?? { data: null, error: null };
  const q: Record<string, unknown> = {
    schema: vi.fn(() => q),
    from: vi.fn(() => q),
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    update: vi.fn(() => q),
    upsert: vi.fn(() => q),
    insert: vi.fn(() => q),
    maybeSingle: vi.fn(() => Promise.resolve(siguiente())),
    single: vi.fn(() => Promise.resolve(siguiente())),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(siguiente()).then(resolve, reject),
  };
  return q;
}

describe('acciones de plataforma — actorUsuarioId hacia la bitácora', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPER_ADMIN_SECRET = SECRETO;
  });

  afterEach(() => {
    delete process.env.SUPER_ADMIN_SECRET;
  });

  describe('asignarPlan', () => {
    it('retrocompatible: sin actorUsuarioId, la bitácora registra actorUsuarioId: null (comportamiento previo)', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([{ data: { id: 'susc-1' }, error: null }]) as unknown as ReturnType<
          typeof crearClienteServiceRole
        >,
      );

      const resultado = await asignarPlan({
        adminSecret: SECRETO,
        tenantId: 'tenant-a',
        planId: 'plan-1',
      });

      expect(resultado).toEqual({ ok: true, suscripcionId: 'susc-1' });
      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorUsuarioId: null, actorTipo: 'super_admin' }),
      );
    });

    it('con actorUsuarioId: llega EXACTO a la bitácora', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([{ data: { id: 'susc-1' }, error: null }]) as unknown as ReturnType<
          typeof crearClienteServiceRole
        >,
      );

      await asignarPlan({
        adminSecret: SECRETO,
        tenantId: 'tenant-a',
        planId: 'plan-1',
        actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
      });

      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
          actorTipo: 'super_admin',
          accion: 'plataforma.plan_asignado',
        }),
      );
    });

    it('sigue exigiendo el adminSecret correcto (el secreto compartido sigue siendo la puerta)', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([]) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      await expect(
        asignarPlan({ adminSecret: 'secreto-incorrecto', tenantId: 'tenant-a', planId: 'plan-1' }),
      ).rejects.toThrow(/no autorizado/i);
      expect(registrarEnBitacora).not.toHaveBeenCalled();
    });
  });

  describe('activarSuscripcion', () => {
    it('retrocompatible: sin actorUsuarioId → bitácora con null', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([
          { data: { id: 'susc-1', tenant_id: 'tenant-a', estado: 'trial', notas: null }, error: null }, // lectura
          { data: null, error: null }, // update bare
        ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      await activarSuscripcion({ adminSecret: SECRETO, suscripcionId: 'susc-1' });

      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: 'tenant-a',
          actorUsuarioId: null,
          accion: 'plataforma.suscripcion_activada',
        }),
      );
    });

    it('con actorUsuarioId: llega EXACTO a la bitácora junto con el tenant leído', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([
          { data: { id: 'susc-1', tenant_id: 'tenant-a', estado: 'trial', notas: null }, error: null },
          { data: null, error: null },
        ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      const resultado = await activarSuscripcion({
        adminSecret: SECRETO,
        suscripcionId: 'susc-1',
        actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
      });

      expect(resultado).toEqual({ ok: true });
      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: 'tenant-a',
          actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
          accion: 'plataforma.suscripcion_activada',
        }),
      );
    });
  });

  // ===========================================================================
  // crearPlan / actualizarPlan / activarDesactivarPlan (F2 "Ola 1", ítem D)
  // ===========================================================================

  describe('crearPlan', () => {
    it('valida precios: rechaza precioMensualClp negativo/no entero SIN llegar a la bitácora', async () => {
      await expect(
        crearPlan({
          adminSecret: SECRETO,
          nombre: 'Starter',
          precioMensualClp: -1,
          precioAnualClp: 199900,
        }),
      ).rejects.toThrow(/entero y no negativo/i);
      expect(registrarEnBitacora).not.toHaveBeenCalled();

      await expect(
        crearPlan({
          adminSecret: SECRETO,
          nombre: 'Starter',
          precioMensualClp: 1990.5,
          precioAnualClp: 199900,
        }),
      ).rejects.toThrow(/entero y no negativo/i);
    });

    it('rechaza nombre vacío', async () => {
      await expect(
        crearPlan({ adminSecret: SECRETO, nombre: '   ', precioMensualClp: 1000, precioAnualClp: 10000 }),
      ).rejects.toThrow(/nombre.*no puede estar vacío/i);
    });

    it('rechaza caracteristicas que no sean un objeto plano (array)', async () => {
      await expect(
        crearPlan({
          adminSecret: SECRETO,
          nombre: 'Starter',
          precioMensualClp: 1000,
          precioAnualClp: 10000,
          // @ts-expect-error — valor inválido deliberado para el test
          caracteristicas: ['no', 'es', 'un', 'objeto'],
        }),
      ).rejects.toThrow(/objeto jsonb plano/i);
    });

    it('camino feliz: bitácora ANTES del INSERT, con actorUsuarioId; activo:true por defecto', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([{ data: { id: 'plan-nuevo' }, error: null }]) as unknown as ReturnType<
          typeof crearClienteServiceRole
        >,
      );

      const resultado = await crearPlan({
        adminSecret: SECRETO,
        nombre: 'Growth',
        precioMensualClp: 39990,
        precioAnualClp: 399900,
        limitePedidosMes: 2000,
        caracteristicas: { conductores_max: 15 },
        actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
      });

      expect(resultado).toEqual({ ok: true, planId: 'plan-nuevo' });
      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: null,
          actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
          actorTipo: 'super_admin',
          accion: 'plataforma.plan_creado',
        }),
      );
    });

    it('whitelist: descarta llaves de caracteristicas desconocidas para el dominio antes de persistir', async () => {
      const query = crearMockSupabase([{ data: { id: 'plan-nuevo' }, error: null }]);
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        query as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      await crearPlan({
        adminSecret: SECRETO,
        nombre: 'Growth',
        precioMensualClp: 39990,
        precioAnualClp: 399900,
        caracteristicas: {
          conductores_max: 15,
          api_publica: true,
          feature_fantasma: true,
        },
      });

      expect(query.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          caracteristicas: { conductores_max: 15, api_publica: true },
        }),
      );
    });
  });

  describe('actualizarPlan', () => {
    it('rechaza si el plan no existe', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([{ data: null, error: null }]) as unknown as ReturnType<
          typeof crearClienteServiceRole
        >,
      );

      await expect(
        actualizarPlan({ adminSecret: SECRETO, planId: 'plan-inexistente', nombre: 'Nuevo nombre' }),
      ).rejects.toThrow(/no encontrado/i);
    });

    it('sin campos a editar: no-op, SIN bitácora', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([{ data: { id: 'plan-1' }, error: null }]) as unknown as ReturnType<
          typeof crearClienteServiceRole
        >,
      );

      const resultado = await actualizarPlan({ adminSecret: SECRETO, planId: 'plan-1' });

      expect(resultado).toEqual({ ok: true });
      expect(registrarEnBitacora).not.toHaveBeenCalled();
    });

    it('edita precio: valida, bitácora ANTES del UPDATE, con actorUsuarioId', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([
          { data: { id: 'plan-1' }, error: null }, // lectura de existencia
          { data: null, error: null }, // update bare
        ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      const resultado = await actualizarPlan({
        adminSecret: SECRETO,
        planId: 'plan-1',
        precioMensualClp: 44990,
        actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
      });

      expect(resultado).toEqual({ ok: true });
      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: null,
          actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
          actorTipo: 'super_admin',
          accion: 'plataforma.plan_actualizado',
          entidadId: 'plan-1',
          detalle: expect.objectContaining({ campos_editados: ['precio_mensual_clp'] }),
        }),
      );
    });

    it('rechaza precio inválido sin tocar bitácora ni BD', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([{ data: { id: 'plan-1' }, error: null }]) as unknown as ReturnType<
          typeof crearClienteServiceRole
        >,
      );

      await expect(
        actualizarPlan({ adminSecret: SECRETO, planId: 'plan-1', precioAnualClp: -5 }),
      ).rejects.toThrow(/entero y no negativo/i);
      expect(registrarEnBitacora).not.toHaveBeenCalled();
    });
  });

  describe('activarDesactivarPlan', () => {
    it('DESACTIVAR: bitácora ANTES del UPDATE, accion plan_desactivado', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([
          { data: { id: 'plan-1', activo: true }, error: null },
          { data: null, error: null },
        ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      const resultado = await activarDesactivarPlan({
        adminSecret: SECRETO,
        planId: 'plan-1',
        activo: false,
        actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
      });

      expect(resultado).toEqual({ ok: true });
      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          accion: 'plataforma.plan_desactivado',
          detalle: expect.objectContaining({ activo_anterior: true, activo_nuevo: false }),
        }),
      );
    });

    it('REACTIVAR: accion plan_reactivado', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([
          { data: { id: 'plan-1', activo: false }, error: null },
          { data: null, error: null },
        ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      const resultado = await activarDesactivarPlan({ adminSecret: SECRETO, planId: 'plan-1', activo: true });

      expect(resultado).toEqual({ ok: true });
      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ accion: 'plataforma.plan_reactivado' }),
      );
    });

    it('rechaza si el plan no existe', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([{ data: null, error: null }]) as unknown as ReturnType<
          typeof crearClienteServiceRole
        >,
      );

      await expect(
        activarDesactivarPlan({ adminSecret: SECRETO, planId: 'plan-x', activo: false }),
      ).rejects.toThrow(/no encontrado/i);
    });
  });

  // ===========================================================================
  // establecerCaracteristicasOverride (F2 "Ola 1", gap 6-admin)
  // ===========================================================================

  describe('establecerCaracteristicasOverride', () => {
    it('rechaza si el tenant no tiene suscripción', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([{ data: null, error: null }]) as unknown as ReturnType<
          typeof crearClienteServiceRole
        >,
      );

      await expect(
        establecerCaracteristicasOverride({
          adminSecret: SECRETO,
          tenantId: 'tenant-sin-susc',
          override: { conductores_max: 10 },
        }),
      ).rejects.toThrow(/no tiene una suscripción/i);
    });

    it('merge: agrega/pisa llaves nuevas sin borrar las existentes del override anterior', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([
          {
            data: { id: 'susc-1', caracteristicas_override: { api_publica: true, webhooks: false } },
            error: null,
          },
          { data: null, error: null }, // update bare
        ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      const resultado = await establecerCaracteristicasOverride({
        adminSecret: SECRETO,
        tenantId: 'tenant-a',
        override: { conductores_max: 12 },
        actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
      });

      expect(resultado).toEqual({ ok: true });
      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: 'tenant-a',
          actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
          accion: 'plataforma.override_caracteristicas_actualizado',
          detalle: expect.objectContaining({
            override_anterior: { api_publica: true, webhooks: false },
            override_nuevo: { api_publica: true, webhooks: false, conductores_max: 12 },
          }),
        }),
      );
    });

    it('null explícito en una llave la BORRA del override (revierte al valor del plan)', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([
          {
            data: { id: 'susc-1', caracteristicas_override: { api_publica: true, conductores_max: 12 } },
            error: null,
          },
          { data: null, error: null },
        ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      await establecerCaracteristicasOverride({
        adminSecret: SECRETO,
        tenantId: 'tenant-a',
        override: { api_publica: null },
      });

      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          detalle: expect.objectContaining({
            override_nuevo: { conductores_max: 12 },
          }),
        }),
      );
    });

    it('whitelist: descarta llaves del override desconocidas para el dominio antes de persistir', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([
          { data: { id: 'susc-1', caracteristicas_override: {} }, error: null },
          { data: null, error: null }, // update bare
        ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      await establecerCaracteristicasOverride({
        adminSecret: SECRETO,
        tenantId: 'tenant-a',
        override: { conductores_max: 10, limite_pedidos_mes: 3000, feature_fantasma: true },
      });

      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          detalle: expect.objectContaining({
            override_nuevo: { conductores_max: 10, limite_pedidos_mes: 3000 },
          }),
        }),
      );
    });

    it('rechaza override que no sea un objeto jsonb plano', async () => {
      await expect(
        establecerCaracteristicasOverride({
          adminSecret: SECRETO,
          tenantId: 'tenant-a',
          // @ts-expect-error — valor inválido deliberado para el test
          override: 'no-es-un-objeto',
        }),
      ).rejects.toThrow(/objeto jsonb plano/i);
      expect(registrarEnBitacora).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // establecerEmisionDteReal (F2 "Ola 1", ítem 8)
  // ===========================================================================

  describe('establecerEmisionDteReal', () => {
    it('rechaza si el tenant no tiene courier_config_dte (no eligió proveedor)', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([{ data: null, error: null }]) as unknown as ReturnType<
          typeof crearClienteServiceRole
        >,
      );

      await expect(
        establecerEmisionDteReal({ adminSecret: SECRETO, tenantId: 'tenant-sin-dte', habilitada: true }),
      ).rejects.toThrow(/no tiene configuración dte/i);
    });

    it('opt-in: bitácora ANTES del UPDATE, accion dte_real_opt_in, con actorUsuarioId', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([
          { data: { tenant_id: 'tenant-a', emision_dte_real_habilitada: false }, error: null },
          { data: null, error: null },
        ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      const resultado = await establecerEmisionDteReal({
        adminSecret: SECRETO,
        tenantId: 'tenant-a',
        habilitada: true,
        actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
      });

      expect(resultado).toEqual({ ok: true });
      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: 'tenant-a',
          actorUsuarioId: 'ad000000-0000-0000-0000-000000000001',
          actorTipo: 'super_admin',
          accion: 'plataforma.dte_real_opt_in',
          detalle: expect.objectContaining({ habilitada_anterior: false, habilitada_nueva: true }),
        }),
      );
    });

    it('opt-out: accion dte_real_opt_out', async () => {
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        crearMockSupabase([
          { data: { tenant_id: 'tenant-a', emision_dte_real_habilitada: true }, error: null },
          { data: null, error: null },
        ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      const resultado = await establecerEmisionDteReal({
        adminSecret: SECRETO,
        tenantId: 'tenant-a',
        habilitada: false,
      });

      expect(resultado).toEqual({ ok: true });
      expect(registrarEnBitacora).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ accion: 'plataforma.dte_real_opt_out' }),
      );
    });
  });
});
