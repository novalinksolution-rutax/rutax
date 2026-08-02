/**
 * Tests de `confirmarPagoSuscripcion` — foco en la reconciliación de monto
 * (H-4, defensa en profundidad) agregada en Fase 1 de "completar suscripciones",
 * sin romper los caminos existentes (confirmado / ya_pagado / sin_periodo /
 * fallido_registrado).
 *
 * Mocks mínimos, mismo patrón que `dinero/acciones.test.ts`:
 * - `crearClienteServiceRole` → builder encadenable con una cola de respuestas.
 * - `inngest.send` → no-op (no se disparan eventos reales).
 * - `registrarEnBitacora` → no-op (se verifica que se llamó, no su I/O real).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EventoPagoSuscripcion } from '@/modules/integraciones/pagos';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/lib/inngest/cliente', () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { inngest } from '@/lib/inngest/cliente';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { confirmarPagoSuscripcion, confirmarCobroRecurrente } from './cobro';
import type { EventoRecurrenteNormalizado } from '@/modules/integraciones/pagos/suscripcion-recurrente';

/**
 * Builder encadenable que resuelve cualquier terminal (`maybeSingle()`,
 * `insert()`, o el `await` directo de la cadena vía `.then()`) consumiendo la
 * SIGUIENTE respuesta de una cola compartida, en el mismo orden en que el
 * código las dispara. Refleja cómo `supabase-js` hace que su builder sea
 * "thenable" (se puede `await` sin llamar `.select()`/`.maybeSingle()`).
 */
function crearMockSupabase(secuencia: Array<{ data: unknown; error: unknown }>) {
  let i = 0;
  const siguiente = () => secuencia[i++] ?? { data: null, error: null };
  const q: Record<string, unknown> = {
    schema: vi.fn(() => q),
    from: vi.fn(() => q),
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    neq: vi.fn(() => q),
    update: vi.fn(() => q),
    insert: vi.fn(() => Promise.resolve(siguiente())),
    maybeSingle: vi.fn(() => Promise.resolve(siguiente())),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(siguiente()).then(resolve, reject),
  };
  return q;
}

function eventoBase(overrides: Partial<EventoPagoSuscripcion> = {}): EventoPagoSuscripcion {
  return {
    eventoExternoId: 'evt_123',
    linkExternoId: 'link_123',
    periodoId: 'periodo-1',
    estado: 'pagado',
    montoClp: 49000,
    payloadSanitizado: {},
    ...overrides,
  };
}

const PERIODO_BASE = {
  id: 'periodo-1',
  tenant_id: 'tenant-a',
  suscripcion_id: 'susc-1',
  monto_clp: 49000,
  estado: 'pendiente',
};

describe('confirmarPagoSuscripcion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin período resoluble → sin_periodo (evento sin periodoId ni link)', async () => {
    // `crearClienteServiceRole()` se llama igual (asignado a una variable local)
    // pero nunca se usa antes del `return` temprano — no hace falta mockear
    // ninguna respuesta.
    const evento = eventoBase({ periodoId: null, linkExternoId: null });
    const resultado = await confirmarPagoSuscripcion(evento);
    expect(resultado).toEqual({ resultado: 'sin_periodo', periodoId: null });
  });

  it('período inexistente → sin_periodo', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: null, error: null }]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await confirmarPagoSuscripcion(eventoBase());
    expect(resultado).toEqual({ resultado: 'sin_periodo', periodoId: null });
  });

  it('período ya pagado → ya_pagado, idempotente (no re-marca ni re-publica)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: { ...PERIODO_BASE, estado: 'pagado' }, error: null }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );
    const resultado = await confirmarPagoSuscripcion(eventoBase());
    expect(resultado).toEqual({ resultado: 'ya_pagado', periodoId: 'periodo-1' });
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('evento fallido → fallido_registrado, no toca el período', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: PERIODO_BASE, error: null }, // leer período
        { data: null, error: null }, // update pagos_plataforma → fallido (bare await)
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await confirmarPagoSuscripcion(eventoBase({ estado: 'fallido' }));
    expect(resultado).toEqual({ resultado: 'fallido_registrado', periodoId: 'periodo-1' });
    expect(inngest.send).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Reconciliación de monto (H-4) — el fix nuevo.
  // ---------------------------------------------------------------------------

  it('monto informado distinto del esperado → monto_discrepante, NO marca pagado', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: PERIODO_BASE, error: null }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );
    const resultado = await confirmarPagoSuscripcion(eventoBase({ montoClp: 10000 }));
    expect(resultado).toEqual({ resultado: 'monto_discrepante', periodoId: 'periodo-1' });
    // Bitácora de la discrepancia SÍ se registra (queda constancia).
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accion: 'plataforma.pago_suscripcion_monto_discrepante',
        detalle: expect.objectContaining({ monto_esperado_clp: 49000, monto_informado_clp: 10000 }),
      }),
    );
    // Nunca se marca pagado ni se publica el evento de pago confirmado.
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('sin monto informado (evento.montoClp null) → sigue el flujo normal (no bloquea)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: PERIODO_BASE, error: null }, // leer período
        { data: { estado: 'activa' }, error: null }, // leer estado de la suscripción (trial→activa)
        { data: [{ id: 'pago-1' }], error: null }, // update pagos_plataforma (confirmado) .select('id')
        { data: null, error: null }, // update periodos_suscripcion → pagado
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await confirmarPagoSuscripcion(eventoBase({ montoClp: null }));
    expect(resultado).toEqual({ resultado: 'confirmado', periodoId: 'periodo-1' });
  });

  it('monto informado coincide con el esperado → confirmado, marca pagado y publica el evento', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: PERIODO_BASE, error: null }, // leer período
        { data: { estado: 'activa' }, error: null }, // leer estado de la suscripción (trial→activa)
        { data: [{ id: 'pago-1' }], error: null }, // update pagos_plataforma (confirmado) .select('id')
        { data: null, error: null }, // update periodos_suscripcion → pagado
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await confirmarPagoSuscripcion(eventoBase({ montoClp: 49000 }));
    expect(resultado).toEqual({ resultado: 'confirmado', periodoId: 'periodo-1' });

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accion: 'plataforma.pago_suscripcion_confirmado' }),
    );

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'plataforma/pago.confirmado',
        id: 'pago-confirmado-suscripcion-periodo-1',
        data: expect.objectContaining({
          tenantId: 'tenant-a',
          suscripcionId: 'susc-1',
          periodoId: 'periodo-1',
          montoClp: 49000,
          metodo: 'fintoc_link',
        }),
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Transición trial→activa (F2 "Ola 3", ítem E).
  // ---------------------------------------------------------------------------

  it('suscripción en trial + primer pago confirmado → activa la suscripción (bitácora ANTES, idempotente)', async () => {
    const mockClient = crearMockSupabase([
      { data: PERIODO_BASE, error: null }, // leer período
      { data: { estado: 'trial' }, error: null }, // leer estado de la suscripción — SIGUE en trial
      { data: null, error: null }, // update suscripciones → activa (bare await)
      { data: [{ id: 'pago-1' }], error: null }, // update pagos_plataforma (confirmado) .select('id')
      { data: null, error: null }, // update periodos_suscripcion → pagado
    ]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      mockClient as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await confirmarPagoSuscripcion(eventoBase({ montoClp: 49000 }));
    expect(resultado).toEqual({ resultado: 'confirmado', periodoId: 'periodo-1' });

    // Bitácora de activación ANTES del UPDATE, con su propia acción (RNF-04).
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-a',
        actorUsuarioId: null,
        actorTipo: 'sistema',
        accion: 'plataforma.trial_activado_por_pago',
        entidadTipo: 'suscripcion',
        entidadId: 'susc-1',
      }),
    );

    // El UPDATE de la suscripción exige estado='trial' como guarda idempotente.
    const updateCalls = (mockClient.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCalls[0]![0]).toMatchObject({ estado: 'activa' });
  });

  it('suscripción YA activa + pago confirmado → NO reactiva ni duplica bitácora de activación', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: PERIODO_BASE, error: null }, // leer período
        { data: { estado: 'activa' }, error: null }, // ya activa
        { data: [{ id: 'pago-1' }], error: null }, // update pagos_plataforma (confirmado) .select('id')
        { data: null, error: null }, // update periodos_suscripcion → pagado
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const resultado = await confirmarPagoSuscripcion(eventoBase({ montoClp: 49000 }));
    expect(resultado).toEqual({ resultado: 'confirmado', periodoId: 'periodo-1' });

    const accionesRegistradas = vi
      .mocked(registrarEnBitacora)
      .mock.calls.map((c) => (c[1] as { accion: string }).accion);
    expect(accionesRegistradas).not.toContain('plataforma.trial_activado_por_pago');
  });
});

// =============================================================================
// confirmarCobroRecurrente — auto-cobro por mandato (F1-E)
// =============================================================================

function eventoCobroExitoso(overrides: Partial<Extract<EventoRecurrenteNormalizado, { tipo: 'cobro_exitoso' }>> = {}): Extract<
  EventoRecurrenteNormalizado,
  { tipo: 'cobro_exitoso' }
> {
  return {
    tipo: 'cobro_exitoso',
    cobroExternoId: 'stub_cobro_periodo-1',
    periodoId: 'periodo-1',
    tenantId: 'tenant-a',
    montoClp: 49000,
    ...overrides,
  };
}

function eventoCobroFallido(overrides: Partial<Extract<EventoRecurrenteNormalizado, { tipo: 'cobro_fallido' }>> = {}): Extract<
  EventoRecurrenteNormalizado,
  { tipo: 'cobro_fallido' }
> {
  return {
    tipo: 'cobro_fallido',
    cobroExternoId: 'stub_cobro_periodo-1',
    periodoId: 'periodo-1',
    tenantId: 'tenant-a',
    motivoSaneado: 'fondos insuficientes',
    ...overrides,
  };
}

describe('confirmarCobroRecurrente', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin período resoluble (sin periodoId ni fila pagos_plataforma) → sin_periodo', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: null, error: null }]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await confirmarCobroRecurrente(eventoCobroExitoso({ periodoId: null }));
    expect(resultado).toEqual({ resultado: 'sin_periodo', periodoId: null });
  });

  it('período ya pagado → ya_pagado, idempotente ante replay del webhook', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: { ...PERIODO_BASE, estado: 'pagado' }, error: null }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );
    const resultado = await confirmarCobroRecurrente(eventoCobroExitoso());
    expect(resultado).toEqual({ resultado: 'ya_pagado', periodoId: 'periodo-1' });
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('cobro_fallido → fallido_registrado, no toca el período, no publica pago.confirmado', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: PERIODO_BASE, error: null }, // leer período
        { data: null, error: null }, // update pagos_plataforma → fallido (bare await)
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await confirmarCobroRecurrente(eventoCobroFallido());
    expect(resultado).toEqual({ resultado: 'fallido_registrado', periodoId: 'periodo-1' });
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('monto informado distinto del esperado → monto_discrepante, NO marca pagado (misma regla H-4)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([{ data: PERIODO_BASE, error: null }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );
    const resultado = await confirmarCobroRecurrente(eventoCobroExitoso({ montoClp: 1000 }));
    expect(resultado).toEqual({ resultado: 'monto_discrepante', periodoId: 'periodo-1' });
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accion: 'plataforma.pago_suscripcion_monto_discrepante',
        detalle: expect.objectContaining({
          metodo: 'fintoc_recurrente',
          monto_esperado_clp: 49000,
          monto_informado_clp: 1000,
        }),
      }),
    );
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('cobro_exitoso con monto correcto → confirmado, marca pagado y publica pago.confirmado (fintoc_recurrente)', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: PERIODO_BASE, error: null }, // leer período
        { data: { estado: 'activa' }, error: null }, // leer estado de la suscripción (trial→activa)
        { data: [{ id: 'pago-1' }], error: null }, // update pagos_plataforma (confirmado) .select('id')
        { data: null, error: null }, // update periodos_suscripcion → pagado
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await confirmarCobroRecurrente(eventoCobroExitoso());
    expect(resultado).toEqual({ resultado: 'confirmado', periodoId: 'periodo-1' });

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'plataforma/pago.confirmado',
        // Mismo `id` determinístico que el flujo de link — un período solo se
        // paga una vez sin importar el método.
        id: 'pago-confirmado-suscripcion-periodo-1',
        data: expect.objectContaining({
          tenantId: 'tenant-a',
          suscripcionId: 'susc-1',
          periodoId: 'periodo-1',
          montoClp: 49000,
          metodo: 'fintoc_recurrente',
        }),
      }),
    );
  });

  it('correlación por pago_externo_id (cobroExternoId) cuando el evento no trae periodoId', async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearMockSupabase([
        { data: { periodo_id: 'periodo-1' }, error: null }, // lookup por pago_externo_id
        { data: PERIODO_BASE, error: null }, // leer período
        { data: { estado: 'activa' }, error: null }, // leer estado de la suscripción (trial→activa)
        { data: [{ id: 'pago-1' }], error: null }, // update pagos_plataforma confirmado
        { data: null, error: null }, // update periodo → pagado
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const resultado = await confirmarCobroRecurrente(eventoCobroExitoso({ periodoId: null }));
    expect(resultado).toEqual({ resultado: 'confirmado', periodoId: 'periodo-1' });
  });
});
