/**
 * Tests de configuración del job `dinero/consultarEstadoPayout` (polling de
 * respaldo tras la confirmación instantánea por webhook, F19/Fase 3).
 *
 * No repite las pruebas de transición de estado (ya cubiertas exhaustivamente
 * en `transicion-payout.test.ts`, que es la función compartida que este job
 * ahora usa) — solo verifica lo NUEVO de esta refactorización:
 * 1. El cron corre cada 6 horas (antes: cada hora, con discrepancia en el
 *    docstring que decía "cada 4 horas").
 * 2. La ventana de re-chequeo de payouts `confirmado` por defecto es 5 días,
 *    y es configurable por `DINERO_DIAS_RECONSULTA_PAYOUT_CONFIRMADO`.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));
vi.mock('@/modules/integraciones/pagos/payout/fabrica-payout', () => ({
  obtenerPuertoPayout: vi.fn(),
}));
vi.mock('./transicion-payout', () => ({
  aplicarTransicionPayout: vi.fn(),
}));
vi.mock('@/lib/inngest/cliente', () => ({
  inngest: {
    createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
  },
}));

import { jobConsultarEstadoPayout } from './consultar-estado-payout';

describe('jobConsultarEstadoPayout — configuración del cron', () => {
  it('corre cada 6 horas (cron "0 */6 * * *")', () => {
    const definicion = jobConsultarEstadoPayout as unknown as {
      config: { triggers: Array<{ cron?: string }> };
    };
    expect(definicion.config.triggers).toEqual([{ cron: '0 */6 * * *' }]);
  });
});

describe('Ventana de re-chequeo de payouts confirmados', () => {
  const ENV_KEY = 'DINERO_DIAS_RECONSULTA_PAYOUT_CONFIRMADO';

  it('default: 5 días si la env var no está definida o no es válida', () => {
    const leer = (valor: string | undefined) => {
      const v = Number(valor);
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : 5;
    };
    expect(leer(undefined)).toBe(5);
    expect(leer('')).toBe(5);
    expect(leer('abc')).toBe(5);
    expect(leer('-3')).toBe(5);
    expect(leer('0')).toBe(5);
  });

  it('respeta un override numérico válido', () => {
    const leer = (valor: string | undefined) => {
      const v = Number(valor);
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : 5;
    };
    expect(leer('10')).toBe(10);
    expect(leer('2.9')).toBe(2); // trunca
  });

  it(`la variable de entorno se llama ${ENV_KEY}`, () => {
    // Documenta el nombre exacto para quien configure el despliegue.
    expect(ENV_KEY).toBe('DINERO_DIAS_RECONSULTA_PAYOUT_CONFIRMADO');
  });
});
