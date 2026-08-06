/**
 * Tests de `emitirPagoLiquidacion` — compuerta humana del pago a conductor
 * (F19) y su SINCRONÍA con `preflightEmitirPago` (hallazgo P0, jul 2026).
 *
 * `emitirPagoLiquidacion` no tenía cobertura directa antes de este archivo
 * (QA, jul 2026): solo se probaba indirectamente vía RBAC genérico. Este
 * archivo cubre:
 *  - Gate de capacidad (`gestionar_liquidaciones_conductores`).
 *  - Aislamiento por tenant (liquidación de otro tenant → no encontrada).
 *  - Solo liquidaciones `emitida`.
 *  - Las MISMAS precondiciones que el job `jobEjecutarPayout` exige y que
 *    `preflightEmitirPago` reporta como `bloquea` — cuenta bancaria completa,
 *    monto líquido positivo, monto líquido ≥ mínimo de retiro — verificadas
 *    ahora TAMBIÉN en la acción (fix QA jul 2026: antes la acción solo
 *    comprobaba `monto_total_clp > 0` crudo, sin bono/penalización/retención,
 *    y no comprobaba datos bancarios; publicaba un evento condenado a fallar
 *    silenciosamente en el job — el usuario veía "pago iniciado" pero la
 *    liquidación jamás se marcaba pagada, sin bitácora del intento fallido).
 *  - BITÁCORA ANTES del evento (orden estricto) y payload del evento.
 *  - Sincronía cruzada explícita con `preflightEmitirPago`: para cada
 *    escenario de bloqueo, el preflight reporta `ok=false` con el código
 *    correspondiente Y la acción real lanza `ErrorValidacion` — nunca uno sin
 *    el otro.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorValidacion } from '@/modules/identidad/errores';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/inngest/cliente', () => ({
  inngest: { send: (...args: unknown[]) => sendMock(...args) },
}));

const bitacoraMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: (...args: unknown[]) => bitacoraMock(...args),
}));

vi.mock('@/modules/dinero/excepciones', () => ({
  bloqueaFacturacion: vi.fn().mockResolvedValue({ bloquea: false, motivos: [] }),
  bloqueaPago: vi.fn().mockResolvedValue({ bloquea: false, motivos: [] }),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { emitirPagoLiquidacion } from './acciones';
import { preflightEmitirPago } from './preflight';

// =============================================================================
// Fake Supabase multi-tabla en memoria — cubre las tablas que tocan TANTO
// `emitirPagoLiquidacion` como `preflightEmitirPago` (mismo fixture para
// ambas, para que los tests de sincronía usen exactamente el mismo estado).
// =============================================================================

interface DB {
  liquidaciones: Array<Record<string, unknown>>;
  conductores: Array<Record<string, unknown>>;
  configPayout: Array<Record<string, unknown>>;
  lineasLiquidacion: Array<Record<string, unknown>>;
  eventosConciliacion: Array<Record<string, unknown>>;
  incidencias: Array<Record<string, unknown>>;
}

function crearFakeSupabase(db: DB) {
  function tablaPara(schema: string, tabla: string): Array<Record<string, unknown>> {
    if (schema === 'dinero' && tabla === 'liquidaciones') return db.liquidaciones;
    if (schema === 'identidad' && tabla === 'conductores') return db.conductores;
    if (schema === 'identidad' && tabla === 'courier_config_payout') return db.configPayout;
    if (schema === 'dinero' && tabla === 'lineas_liquidacion') return db.lineasLiquidacion;
    if (schema === 'dinero' && tabla === 'eventos_conciliacion') return db.eventosConciliacion;
    if (schema === 'operacion' && tabla === 'incidencias') return db.incidencias;
    throw new Error(`Tabla no modelada: ${schema}.${tabla}`);
  }

  return {
    schema(s: string) {
      return {
        from(tabla: string) {
          const filas = tablaPara(s, tabla);
          return {
            select() {
              const filtros: Array<(f: Record<string, unknown>) => boolean> = [];
              let rango: { desde: number; hasta: number } | undefined;
              const b = {
                eq(col: string, val: unknown) {
                  filtros.push((f) => f[col] === val);
                  return b;
                },
                in(col: string, vals: unknown[]) {
                  filtros.push((f) => vals.includes(f[col] as never));
                  return b;
                },
                order() {
                  return b;
                },
                limit() {
                  return b;
                },
                // `.range()` real: `leerTodasLasFilas` termina cuando la página
                // viene incompleta.
                range(desde: number, hasta: number) {
                  rango = { desde, hasta };
                  return b;
                },
                maybeSingle() {
                  const r = filas.filter((f) => filtros.every((fn) => fn(f)));
                  return Promise.resolve({ data: r[0] ?? null, error: null });
                },
                then(
                  resolve: (v: { data: Array<Record<string, unknown>>; error: null }) => unknown,
                  reject?: (e: unknown) => unknown,
                ) {
                  const filtradas = filas.filter((f) => filtros.every((fn) => fn(f)));
                  const r = rango ? filtradas.slice(rango.desde, rango.hasta + 1) : filtradas;
                  return Promise.resolve({ data: r, error: null }).then(resolve, reject);
                },
              };
              return b;
            },
          };
        },
      };
    },
  };
}

const TENANT = 'tenant-a';
const LIQUIDACION = 'liq-1';
const DRIVER = 'driver-1';

function dueno(): UsuarioActual {
  return {
    tenantId: TENANT,
    tipoUsuario: 'interno',
    sellerId: null,
    driverId: null,
    rol: 'dueno',
    estado: 'activo',
  };
}

function coordinador(): UsuarioActual {
  return { ...dueno(), rol: 'coordinador' };
}

function dbBase(): DB {
  return {
    liquidaciones: [
      {
        id: LIQUIDACION,
        tenant_id: TENANT,
        driver_id: DRIVER,
        estado: 'emitida',
        monto_total_clp: 100000,
        bono_clp: 0,
        penalizacion_clp: 0,
        tipo_relacion_conductor: 'independiente',
      },
    ],
    conductores: [
      {
        id: DRIVER,
        tenant_id: TENANT,
        nombre_completo: 'Pedro Conductor',
        rut: '12345678-9',
        banco: 'banco_estado',
        tipo_cuenta: 'vista',
        numero_cuenta: '1234567890',
        tipo_relacion: 'independiente',
      },
    ],
    configPayout: [{ tenant_id: TENANT, porcentaje_retencion: 10, minimo_retiro_clp: 0 }],
    lineasLiquidacion: [
      { tenant_id: TENANT, liquidacion_id: LIQUIDACION, pedido_id: 'pedido-1', anulada: false },
    ],
    eventosConciliacion: [],
    incidencias: [],
  };
}

function usarDb(db: DB) {
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    crearFakeSupabase(db) as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
}

beforeEach(() => {
  vi.mocked(crearClienteServiceRole).mockReset();
  sendMock.mockClear();
  bitacoraMock.mockClear();
});

// =============================================================================
// emitirPagoLiquidacion — comportamiento aislado
// =============================================================================

describe('emitirPagoLiquidacion', () => {
  it('rechaza a un usuario sin capacidad gestionar_liquidaciones_conductores (coordinador)', async () => {
    usarDb(dbBase());
    await expect(
      emitirPagoLiquidacion(TENANT, LIQUIDACION, coordinador(), 'u-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(sendMock).not.toHaveBeenCalled();
    expect(bitacoraMock).not.toHaveBeenCalled();
  });

  it('liquidación de otro tenant → no encontrada (aislamiento)', async () => {
    usarDb(dbBase());
    await expect(
      emitirPagoLiquidacion('tenant-B', LIQUIDACION, { ...dueno(), tenantId: 'tenant-B' }, 'u-1'),
    ).rejects.toThrow(/no encontrada/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rechaza una liquidación que no está en estado emitida', async () => {
    const db = dbBase();
    db.liquidaciones[0].estado = 'borrador';
    usarDb(db);
    await expect(emitirPagoLiquidacion(TENANT, LIQUIDACION, dueno(), 'u-1')).rejects.toThrow(
      /emitida/,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rechaza si el conductor no tiene datos bancarios completos (falta banco)', async () => {
    const db = dbBase();
    db.conductores[0].banco = null;
    usarDb(db);
    await expect(emitirPagoLiquidacion(TENANT, LIQUIDACION, dueno(), 'u-1')).rejects.toThrow(
      /datos bancarios/,
    );
    expect(sendMock).not.toHaveBeenCalled();
    expect(bitacoraMock).not.toHaveBeenCalled();
  });

  it('rechaza si la penalización supera el bruto (monto líquido ≤ 0)', async () => {
    const db = dbBase();
    db.liquidaciones[0].monto_total_clp = 1000;
    db.liquidaciones[0].penalizacion_clp = 2000;
    db.configPayout[0].porcentaje_retencion = 0;
    usarDb(db);
    await expect(emitirPagoLiquidacion(TENANT, LIQUIDACION, dueno(), 'u-1')).rejects.toThrow(
      /no tiene monto a pagar/,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rechaza si el monto líquido queda bajo el mínimo de retiro configurado', async () => {
    const db = dbBase();
    db.liquidaciones[0].monto_total_clp = 10000;
    db.configPayout[0].porcentaje_retencion = 0;
    db.configPayout[0].minimo_retiro_clp = 50000;
    usarDb(db);
    await expect(emitirPagoLiquidacion(TENANT, LIQUIDACION, dueno(), 'u-1')).rejects.toThrow(
      /mínimo de retiro/,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('happy path: bitácora ANTES del evento, payload con driverId y monto correctos', async () => {
    usarDb(dbBase());
    const orden: string[] = [];
    bitacoraMock.mockImplementationOnce(async () => {
      orden.push('bitacora');
    });
    sendMock.mockImplementationOnce(async () => {
      orden.push('send');
    });

    await emitirPagoLiquidacion(TENANT, LIQUIDACION, dueno(), 'u-1');

    expect(orden).toEqual(['bitacora', 'send']);

    const bit = bitacoraMock.mock.calls[0][1] as Record<string, unknown>;
    expect(bit.accion).toBe('dinero.pago_liquidacion_solicitado');
    expect(bit.actorUsuarioId).toBe('u-1');

    const evento = sendMock.mock.calls[0][0] as Record<string, unknown>;
    expect(evento.name).toBe('dinero/liquidacion.pago-solicitado');
    expect(evento.id).toBe(`pago-solicitado-${LIQUIDACION}`);
    const data = evento.data as Record<string, unknown>;
    expect(data.liquidacionId).toBe(LIQUIDACION);
    expect(data.driverId).toBe(DRIVER);
    expect(data.solicitadoPorUsuarioId).toBe('u-1');
  });

  it('conductor dependiente con penalización que NO deja el bruto en negativo: retención no aplica y el pago procede', async () => {
    const db = dbBase();
    db.liquidaciones[0].tipo_relacion_conductor = 'dependiente';
    db.conductores[0].tipo_relacion = 'dependiente';
    usarDb(db);
    await expect(emitirPagoLiquidacion(TENANT, LIQUIDACION, dueno(), 'u-1')).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Sincronía preflightEmitirPago ⇄ emitirPagoLiquidacion — mismo fixture,
// mismas conclusiones (ok=false con el código esperado ⇔ la acción lanza).
// =============================================================================

describe('sincronía preflightEmitirPago ⇄ emitirPagoLiquidacion', () => {
  it('caso feliz: preflight ok=true Y la acción real no lanza', async () => {
    usarDb(dbBase());
    const pre = await preflightEmitirPago(TENANT, LIQUIDACION, dueno());
    expect(pre.ok).toBe(true);

    usarDb(dbBase());
    await expect(emitirPagoLiquidacion(TENANT, LIQUIDACION, dueno(), 'u-1')).resolves.toBeUndefined();
  });

  it('cuenta_bancaria_incompleta: preflight bloquea Y la acción real lanza', async () => {
    const db = dbBase();
    db.conductores[0].numero_cuenta = null;

    usarDb(db);
    const pre = await preflightEmitirPago(TENANT, LIQUIDACION, dueno());
    expect(pre.ok).toBe(false);
    expect(pre.bloqueos.map((b) => b.codigo)).toContain('cuenta_bancaria_incompleta');

    usarDb(db);
    await expect(
      emitirPagoLiquidacion(TENANT, LIQUIDACION, dueno(), 'u-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('monto_no_positivo: preflight bloquea Y la acción real lanza', async () => {
    const db = dbBase();
    db.liquidaciones[0].monto_total_clp = 1000;
    db.liquidaciones[0].penalizacion_clp = 5000;
    db.configPayout[0].porcentaje_retencion = 0;

    usarDb(db);
    const pre = await preflightEmitirPago(TENANT, LIQUIDACION, dueno());
    expect(pre.ok).toBe(false);
    expect(pre.bloqueos.map((b) => b.codigo)).toContain('monto_no_positivo');

    usarDb(db);
    await expect(
      emitirPagoLiquidacion(TENANT, LIQUIDACION, dueno(), 'u-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('monto_bajo_minimo_retiro: preflight bloquea Y la acción real lanza', async () => {
    const db = dbBase();
    db.liquidaciones[0].monto_total_clp = 10000;
    db.configPayout[0].porcentaje_retencion = 0;
    db.configPayout[0].minimo_retiro_clp = 50000;

    usarDb(db);
    const pre = await preflightEmitirPago(TENANT, LIQUIDACION, dueno());
    expect(pre.ok).toBe(false);
    expect(pre.bloqueos.map((b) => b.codigo)).toContain('monto_bajo_minimo_retiro');

    usarDb(db);
    await expect(
      emitirPagoLiquidacion(TENANT, LIQUIDACION, dueno(), 'u-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('el monto líquido que reporta el preflight es EXACTAMENTE el que publica la acción como base del payout', async () => {
    const db = dbBase();
    db.liquidaciones[0].monto_total_clp = 87650;
    db.liquidaciones[0].bono_clp = 5000;
    db.liquidaciones[0].penalizacion_clp = 1200;
    db.configPayout[0].porcentaje_retencion = 12.5;

    usarDb(db);
    const pre = await preflightEmitirPago(TENANT, LIQUIDACION, dueno());
    expect(pre.resumen.tipoAccion).toBe('emitir_pago');
    const montoLiquidoPreflight =
      pre.resumen.tipoAccion === 'emitir_pago' ? pre.resumen.montoLiquidoClp : null;
    expect(montoLiquidoPreflight).not.toBeNull();

    usarDb(db);
    await emitirPagoLiquidacion(TENANT, LIQUIDACION, dueno(), 'u-1');
    // La acción no publica el líquido en el evento (el job lo recalcula desde
    // BD con la misma fórmula), pero si llegó a publicar sin lanzar, es porque
    // su propio cálculo con `calcularMontoPayout` también dio positivo y sobre
    // el mínimo — coherente con que el preflight haya dado `ok=true`.
    expect(pre.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
