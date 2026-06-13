/**
 * Tests de `emitirNotaCreditoPeriodo` — compuerta humana de la NC (RF-038).
 *
 * Foco:
 *  - Gate de capacidad (`emitir_facturas`): roles sin capacidad → ErrorValidacion.
 *  - Motivo obligatorio (trim no vacío).
 *  - Solo períodos `facturado` con DTE 33 asociado; 33 rechazado por SII no
 *    requiere NC; un 33 ya anulado (61 existente) se rechaza con error claro.
 *  - BITÁCORA ANTES del evento (orden estricto) y payload del evento correcto
 *    (montos copiados del 33, no de las líneas).
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

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { emitirNotaCreditoPeriodo } from './acciones';

// =============================================================================
// Fake Supabase en memoria (mismo modelo que acciones-cobranza.test.ts).
// =============================================================================

interface DB {
  periodos: Array<Record<string, unknown>>;
  documentos: Array<Record<string, unknown>>;
  configDte: Array<Record<string, unknown>>;
}

function crearFakeSupabase(db: DB) {
  function tablaPara(schema: string, tabla: string): Array<Record<string, unknown>> {
    if (schema === 'dinero' && tabla === 'periodos_cobro') return db.periodos;
    if (schema === 'dinero' && tabla === 'documentos_dte') return db.documentos;
    if (schema === 'identidad' && tabla === 'courier_config_dte') return db.configDte;
    throw new Error(`Tabla no modelada: ${schema}.${tabla}`);
  }
  let schemaActual = '';
  return {
    schema(s: string) {
      schemaActual = s;
      return {
        from(tabla: string) {
          const filas = tablaPara(schemaActual, tabla);
          return {
            select() {
              const filtros: Array<(f: Record<string, unknown>) => boolean> = [];
              const b = {
                eq(col: string, val: unknown) {
                  filtros.push((f) => f[col] === val);
                  return b;
                },
                maybeSingle() {
                  const r = filas.filter((f) => filtros.every((fn) => fn(f)));
                  return Promise.resolve({ data: r[0] ?? null, error: null });
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
const PERIODO = 'periodo-1';
const DTE33 = 'dte-33';

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
    periodos: [
      {
        id: PERIODO,
        tenant_id: TENANT,
        seller_id: 'seller-1',
        estado: 'facturado',
        documento_dte_id: DTE33,
        monto_pagado_clp: 0,
      },
    ],
    documentos: [
      {
        id: DTE33,
        tenant_id: TENANT,
        tipo_documento: 33,
        folio: 77,
        estado_sii: 'aceptado',
        monto_neto_clp: 9580,
        monto_iva_clp: 1820,
        monto_total_clp: 11400,
      },
    ],
    configDte: [],
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

describe('emitirNotaCreditoPeriodo', () => {
  it('rechaza a un usuario sin capacidad emitir_facturas (coordinador)', async () => {
    usarDb(dbBase());
    await expect(
      emitirNotaCreditoPeriodo(TENANT, PERIODO, 'tarifa errada', coordinador(), 'u-1'),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(sendMock).not.toHaveBeenCalled();
    expect(bitacoraMock).not.toHaveBeenCalled();
  });

  it('rechaza motivo vacío (incluido solo espacios)', async () => {
    usarDb(dbBase());
    await expect(
      emitirNotaCreditoPeriodo(TENANT, PERIODO, '   ', dueno(), 'u-1'),
    ).rejects.toThrow(/motivo/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rechaza un período que no está facturado', async () => {
    const db = dbBase();
    db.periodos[0].estado = 'cerrado';
    db.periodos[0].documento_dte_id = null;
    usarDb(db);
    await expect(
      emitirNotaCreditoPeriodo(TENANT, PERIODO, 'motivo', dueno(), 'u-1'),
    ).rejects.toThrow(/facturado/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rechaza si el 33 fue rechazado por el SII (no requiere NC)', async () => {
    const db = dbBase();
    db.documentos[0].estado_sii = 'rechazado';
    usarDb(db);
    await expect(
      emitirNotaCreditoPeriodo(TENANT, PERIODO, 'motivo', dueno(), 'u-1'),
    ).rejects.toThrow(/rechazada/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rechaza si ya existe una NC (61) para ese 33', async () => {
    const db = dbBase();
    db.documentos.push({
      id: 'dte-61',
      tenant_id: TENANT,
      tipo_documento: 61,
      folio: 5,
      dte_referencia_id: DTE33,
    });
    usarDb(db);
    await expect(
      emitirNotaCreditoPeriodo(TENANT, PERIODO, 'motivo', dueno(), 'u-1'),
    ).rejects.toThrow(/ya fue anulada/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rechaza un período de otro tenant (aislamiento)', async () => {
    usarDb(dbBase());
    await expect(
      emitirNotaCreditoPeriodo('tenant-B', PERIODO, 'motivo', { ...dueno(), tenantId: 'tenant-B' }, 'u-1'),
    ).rejects.toThrow(/no encontrado/);
  });

  it('happy path: bitácora ANTES del evento, con payload copiado del 33', async () => {
    usarDb(dbBase());
    const orden: string[] = [];
    bitacoraMock.mockImplementation(async () => {
      orden.push('bitacora');
    });
    sendMock.mockImplementation(async () => {
      orden.push('send');
    });

    await emitirNotaCreditoPeriodo(TENANT, PERIODO, '  tarifa errada  ', dueno(), 'u-1');

    // Orden estricto: auditoría antes del efecto.
    expect(orden).toEqual(['bitacora', 'send']);

    // Bitácora con actor y motivo limpio.
    const bit = bitacoraMock.mock.calls[0][1] as Record<string, unknown>;
    expect(bit.accion).toBe('dinero.nc_emision_solicitada');
    expect(bit.actorUsuarioId).toBe('u-1');
    expect((bit.detalle as Record<string, unknown>).motivo).toBe('tarifa errada');

    // Evento con montos COPIADOS del 33 y referencia correcta.
    const evento = sendMock.mock.calls[0][0] as Record<string, unknown>;
    expect(evento.name).toBe('dinero/nc.emision-solicitada');
    const data = evento.data as Record<string, unknown>;
    expect(data.documentoDteId).toBe(DTE33);
    expect(data.folioReferencia).toBe(77);
    expect(data.montoNetoClp).toBe(9580);
    expect(data.montoIvaClp).toBe(1820);
    expect(data.montoTotalClp).toBe(11400);
    expect(data.motivo).toBe('tarifa errada');
    expect(data.modo).toBe('sandbox');
  });
});
