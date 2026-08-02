/**
 * Tests de `verificarLimite` (`enforcement.ts`, F2 "Ola 1", ítem G1).
 *
 * `obtenerEntitlementsTenant`/`obtenerConsumoTenant` se mockean enteros — su
 * propia lógica ya está cubierta en `superficie-courier.test.ts`/(implícita
 * en `consumo.ts`, sin lógica propia más allá de conteos). Aquí solo importa
 * la composición: cómo `verificarLimite` traduce (entitlements, consumo) a un
 * `ResultadoLimite` para cada `RecursoLimitado` y cada estado de suscripción.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./superficie-courier', () => ({
  obtenerEntitlementsTenant: vi.fn(),
}));

vi.mock('./consumo', () => ({
  obtenerConsumoTenant: vi.fn(),
}));

import { obtenerEntitlementsTenant } from './superficie-courier';
import { obtenerConsumoTenant } from './consumo';
import { verificarLimite } from './enforcement';
import type { Entitlements } from './superficie-courier';
import type { ConsumoTenant } from './consumo';

function entitlements(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    limitePedidosMes: 500,
    conductoresMax: 5,
    apiPublica: false,
    webhooks: false,
    estadoSuscripcion: 'activa',
    ...overrides,
  };
}

function consumo(overrides: Partial<ConsumoTenant> = {}): ConsumoTenant {
  return { pedidosMes: 0, conductoresActivos: 0, ...overrides };
}

describe('verificarLimite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin suscripción (estadoSuscripcion:null): fail-open BLANDO, permitido:true, motivo:sin_suscripcion', async () => {
    vi.mocked(obtenerEntitlementsTenant).mockResolvedValue(
      entitlements({ estadoSuscripcion: null, conductoresMax: null, limitePedidosMes: null }),
    );
    vi.mocked(obtenerConsumoTenant).mockResolvedValue(consumo({ conductoresActivos: 999 }));

    const resultado = await verificarLimite('tenant-a', 'conductores');

    expect(resultado).toEqual({
      permitido: true,
      motivo: 'sin_suscripcion',
      usoActual: 999,
      limite: null,
      porcentaje: null,
    });
  });

  it('límite null (plan ilimitado): permitido:true, motivo:ilimitado, sin porcentaje', async () => {
    vi.mocked(obtenerEntitlementsTenant).mockResolvedValue(entitlements({ conductoresMax: null }));
    vi.mocked(obtenerConsumoTenant).mockResolvedValue(consumo({ conductoresActivos: 50 }));

    const resultado = await verificarLimite('tenant-a', 'conductores');

    expect(resultado).toEqual({
      permitido: true,
      motivo: 'ilimitado',
      usoActual: 50,
      limite: null,
      porcentaje: null,
    });
  });

  describe('conductores — único recurso con bloqueo real', () => {
    it('bajo el cap: permitido:true, motivo:ok, con porcentaje', async () => {
      vi.mocked(obtenerEntitlementsTenant).mockResolvedValue(entitlements({ conductoresMax: 5 }));
      vi.mocked(obtenerConsumoTenant).mockResolvedValue(consumo({ conductoresActivos: 2 }));

      const resultado = await verificarLimite('tenant-a', 'conductores');

      expect(resultado).toEqual({ permitido: true, motivo: 'ok', usoActual: 2, limite: 5, porcentaje: 40 });
    });

    it('en el tope exacto (usoActual === limite): permitido:false, motivo:limite_alcanzado', async () => {
      vi.mocked(obtenerEntitlementsTenant).mockResolvedValue(entitlements({ conductoresMax: 5 }));
      vi.mocked(obtenerConsumoTenant).mockResolvedValue(consumo({ conductoresActivos: 5 }));

      const resultado = await verificarLimite('tenant-a', 'conductores');

      expect(resultado).toEqual({
        permitido: false,
        motivo: 'limite_alcanzado',
        usoActual: 5,
        limite: 5,
        porcentaje: 100,
      });
    });

    it('suscripción suspendida, DENTRO del cap: aplica el MISMO cap (no lo endurece) — permitido:true, motivo:suspendida', async () => {
      vi.mocked(obtenerEntitlementsTenant).mockResolvedValue(
        entitlements({ conductoresMax: 5, estadoSuscripcion: 'suspendida' }),
      );
      vi.mocked(obtenerConsumoTenant).mockResolvedValue(consumo({ conductoresActivos: 3 }));

      const resultado = await verificarLimite('tenant-a', 'conductores');

      expect(resultado).toEqual({
        permitido: true,
        motivo: 'suspendida',
        usoActual: 3,
        limite: 5,
        porcentaje: 60,
      });
    });

    it('suscripción suspendida, EN el tope: el motivo sigue siendo limite_alcanzado (el cap del plan manda, no la suspensión)', async () => {
      vi.mocked(obtenerEntitlementsTenant).mockResolvedValue(
        entitlements({ conductoresMax: 5, estadoSuscripcion: 'suspendida' }),
      );
      vi.mocked(obtenerConsumoTenant).mockResolvedValue(consumo({ conductoresActivos: 5 }));

      const resultado = await verificarLimite('tenant-a', 'conductores');

      expect(resultado.permitido).toBe(false);
      expect(resultado.motivo).toBe('limite_alcanzado');
    });

    it('trial, dentro del cap: motivo:ok (no se confunde con "suspendida")', async () => {
      vi.mocked(obtenerEntitlementsTenant).mockResolvedValue(
        entitlements({ conductoresMax: 5, estadoSuscripcion: 'trial' }),
      );
      vi.mocked(obtenerConsumoTenant).mockResolvedValue(consumo({ conductoresActivos: 1 }));

      const resultado = await verificarLimite('tenant-a', 'conductores');
      expect(resultado.motivo).toBe('ok');
      expect(resultado.permitido).toBe(true);
    });
  });

  describe('pedidos_mes — SIEMPRE informativo, nunca bloquea', () => {
    it('por debajo del límite: permitido:true, motivo:ok, con porcentaje', async () => {
      vi.mocked(obtenerEntitlementsTenant).mockResolvedValue(entitlements({ limitePedidosMes: 500 }));
      vi.mocked(obtenerConsumoTenant).mockResolvedValue(consumo({ pedidosMes: 100 }));

      const resultado = await verificarLimite('tenant-a', 'pedidos_mes');

      expect(resultado).toEqual({ permitido: true, motivo: 'ok', usoActual: 100, limite: 500, porcentaje: 20 });
    });

    it('MUY por sobre el límite (200%): sigue permitido:true — jamás bloquea la operación en marcha', async () => {
      vi.mocked(obtenerEntitlementsTenant).mockResolvedValue(entitlements({ limitePedidosMes: 500 }));
      vi.mocked(obtenerConsumoTenant).mockResolvedValue(consumo({ pedidosMes: 1000 }));

      const resultado = await verificarLimite('tenant-a', 'pedidos_mes');

      expect(resultado.permitido).toBe(true);
      expect(resultado.motivo).toBe('ok');
      expect(resultado.porcentaje).toBe(200);
    });

    it('suscripción suspendida: pedidos_mes sigue sin bloquear (siempre informativo)', async () => {
      vi.mocked(obtenerEntitlementsTenant).mockResolvedValue(
        entitlements({ limitePedidosMes: 500, estadoSuscripcion: 'suspendida' }),
      );
      vi.mocked(obtenerConsumoTenant).mockResolvedValue(consumo({ pedidosMes: 600 }));

      const resultado = await verificarLimite('tenant-a', 'pedidos_mes');
      expect(resultado.permitido).toBe(true);
    });
  });

  it('límite en 0 y consumo en 0: porcentaje 0 (no división por cero)', async () => {
    vi.mocked(obtenerEntitlementsTenant).mockResolvedValue(entitlements({ conductoresMax: 0 }));
    vi.mocked(obtenerConsumoTenant).mockResolvedValue(consumo({ conductoresActivos: 0 }));

    const resultado = await verificarLimite('tenant-a', 'conductores');
    expect(resultado.porcentaje).toBe(0);
    expect(resultado.permitido).toBe(false); // 0 < 0 es falso
    expect(resultado.motivo).toBe('limite_alcanzado');
  });
});
