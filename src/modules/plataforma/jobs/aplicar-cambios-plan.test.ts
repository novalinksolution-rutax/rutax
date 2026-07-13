/**
 * Tests del job `plataforma/aplicarCambiosPlan` (F2, item I — downgrades
 * diferidos).
 *
 * Mismo patrón que `cobrar-periodo-auto.test.ts`: se prueba la lógica de
 * negocio PURA extraída del job (`debeAplicarCambioPlan`) sin runtime de
 * Inngest ni BD.
 */

import { describe, it, expect } from 'vitest';
import { debeAplicarCambioPlan } from './aplicar-cambios-plan';

describe('debeAplicarCambioPlan', () => {
  it('sin plan_anterior_id (nada pendiente) → false', () => {
    expect(
      debeAplicarCambioPlan({ planAnteriorId: null, cambioEfectivoDesde: '2026-07-01', hoy: '2026-07-15' }),
    ).toBe(false);
  });

  it('sin cambio_efectivo_desde (nada pendiente) → false', () => {
    expect(
      debeAplicarCambioPlan({ planAnteriorId: 'plan-starter', cambioEfectivoDesde: null, hoy: '2026-07-15' }),
    ).toBe(false);
  });

  it('cambio_efectivo_desde en el FUTURO → false (todavía no toca)', () => {
    expect(
      debeAplicarCambioPlan({
        planAnteriorId: 'plan-starter',
        cambioEfectivoDesde: '2026-08-01',
        hoy: '2026-07-15',
      }),
    ).toBe(false);
  });

  it('cambio_efectivo_desde HOY → true', () => {
    expect(
      debeAplicarCambioPlan({
        planAnteriorId: 'plan-starter',
        cambioEfectivoDesde: '2026-07-15',
        hoy: '2026-07-15',
      }),
    ).toBe(true);
  });

  it('cambio_efectivo_desde en el PASADO (el cron se saltó un día) → true igual', () => {
    expect(
      debeAplicarCambioPlan({
        planAnteriorId: 'plan-starter',
        cambioEfectivoDesde: '2026-07-01',
        hoy: '2026-07-15',
      }),
    ).toBe(true);
  });
});
