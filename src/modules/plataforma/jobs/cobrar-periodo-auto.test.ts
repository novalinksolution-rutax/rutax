/**
 * Tests del job `plataforma/cobrarPeriodoAuto` (F1-E — auto-cobro por mandato).
 *
 * Mismo patrón que `dinero/jobs/ejecutar-payout.test.ts`: se prueba la lógica
 * de negocio PURA extraída del job (`decidirAccionAutoCobro`,
 * `clasificarResultadoCobro`) — importada directamente del módulo del job, sin
 * duplicarla — junto con el adaptador `StubSuscripcionRecurrenteAdapter` real,
 * sin ejecutar el runtime de Inngest ni conectar a Supabase.
 *
 * Cubre lo pedido:
 * - Gate cerrado (sin mandato activo / sin opt-in) → no cobra.
 * - Mandato activo → cobra vía el stub (determinista).
 * - Idempotencia ante replay (período ya `pagado`).
 * - Clasificación que dispara `plataforma/cobro.fallido` en rechazo/fallo.
 */

import { describe, it, expect } from 'vitest';
import { StubSuscripcionRecurrenteAdapter } from '@/modules/integraciones/pagos/suscripcion-recurrente/adaptadores/stub';
import { decidirAccionAutoCobro, clasificarResultadoCobro } from './cobrar-periodo-auto';

const GATE_BASE = {
  periodoEstado: 'pendiente',
  autoCobroHabilitado: true,
  mandatoEstado: 'activo',
  mandatoRef: 'ref-uuid-mandato-1',
};

describe('decidirAccionAutoCobro — Step 1 (idempotencia + gate)', () => {
  it('período ya pagado → ya_pagado (idempotencia ante replay del evento disparador)', () => {
    const accion = decidirAccionAutoCobro({ ...GATE_BASE, periodoEstado: 'pagado' });
    expect(accion).toBe('ya_pagado');
  });

  it('período pagado tiene prioridad incluso si el gate también estaría cerrado', () => {
    const accion = decidirAccionAutoCobro({
      ...GATE_BASE,
      periodoEstado: 'pagado',
      autoCobroHabilitado: false,
      mandatoEstado: 'sin_mandato',
      mandatoRef: null,
    });
    expect(accion).toBe('ya_pagado');
  });

  it('gate cerrado — auto_cobro_habilitado=false → omitido_sin_mandato (no cobra)', () => {
    const accion = decidirAccionAutoCobro({ ...GATE_BASE, autoCobroHabilitado: false });
    expect(accion).toBe('omitido_sin_mandato');
  });

  it("gate cerrado — mandato_estado!=='activo' (pendiente) → omitido_sin_mandato (no cobra)", () => {
    const accion = decidirAccionAutoCobro({ ...GATE_BASE, mandatoEstado: 'pendiente' });
    expect(accion).toBe('omitido_sin_mandato');
  });

  it("gate cerrado — mandato_estado='fallido' → omitido_sin_mandato (no cobra)", () => {
    const accion = decidirAccionAutoCobro({ ...GATE_BASE, mandatoEstado: 'fallido' });
    expect(accion).toBe('omitido_sin_mandato');
  });

  it('gate cerrado — ambas condiciones fallan → omitido_sin_mandato', () => {
    const accion = decidirAccionAutoCobro({
      ...GATE_BASE,
      autoCobroHabilitado: false,
      mandatoEstado: 'sin_mandato',
    });
    expect(accion).toBe('omitido_sin_mandato');
  });

  it('gate abierto pero sin mandato_ref (inconsistencia defensiva) → omitido_sin_referencia', () => {
    const accion = decidirAccionAutoCobro({ ...GATE_BASE, mandatoRef: null });
    expect(accion).toBe('omitido_sin_referencia');
  });

  it('gate abierto Y mandato_ref presente → cobrar (mandato activo → cobra)', () => {
    const accion = decidirAccionAutoCobro(GATE_BASE);
    expect(accion).toBe('cobrar');
  });
});

describe('mandato activo → cobra vía el stub (determinista por idempotencyKey)', () => {
  it('el stub envía el cobro y el mismo idempotencyKey produce el mismo cobroExternoId (reintento seguro)', async () => {
    const stub = new StubSuscripcionRecurrenteAdapter();
    const args = {
      idempotencyKey: 'susc-cobro-periodo-1',
      mandatoToken: 'pm_test_123',
      montoClp: 49000,
      referencia: 'Suscripción Rutax · período 2026-07-01 a 2026-07-31',
      metadata: { periodo_id: 'periodo-1', tenant_id: 'tenant-a' },
    };

    const primero = await stub.cobrarPeriodo(args);
    const segundo = await stub.cobrarPeriodo(args); // "reintento" con la misma llave

    expect(primero.estado).toBe('enviado');
    expect(primero.cobroExternoId).toBe(segundo.cobroExternoId);
    expect(clasificarResultadoCobro(primero)).toEqual({
      estadoPago: 'pendiente',
      publicarCobroFallido: false,
      reintentable: false,
    });
  });

  it('distintos períodos (distinta idempotencyKey) producen distintos cobroExternoId', async () => {
    const stub = new StubSuscripcionRecurrenteAdapter();
    const a = await stub.cobrarPeriodo({
      idempotencyKey: 'susc-cobro-periodo-A',
      mandatoToken: 'pm_1',
      montoClp: 10000,
      referencia: 'ref',
      metadata: {},
    });
    const b = await stub.cobrarPeriodo({
      idempotencyKey: 'susc-cobro-periodo-B',
      mandatoToken: 'pm_1',
      montoClp: 10000,
      referencia: 'ref',
      metadata: {},
    });
    expect(a.cobroExternoId).not.toBe(b.cobroExternoId);
  });
});

describe('clasificarResultadoCobro — Step 3 (nunca marca pagado; solo el webhook lo hace)', () => {
  it("'enviado' → pago pendiente, NO publica cobro.fallido", () => {
    const c = clasificarResultadoCobro({ estado: 'enviado', cobroExternoId: 'stub_cobro_x' });
    expect(c).toEqual({ estadoPago: 'pendiente', publicarCobroFallido: false, reintentable: false });
  });

  it("'rechazado' (causa de negocio) → pago fallido, publica cobro.fallido con reintentable=false", () => {
    const c = clasificarResultadoCobro({ estado: 'rechazado', errorDescripcion: 'mandato inválido' });
    expect(c).toEqual({ estadoPago: 'fallido', publicarCobroFallido: true, reintentable: false });
  });

  it("'fallido' (transitorio) → pago fallido, publica cobro.fallido con reintentable=true", () => {
    const c = clasificarResultadoCobro({ estado: 'fallido', errorDescripcion: 'timeout de red' });
    expect(c).toEqual({ estadoPago: 'fallido', publicarCobroFallido: true, reintentable: true });
  });

  it('el stub simula un rechazo con el centinela monto<=0, y clasifica correctamente', async () => {
    const stub = new StubSuscripcionRecurrenteAdapter();
    const resultado = await stub.cobrarPeriodo({
      idempotencyKey: 'susc-cobro-periodo-centinela',
      mandatoToken: 'pm_1',
      montoClp: 0,
      referencia: 'ref',
      metadata: {},
    });

    expect(resultado.estado).toBe('rechazado');
    expect(clasificarResultadoCobro(resultado)).toEqual({
      estadoPago: 'fallido',
      publicarCobroFallido: true,
      reintentable: false,
    });
  });
});
