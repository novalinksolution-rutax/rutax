/**
 * Tests de `plataforma/reintentarCobroVencido` (F2 "Ola 3", ítem F — dunning).
 *
 * Se prueba la lógica pura de decisión (`decidirReintentoCobroVencido`), mismo
 * patrón que `decidirAccionAutoCobro` (`cobrar-periodo-auto.test.ts`) — sin
 * runtime de Inngest ni BD.
 */

import { describe, it, expect } from 'vitest';
import {
  decidirReintentoCobroVencido,
  BACKOFF_DIAS_REINTENTO_COBRO,
  MAX_REINTENTOS_COBRO_VENCIDO,
  DIAS_GRACIA_MOROSIDAD,
} from './reintentar-cobro-vencido';

describe('decidirReintentoCobroVencido', () => {
  it('nunca se intentó desde que venció (día 1) → reintentar de inmediato', () => {
    const accion = decidirReintentoCobroVencido({
      intentosFallidosPrevios: 0,
      diasDesdeVencimiento: 1,
      diasDesdeUltimoIntento: null,
    });
    expect(accion).toBe('reintentar');
  });

  it('con 1 intento previo, todavía dentro de la ventana de backoff → esperar_backoff', () => {
    // backoff[1] = 3 días — con solo 1 día desde el último intento, no toca.
    const accion = decidirReintentoCobroVencido({
      intentosFallidosPrevios: 1,
      diasDesdeVencimiento: 5,
      diasDesdeUltimoIntento: 1,
    });
    expect(accion).toBe('esperar_backoff');
  });

  it('con 1 intento previo, ya pasó la ventana de backoff → reintentar', () => {
    const accion = decidirReintentoCobroVencido({
      intentosFallidosPrevios: 1,
      diasDesdeVencimiento: 5,
      diasDesdeUltimoIntento: 3,
    });
    expect(accion).toBe('reintentar');
  });

  it('justo en el borde del backoff (>=) → reintentar', () => {
    const diasEspera = BACKOFF_DIAS_REINTENTO_COBRO[0];
    const accion = decidirReintentoCobroVencido({
      intentosFallidosPrevios: 0,
      diasDesdeVencimiento: 2,
      diasDesdeUltimoIntento: diasEspera,
    });
    expect(accion).toBe('reintentar');
  });

  it('alcanzó el tope de reintentos → max_reintentos_alcanzado (no reintenta más)', () => {
    const accion = decidirReintentoCobroVencido({
      intentosFallidosPrevios: MAX_REINTENTOS_COBRO_VENCIDO,
      diasDesdeVencimiento: 10,
      diasDesdeUltimoIntento: 20,
    });
    expect(accion).toBe('max_reintentos_alcanzado');
  });

  it('supera el período de gracia → gracia_agotada, sin importar el resto', () => {
    const accion = decidirReintentoCobroVencido({
      intentosFallidosPrevios: 0,
      diasDesdeVencimiento: DIAS_GRACIA_MOROSIDAD + 1,
      diasDesdeUltimoIntento: null,
    });
    expect(accion).toBe('gracia_agotada');
  });

  it('exactamente en el borde de la gracia (no excede) → sigue evaluando reintento normal', () => {
    const accion = decidirReintentoCobroVencido({
      intentosFallidosPrevios: 0,
      diasDesdeVencimiento: DIAS_GRACIA_MOROSIDAD,
      diasDesdeUltimoIntento: null,
    });
    expect(accion).toBe('reintentar');
  });

  it('gracia agotada tiene prioridad incluso si también alcanzó el tope de reintentos', () => {
    const accion = decidirReintentoCobroVencido({
      intentosFallidosPrevios: MAX_REINTENTOS_COBRO_VENCIDO,
      diasDesdeVencimiento: DIAS_GRACIA_MOROSIDAD + 5,
      diasDesdeUltimoIntento: 20,
    });
    expect(accion).toBe('gracia_agotada');
  });
});
