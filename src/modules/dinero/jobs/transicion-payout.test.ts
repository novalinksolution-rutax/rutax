/**
 * Tests de `aplicarTransicionPayout` — transición compartida de estado de
 * payout (webhook Fintoc + polling), F19/Fase 3.
 *
 * Cubre:
 * 1. Helpers puros: `estadoPayoutDestino` y `debeRevertirLiquidacion` — todas
 *    las ramas, sin mocks.
 * 2. `aplicarTransicionPayout` con un cliente Supabase falso (en memoria):
 *    - 'confirmado' desde 'enviado' → payout confirmado + bitácora.
 *    - 'confirmado' idempotente (replay) → no vuelve a mutar ni a auditar.
 *    - 'rechazado' con liquidación 'pagada' → REVIERTE a 'emitida' + crea la
 *      excepción `payout_revertido_post_confirmacion` + alerta 'error'.
 *    - 'rechazado' con liquidación YA revertida (replay) → no duplica la
 *      excepción ni la alerta... (la alerta si se repite, ver nota) — la
 *      excepción NUNCA se duplica.
 *    - 'fallido' con liquidación 'emitida' (nunca pagada) → sin reversión.
 *    - 'pendiente' → no-op total, cero llamadas de mutación.
 *    - 'desconocido' → CERO mutación financiera; solo alerta + excepción
 *      `payout_estado_no_reconocido` (NO `payout_revertido_post_confirmacion`
 *      — separación por recomendación de QA, migración 20260709000001).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('@/lib/observabilidad', () => ({
  capturarMensaje: vi.fn().mockResolvedValue(undefined),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { capturarMensaje } from '@/lib/observabilidad';
import {
  aplicarTransicionPayout,
  estadoPayoutDestino,
  debeRevertirLiquidacion,
} from './transicion-payout';

// =============================================================================
// 1. Helpers puros
// =============================================================================

describe('estadoPayoutDestino — mapeo puro estado externo → estado payout', () => {
  it("'confirmado' → 'confirmado'", () => {
    expect(estadoPayoutDestino('confirmado')).toBe('confirmado');
  });
  it("'rechazado' → 'rechazado'", () => {
    expect(estadoPayoutDestino('rechazado')).toBe('rechazado');
  });
  it("'fallido' → 'fallido'", () => {
    expect(estadoPayoutDestino('fallido')).toBe('fallido');
  });
  it("'pendiente' → null (sin mutación)", () => {
    expect(estadoPayoutDestino('pendiente')).toBeNull();
  });
  it("'desconocido' → null (sin mutación)", () => {
    expect(estadoPayoutDestino('desconocido')).toBeNull();
  });
});

describe('debeRevertirLiquidacion — pura, sin I/O', () => {
  it("'rechazado' + liquidación 'pagada' → true", () => {
    expect(debeRevertirLiquidacion('rechazado', 'pagada')).toBe(true);
  });
  it("'fallido' + liquidación 'pagada' → true", () => {
    expect(debeRevertirLiquidacion('fallido', 'pagada')).toBe(true);
  });
  it("'rechazado' + liquidación 'emitida' → false (nunca se marcó pagada)", () => {
    expect(debeRevertirLiquidacion('rechazado', 'emitida')).toBe(false);
  });
  it("'confirmado' + liquidación 'pagada' → false (no es rama de reversión)", () => {
    expect(debeRevertirLiquidacion('confirmado', 'pagada')).toBe(false);
  });
  it("'pendiente'/'desconocido' → siempre false", () => {
    expect(debeRevertirLiquidacion('pendiente', 'pagada')).toBe(false);
    expect(debeRevertirLiquidacion('desconocido', 'pagada')).toBe(false);
  });
  it("'rechazado' + liquidación 'borrador' → false", () => {
    expect(debeRevertirLiquidacion('rechazado', 'borrador')).toBe(false);
  });
});

// =============================================================================
// 2. Fake Supabase en memoria — soporta exactamente los patrones de consulta
//    que usa `aplicarTransicionPayout` (payouts_conductor, liquidaciones,
//    eventos_conciliacion, bitacora_auditoria).
// =============================================================================

type Fila = Record<string, unknown>;

function crearFakeSupabase(estado: { payout: Fila; liquidacion: Fila }) {
  const payout: Fila = { ...estado.payout };
  const liquidacion: Fila = { ...estado.liquidacion };
  const eventosConciliacion: Fila[] = [];
  const bitacora: Fila[] = [];

  function coincideFiltros(fila: Fila, filtros: Array<[string, unknown]>): boolean {
    return filtros.every(([campo, valor]) => fila[campo] === valor);
  }

  function builderFilaUnica(fila: Fila) {
    return {
      select(_cols?: string) {
        const filtros: Array<[string, unknown]> = [];
        const api = {
          eq(campo: string, valor: unknown) {
            filtros.push([campo, valor]);
            return api;
          },
          async maybeSingle() {
            return { data: coincideFiltros(fila, filtros) ? { ...fila } : null, error: null };
          },
        };
        return api;
      },
      update(patch: Fila) {
        const filtros: Array<[string, unknown]> = [];
        const aplicarSiCoincide = () => {
          const coincide = coincideFiltros(fila, filtros);
          if (coincide) Object.assign(fila, patch);
          return coincide;
        };
        const api = {
          eq(campo: string, valor: unknown) {
            filtros.push([campo, valor]);
            return api;
          },
          select(_cols?: string) {
            return {
              async maybeSingle() {
                const coincide = aplicarSiCoincide();
                return { data: coincide ? { id: fila.id } : null, error: null };
              },
            };
          },
          // Soporta el patrón `update().eq()...eq()` SIN `.select()` encadenado,
          // `await`-eado directamente — igual que el query builder real de
          // supabase-js (cada paso de la cadena es thenable).
          then(resolve: (v: { data: null; error: null }) => void) {
            aplicarSiCoincide();
            resolve({ data: null, error: null });
          },
        };
        return api;
      },
    };
  }

  function builderEventos() {
    return {
      select(_cols?: string) {
        const filtros: Array<[string, unknown]> = [];
        const api = {
          eq(campo: string, valor: unknown) {
            filtros.push([campo, valor]);
            return api;
          },
          async maybeSingle() {
            const encontrada = eventosConciliacion.find((f) => coincideFiltros(f, filtros));
            return { data: encontrada ? { id: encontrada.id } : null, error: null };
          },
        };
        return api;
      },
      insert(row: Fila) {
        eventosConciliacion.push({ id: `evt-conc-${eventosConciliacion.length + 1}`, ...row });
        return Promise.resolve({ error: null });
      },
    };
  }

  function builderBitacora() {
    return {
      insert(row: Fila) {
        bitacora.push(row);
        return Promise.resolve({ error: null });
      },
    };
  }

  const client = {
    schema(_esquema: string) {
      return {
        from(tabla: string) {
          if (tabla === 'payouts_conductor') return builderFilaUnica(payout);
          if (tabla === 'liquidaciones') return builderFilaUnica(liquidacion);
          if (tabla === 'eventos_conciliacion') return builderEventos();
          throw new Error(`tabla no mockeada en el fake: ${tabla}`);
        },
      };
    },
    from(tabla: string) {
      if (tabla === 'bitacora_auditoria') return builderBitacora();
      throw new Error(`from() directo no mockeado: ${tabla}`);
    },
  };

  return { client, payout, liquidacion, eventosConciliacion, bitacora };
}

const TENANT_ID = 'tenant-A';
const PAYOUT_ID = 'payout-001';
const LIQUIDACION_ID = 'liq-001';
const DRIVER_ID = 'driver-001';

function payoutBase(estado: string): Fila {
  return { id: PAYOUT_ID, tenant_id: TENANT_ID, driver_id: DRIVER_ID, liquidacion_id: LIQUIDACION_ID, estado };
}

function liquidacionBase(estado: string): Fila {
  return { id: LIQUIDACION_ID, tenant_id: TENANT_ID, estado };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// 3. 'confirmado'
// =============================================================================

describe("aplicarTransicionPayout — estado externo 'confirmado'", () => {
  it("payout 'enviado' → pasa a 'confirmado', liquidación 'emitida'→'pagada', bitácora registrada", async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('enviado'),
      liquidacion: liquidacionBase('emitida'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    const resultado = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'confirmado',
      motivo: null,
      comprobanteRef: 'receipt_123',
      origen: 'webhook',
      jobRunId: 'run-1',
    });

    expect(resultado.resultado).toBe('confirmado');
    expect(resultado.transicionAplicada).toBe(true);
    expect(resultado.liquidacionRevertida).toBe(false);
    expect(fake.payout.estado).toBe('confirmado');
    expect(fake.payout.comprobante_ref).toBe('receipt_123');
    expect(fake.liquidacion.estado).toBe('pagada');
    expect(fake.bitacora).toHaveLength(1);
    expect(fake.bitacora[0].accion).toBe('dinero.payout_confirmado');
    // Ninguna excepción de conciliación en el camino feliz.
    expect(fake.eventosConciliacion).toHaveLength(0);
  });

  it("payout YA 'confirmado' (replay) → no-op idempotente, sin bitácora duplicada", async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('confirmado'),
      liquidacion: liquidacionBase('pagada'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    const resultado = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'confirmado',
      motivo: null,
      comprobanteRef: 'receipt_123',
      origen: 'webhook',
      jobRunId: 'run-2',
    });

    expect(resultado.transicionAplicada).toBe(false);
    expect(fake.bitacora).toHaveLength(0);
    // La proyección de liquidación es un no-op (ya estaba 'pagada').
    expect(fake.liquidacion.estado).toBe('pagada');
  });

  it("liquidación ya 'pagada' (marcada optimistamente por ejecutar-payout) → confirmar el payout no la toca dos veces", async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('enviado'),
      liquidacion: liquidacionBase('pagada'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    const resultado = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'confirmado',
      motivo: null,
      comprobanteRef: null,
      origen: 'polling',
    });

    expect(resultado.transicionAplicada).toBe(true);
    expect(fake.payout.estado).toBe('confirmado');
    expect(fake.liquidacion.estado).toBe('pagada');
  });
});

// =============================================================================
// 4. 'rechazado' / 'fallido' — CASO DE REVERSIÓN POST-CONFIRMACIÓN
// =============================================================================

describe("aplicarTransicionPayout — 'rechazado'/'fallido' con liquidación 'pagada' (REVERSIÓN)", () => {
  it("'rechazado' + liquidación 'pagada' → revierte a 'emitida', crea excepción, alerta 'error'", async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('confirmado'),
      liquidacion: liquidacionBase('pagada'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    const resultado = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'rechazado',
      motivo: 'devuelto por el banco destino',
      comprobanteRef: null,
      origen: 'webhook',
      jobRunId: 'run-3',
    });

    expect(resultado.resultado).toBe('rechazado');
    expect(resultado.transicionAplicada).toBe(true);
    expect(resultado.liquidacionRevertida).toBe(true);
    expect(fake.payout.estado).toBe('rechazado');
    expect(fake.liquidacion.estado).toBe('emitida'); // REVERTIDA

    // Excepción de conciliación creada exactamente una vez.
    expect(fake.eventosConciliacion).toHaveLength(1);
    expect(fake.eventosConciliacion[0].tipo_diferencia).toBe('payout_revertido_post_confirmacion');
    expect(fake.eventosConciliacion[0].liquidacion_id).toBe(LIQUIDACION_ID);
    expect(fake.eventosConciliacion[0].descripcion).toContain('devuelto por el banco destino');

    // Alerta de nivel 'error' — señal financiera real.
    expect(capturarMensaje).toHaveBeenCalledWith(
      expect.stringContaining('Reversión de payout post-confirmación'),
      'error',
      expect.objectContaining({ tenantId: TENANT_ID }),
    );

    // Bitácora registrada.
    expect(fake.bitacora).toHaveLength(1);
    expect(fake.bitacora[0].accion).toBe('dinero.payout_rechazado');
    expect((fake.bitacora[0].detalle as Fila).liquidacion_revertida).toBe(true);
  });

  it("'fallido' + liquidación 'pagada' → misma reversión que 'rechazado'", async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('enviado'),
      liquidacion: liquidacionBase('pagada'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    const resultado = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'fallido',
      motivo: null,
      comprobanteRef: null,
      origen: 'polling',
    });

    expect(resultado.liquidacionRevertida).toBe(true);
    expect(fake.payout.estado).toBe('fallido');
    expect(fake.liquidacion.estado).toBe('emitida');
    expect(fake.eventosConciliacion).toHaveLength(1);
  });

  it("replay del mismo evento de reversión → NO duplica la excepción de conciliación", async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('confirmado'),
      liquidacion: liquidacionBase('pagada'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    // Primera aplicación: revierte de verdad.
    await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'rechazado',
      motivo: 'x',
      comprobanteRef: null,
      origen: 'webhook',
    });
    expect(fake.eventosConciliacion).toHaveLength(1);

    // Segunda aplicación (replay): el payout ya está 'rechazado' y la
    // liquidación ya está 'emitida' — no debe duplicar ni fallar.
    const segundo = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'rechazado',
      motivo: 'x',
      comprobanteRef: null,
      origen: 'webhook',
    });

    expect(segundo.transicionAplicada).toBe(false);
    expect(segundo.liquidacionRevertida).toBe(false);
    expect(fake.eventosConciliacion).toHaveLength(1); // sigue siendo 1, no 2
  });

  it("'rechazado' con liquidación NUNCA pagada (sigue 'emitida') → sin reversión, sin excepción", async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('enviado'),
      liquidacion: liquidacionBase('emitida'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    const resultado = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'rechazado',
      motivo: 'cuenta inválida',
      comprobanteRef: null,
      origen: 'webhook',
    });

    expect(resultado.liquidacionRevertida).toBe(false);
    expect(fake.liquidacion.estado).toBe('emitida');
    expect(fake.eventosConciliacion).toHaveLength(0);
    expect(capturarMensaje).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 4.1 · DESORDEN: 'confirmado' tardío llega DESPUÉS de un 'rechazado'/'fallido'
//      ya aplicado — NO debe "revivir" el payout (los webhooks de Fintoc
//      pueden llegar fuera de orden).
// =============================================================================

describe("aplicarTransicionPayout — desorden: 'confirmado' tardío tras estado terminal negativo", () => {
  it("payout ya 'rechazado' (liquidación ya revertida a 'emitida') + evento 'confirmado' tardío → NO revive, no reabre la liquidación", async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('rechazado'),
      liquidacion: liquidacionBase('emitida'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    const resultado = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'confirmado',
      motivo: null,
      comprobanteRef: 'receipt_tardio',
      origen: 'webhook',
      jobRunId: 'run-desorden-1',
    });

    // El payout NO vuelve a 'confirmado': el estado terminal negativo se respeta.
    expect(fake.payout.estado).toBe('rechazado');
    // La liquidación NO se reabre a 'pagada'.
    expect(fake.liquidacion.estado).toBe('emitida');
    expect(resultado.transicionAplicada).toBe(false);
    expect(resultado.liquidacionRevertida).toBe(false);
    // No hay mutación financiera que auditar → sin bitácora nueva.
    expect(fake.bitacora).toHaveLength(0);
    // No es una reversión (ya se registró antes) — pero SÍ se alerta por visibilidad
    // del evento fuera de orden.
    expect(capturarMensaje).toHaveBeenCalledWith(
      expect.stringContaining('fuera de orden'),
      'warning',
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });

  it("payout ya 'fallido' + evento 'confirmado' tardío → NO revive", async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('fallido'),
      liquidacion: liquidacionBase('emitida'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'confirmado',
      motivo: null,
      comprobanteRef: null,
      origen: 'webhook',
    });

    expect(fake.payout.estado).toBe('fallido');
    expect(fake.liquidacion.estado).toBe('emitida');
  });

  it("secuencia completa fuera de orden: 'rechazado' (revierte) seguido de 'confirmado' tardío (no revive) — estado financiero final coherente", async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('confirmado'),
      liquidacion: liquidacionBase('pagada'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    // 1) Llega primero (en el orden de procesamiento) el 'rechazado' real.
    const primero = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'rechazado',
      motivo: 'devuelto por el banco',
      comprobanteRef: null,
      origen: 'webhook',
    });
    expect(primero.liquidacionRevertida).toBe(true);
    expect(fake.eventosConciliacion).toHaveLength(1);

    // 2) Llega DESPUÉS el 'confirmado' que en la realidad ocurrió ANTES
    //    (reordenado en el transporte / reintento tardío de Fintoc).
    const segundo = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'confirmado',
      motivo: null,
      comprobanteRef: null,
      origen: 'webhook',
    });

    // El estado financiero final sigue siendo el CORRECTO (rechazado/emitida),
    // no el revivido por el evento tardío.
    expect(segundo.transicionAplicada).toBe(false);
    expect(fake.payout.estado).toBe('rechazado');
    expect(fake.liquidacion.estado).toBe('emitida');
    // La excepción de conciliación de la reversión genuina sigue siendo una sola.
    expect(fake.eventosConciliacion).toHaveLength(1);
  });
});

// =============================================================================
// 5. 'pendiente' — no-op total
// =============================================================================

describe("aplicarTransicionPayout — 'pendiente'", () => {
  it('no muta el payout ni la liquidación, no registra bitácora ni alerta', async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('enviado'),
      liquidacion: liquidacionBase('pagada'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    const resultado = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'pendiente',
      motivo: null,
      comprobanteRef: null,
      origen: 'polling',
    });

    expect(resultado.resultado).toBe('pendiente');
    expect(resultado.transicionAplicada).toBe(false);
    expect(resultado.liquidacionRevertida).toBe(false);
    expect(fake.payout.estado).toBe('enviado');
    expect(fake.liquidacion.estado).toBe('pagada');
    expect(fake.bitacora).toHaveLength(0);
    expect(fake.eventosConciliacion).toHaveLength(0);
    expect(capturarMensaje).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 6. 'desconocido' — CERO mutación financiera
// =============================================================================

describe("aplicarTransicionPayout — 'desconocido' (estado externo no reconocido)", () => {
  it('no muta el payout ni la liquidación — solo alerta (warning) + excepción para revisión humana', async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('enviado'),
      liquidacion: liquidacionBase('pagada'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    const resultado = await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'desconocido',
      motivo: null,
      comprobanteRef: null,
      origen: 'webhook',
      jobRunId: 'run-9',
    });

    expect(resultado.resultado).toBe('desconocido');
    expect(resultado.transicionAplicada).toBe(false);
    expect(resultado.liquidacionRevertida).toBe(false);

    // CERO mutación financiera: ni payout ni liquidación cambiaron.
    expect(fake.payout.estado).toBe('enviado');
    expect(fake.liquidacion.estado).toBe('pagada');

    // Bitácora NO se registra (no hubo mutación financiera que auditar).
    expect(fake.bitacora).toHaveLength(0);

    // Sí hay alerta (warning) y una excepción para revisión humana.
    expect(capturarMensaje).toHaveBeenCalledWith(
      expect.stringContaining('desconocido'),
      'warning',
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
    expect(fake.eventosConciliacion).toHaveLength(1);
    // Separado de la reversión genuina (§migración 20260709000001): un estado
    // externo no reconocido NO es un pago pendiente.
    expect(fake.eventosConciliacion[0].tipo_diferencia).toBe('payout_estado_no_reconocido');
  });

  it('replay del mismo evento desconocido → no duplica la excepción', async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('enviado'),
      liquidacion: liquidacionBase('emitida'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'desconocido',
      motivo: null,
      comprobanteRef: null,
      origen: 'polling',
    });
    await aplicarTransicionPayout({
      tenantId: TENANT_ID,
      payoutId: PAYOUT_ID,
      estadoExterno: 'desconocido',
      motivo: null,
      comprobanteRef: null,
      origen: 'polling',
    });

    expect(fake.eventosConciliacion).toHaveLength(1);
  });
});

// =============================================================================
// 7. Payout no encontrado
// =============================================================================

describe('aplicarTransicionPayout — payout inexistente', () => {
  it('lanza si el payout no existe en el tenant (defensa: nunca confía ciegamente en el evento)', async () => {
    const fake = crearFakeSupabase({
      payout: payoutBase('enviado'),
      liquidacion: liquidacionBase('emitida'),
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(fake.client as never);

    await expect(
      aplicarTransicionPayout({
        tenantId: TENANT_ID,
        payoutId: 'payout-inexistente',
        estadoExterno: 'confirmado',
        motivo: null,
        comprobanteRef: null,
        origen: 'webhook',
      }),
    ).rejects.toThrow(/no encontrado/);
  });
});
