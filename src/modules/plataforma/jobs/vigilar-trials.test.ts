/**
 * Tests de `plataforma/vigilarTrials` (F2 "Ola 3", ítem E).
 *
 * Se prueba la lógica pura (`calcularDiasRestantesTrial`,
 * `debeAlertarTrialPorVencer`), mismo patrón que
 * `notificacion-incidencias-sin-gestion.test.ts` — sin runtime de Inngest ni BD.
 */

import { describe, it, expect } from 'vitest';
import { calcularDiasRestantesTrial, debeAlertarTrialPorVencer, UMBRAL_ALERTA_TRIAL_DIAS } from './vigilar-trials';

describe('calcularDiasRestantesTrial', () => {
  it('trial_hasta en el futuro → positivo', () => {
    expect(calcularDiasRestantesTrial('2026-07-20', '2026-07-15')).toBe(5);
  });

  it('trial_hasta HOY → 0', () => {
    expect(calcularDiasRestantesTrial('2026-07-15', '2026-07-15')).toBe(0);
  });

  it('trial_hasta en el pasado → negativo', () => {
    expect(calcularDiasRestantesTrial('2026-07-10', '2026-07-15')).toBe(-5);
  });
});

describe('debeAlertarTrialPorVencer', () => {
  it(`exactamente ${UMBRAL_ALERTA_TRIAL_DIAS} días restantes → true`, () => {
    expect(debeAlertarTrialPorVencer(UMBRAL_ALERTA_TRIAL_DIAS)).toBe(true);
  });

  it('un día antes del umbral → false (todavía no toca)', () => {
    expect(debeAlertarTrialPorVencer(UMBRAL_ALERTA_TRIAL_DIAS + 1)).toBe(false);
  });

  it('un día después del umbral → false (ya pasó, no se re-dispara otro día)', () => {
    expect(debeAlertarTrialPorVencer(UMBRAL_ALERTA_TRIAL_DIAS - 1)).toBe(false);
  });

  it('trial ya vencido (negativo) → false', () => {
    expect(debeAlertarTrialPorVencer(-1)).toBe(false);
  });
});
