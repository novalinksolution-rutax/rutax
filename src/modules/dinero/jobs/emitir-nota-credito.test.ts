/**
 * Tests del job C-NC — `dinero/emitirNotaCredito` (anulación total vía NC 61).
 * =============================================================================
 *
 * A diferencia de los tests "de protocolo" de C3 (que reconstruyen la lógica),
 * estos EJECUTAN EL HANDLER REAL del job contra:
 *   - un fake Supabase en memoria (tablas dinero.documentos_dte, periodos_cobro,
 *     pagos_recibidos, lineas_cobro; identidad.sellers, tenants),
 *   - un `step.run` que simplemente ejecuta la callback (sin memoización Inngest),
 *   - puerto DTE / folios / bitácora / períodos mockeados.
 *
 * Foco QA (reglas de dinero + idempotencia, items 4-6 del pase):
 *  4. Idempotencia: re-ejecutar con un 61 ya existente → `ya_emitida` sin
 *     re-anular, sin re-desimputar, sin reimputar. Reintento parcial (61
 *     persistido, período aún 'facturado') → converge sin doble efecto.
 *  5. Desimputación: pagos conciliado/parcial → 'sobrante' conservando seller_id,
 *     periodo_cobro_id=null; la fila NO se pierde; un pago TERMINAL (conciliado)
 *     efectivamente vuelve a 'sobrante' (UPDATE directo, no pasa por la cascada).
 *  6. Reimputación: líneas del período anulado → período ABIERTO vigente; no
 *     quedan huérfanas apuntando al anulado.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks de dependencias del job ------------------------------------------

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

// createFunction devuelve el handler para poder invocarlo directo.
const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/inngest/cliente', () => ({
  inngest: {
    createFunction: (_config: unknown, handler: unknown) => handler,
    send: (...args: unknown[]) => sendMock(...args),
  },
}));

const bitacoraMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: (...args: unknown[]) => bitacoraMock(...args),
}));

const emitirFacturaMock = vi.fn();
vi.mock('@/modules/integraciones/dte', () => ({
  obtenerPuertoDte: vi.fn().mockResolvedValue({
    emitirFactura: (...args: unknown[]) => emitirFacturaMock(...args),
  }),
}));

const reservarFolioMock = vi.fn();
vi.mock('../folios', () => ({
  reservarFolio: (...args: unknown[]) => reservarFolioMock(...args),
}));

const periodoAbiertoMock = vi.fn();
vi.mock('../periodos', () => ({
  obtenerOCrearPeriodoCobroAbierto: (...args: unknown[]) => periodoAbiertoMock(...args),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { jobEmitirNotaCredito } from './emitir-nota-credito';

// =============================================================================
// Fake Supabase en memoria — soporta select/insert/update con eq, maybeSingle.
// =============================================================================

interface DB {
  documentos: Array<Record<string, unknown>>;
  periodos: Array<Record<string, unknown>>;
  pagos: Array<Record<string, unknown>>;
  lineas: Array<Record<string, unknown>>;
  sellers: Array<Record<string, unknown>>;
  tenants: Array<Record<string, unknown>>;
}

let idSeq = 0;

function crearFakeSupabase(db: DB) {
  function tablaPara(schema: string, tabla: string): Array<Record<string, unknown>> {
    if (schema === 'dinero' && tabla === 'documentos_dte') return db.documentos;
    if (schema === 'dinero' && tabla === 'periodos_cobro') return db.periodos;
    if (schema === 'dinero' && tabla === 'pagos_recibidos') return db.pagos;
    if (schema === 'dinero' && tabla === 'lineas_cobro') return db.lineas;
    if (schema === 'identidad' && tabla === 'sellers') return db.sellers;
    if (schema === 'identidad' && tabla === 'tenants') return db.tenants;
    throw new Error(`Tabla no modelada: ${schema}.${tabla}`);
  }
  let schemaActual = '';

  return {
    schema(s: string) {
      schemaActual = s;
      return {
        from(tabla: string) {
          const filas = tablaPara(schemaActual, tabla);

          function lecturaBuilder() {
            const filtros: Array<(f: Record<string, unknown>) => boolean> = [];
            const b = {
              select() {
                return b;
              },
              eq(col: string, val: unknown) {
                filtros.push((f) => f[col] === val);
                return b;
              },
              filtradas() {
                return filas.filter((f) => filtros.every((fn) => fn(f)));
              },
              maybeSingle() {
                const r = b.filtradas();
                return Promise.resolve({ data: r[0] ?? null, error: null });
              },
              then(resolve: (v: { data: unknown; error: null }) => unknown) {
                return Promise.resolve({ data: b.filtradas(), error: null }).then(resolve);
              },
            };
            return b;
          }

          return {
            select() {
              return lecturaBuilder();
            },
            insert(valores: Record<string, unknown>) {
              const fila = { id: `gen-${++idSeq}`, ...valores };
              filas.push(fila);
              const ib = {
                select() {
                  return ib;
                },
                maybeSingle() {
                  return Promise.resolve({ data: { id: fila.id }, error: null });
                },
                single() {
                  return Promise.resolve({ data: { id: fila.id }, error: null });
                },
              };
              return ib;
            },
            update(patch: Record<string, unknown>) {
              const filtrosU: Array<(f: Record<string, unknown>) => boolean> = [];
              const ub = {
                eq(col: string, val: unknown) {
                  filtrosU.push((f) => f[col] === val);
                  return ub;
                },
                then(resolve: (v: { error: null }) => unknown) {
                  for (const f of filas) {
                    if (filtrosU.every((fn) => fn(f))) Object.assign(f, patch);
                  }
                  return Promise.resolve({ error: null }).then(resolve);
                },
              };
              return ub;
            },
          };
        },
      };
    },
  } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

// `step` falso: ejecuta la callback inmediatamente (sin memoización).
const fakeStep = { run: async (_id: string, fn: () => unknown) => fn() };
const fakeLogger = { info: () => {}, warn: () => {}, error: () => {} };

const TENANT = 'tenant-a';
const SELLER = 'seller-1';
const PERIODO = 'periodo-1';
const DTE33 = 'dte-33';
const PERIODO_ABIERTO = 'periodo-abierto';

function eventoNc() {
  return {
    data: {
      periodoCobroidId: PERIODO,
      tenantId: TENANT,
      sellerId: SELLER,
      documentoDteId: DTE33,
      folioReferencia: 9101,
      tipoDocumentoReferencia: 33 as const,
      montoNetoClp: 100000,
      montoIvaClp: 19000,
      montoTotalClp: 119000,
      motivo: 'Tarifa mal aplicada',
      solicitadoPorUsuarioId: 'u-1',
      modo: 'sandbox' as const,
    },
  };
}

function dbBase(): DB {
  return {
    tenants: [{ id: TENANT, rut: '76616161-1', razon_social: 'Courier A SpA' }],
    sellers: [
      { id: SELLER, tenant_id: TENANT, rut: '77616161-1', razon_social: 'Seller Uno', email_contacto: 's1@x.cl' },
    ],
    documentos: [
      {
        id: DTE33, tenant_id: TENANT, seller_id: SELLER, periodo_cobro_id: PERIODO,
        tipo_documento: 33, folio: 9101, estado_sii: 'aceptado',
        monto_neto_clp: 100000, monto_iva_clp: 19000, monto_total_clp: 119000,
        dte_referencia_id: null,
      },
    ],
    periodos: [
      {
        id: PERIODO, tenant_id: TENANT, seller_id: SELLER,
        estado: 'facturado', estado_cobro: 'pagado',
        monto_total_clp: 119000, monto_pagado_clp: 119000,
        documento_dte_id: DTE33,
      },
    ],
    pagos: [],
    lineas: [],
  };
}

async function correrJob(db: DB) {
  vi.mocked(crearClienteServiceRole).mockReturnValue(crearFakeSupabase(db));
  return (jobEmitirNotaCredito as unknown as (ctx: unknown) => Promise<unknown>)({
    event: eventoNc(),
    step: fakeStep,
    logger: fakeLogger,
    runId: 'run-1',
  });
}

beforeEach(() => {
  vi.mocked(crearClienteServiceRole).mockReset();
  sendMock.mockClear();
  bitacoraMock.mockClear();
  emitirFacturaMock.mockReset();
  reservarFolioMock.mockReset();
  periodoAbiertoMock.mockReset();
  idSeq = 0;

  reservarFolioMock.mockResolvedValue({ folio: 500, cafId: 'caf-61' });
  emitirFacturaMock.mockResolvedValue({
    idExternoProveedor: 'ext-1', folio: 500, tipoDocumento: 61,
    xmlUrl: 'x.xml', pdfUrl: 'x.pdf', estadoSii: 'enviado',
  });
  periodoAbiertoMock.mockResolvedValue(PERIODO_ABIERTO);
});

// =============================================================================
// Item 4 — Idempotencia
// =============================================================================

describe('Job C-NC · idempotencia', () => {
  it('happy path: emite 61, anula período, desimputa pagos, reimputa líneas', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: TENANT, seller_id: SELLER, periodo_cobro_id: PERIODO,
      monto_clp: 119000, estado_match: 'conciliado',
    });
    db.lineas.push({ id: 'linea-1', tenant_id: TENANT, periodo_cobro_id: PERIODO });

    const r = (await correrJob(db)) as { resultado: string; folio: number };

    expect(r.resultado).toBe('emitida');
    expect(r.folio).toBe(500);
    // 61 persistido referenciando el 33.
    const nc = db.documentos.find((d) => d.tipo_documento === 61);
    expect(nc).toBeDefined();
    expect(nc!.dte_referencia_id).toBe(DTE33);
    // Período anulado + cobranza reseteada.
    expect(db.periodos[0].estado).toBe('anulado');
    expect(db.periodos[0].monto_pagado_clp).toBe(0);
    expect(db.periodos[0].estado_cobro).toBe('no_aplica');
    // Pago desimputado a sobrante, conservando seller_id.
    expect(db.pagos[0].estado_match).toBe('sobrante');
    expect(db.pagos[0].periodo_cobro_id).toBeNull();
    expect(db.pagos[0].seller_id).toBe(SELLER);
    // Línea reimputada al período abierto.
    expect(db.lineas[0].periodo_cobro_id).toBe(PERIODO_ABIERTO);
    // Folio se reservó exactamente una vez.
    expect(reservarFolioMock).toHaveBeenCalledTimes(1);
    expect(emitirFacturaMock).toHaveBeenCalledTimes(1);
  });

  it('re-ejecutar con un 61 ya existente → ya_emitida, sin re-anular/desimputar/reimputar', async () => {
    const db = dbBase();
    // 61 ya emitido (estado de un job previo completo).
    db.documentos.push({
      id: 'dte-61', tenant_id: TENANT, seller_id: SELLER, periodo_cobro_id: PERIODO,
      tipo_documento: 61, folio: 500, dte_referencia_id: DTE33,
      monto_neto_clp: 100000, monto_iva_clp: 19000, monto_total_clp: 119000,
    });
    db.periodos[0].estado = 'anulado';
    db.periodos[0].monto_pagado_clp = 0;
    db.pagos.push({
      id: 'pago-1', tenant_id: TENANT, seller_id: SELLER, periodo_cobro_id: null,
      monto_clp: 119000, estado_match: 'sobrante',
    });
    db.lineas.push({ id: 'linea-1', tenant_id: TENANT, periodo_cobro_id: PERIODO_ABIERTO });

    const r = (await correrJob(db)) as { resultado: string };

    expect(r.resultado).toBe('ya_emitida');
    // No se reservó folio nuevo, no se llamó al proveedor, no se desimputó nada.
    expect(reservarFolioMock).not.toHaveBeenCalled();
    expect(emitirFacturaMock).not.toHaveBeenCalled();
    expect(periodoAbiertoMock).not.toHaveBeenCalled();
    // Sin un segundo 61.
    expect(db.documentos.filter((d) => d.tipo_documento === 61)).toHaveLength(1);
    // Pago intacto en sobrante (no se re-tocó).
    expect(db.pagos[0].estado_match).toBe('sobrante');
  });

  it('re-ejecución total (job corre 2 veces) no duplica: 1 solo 61, monto sin doble efecto', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: TENANT, seller_id: SELLER, periodo_cobro_id: PERIODO,
      monto_clp: 119000, estado_match: 'parcial',
    });
    db.lineas.push({ id: 'linea-1', tenant_id: TENANT, periodo_cobro_id: PERIODO });

    await correrJob(db);
    // Segunda corrida completa (re-entrega del evento sin dedup de Inngest):
    // el step 1 ve el 61 ya persistido → ya_emitida.
    const r2 = (await correrJob(db)) as { resultado: string };

    expect(r2.resultado).toBe('ya_emitida');
    expect(db.documentos.filter((d) => d.tipo_documento === 61)).toHaveLength(1);
    expect(db.periodos[0].monto_pagado_clp).toBe(0);
    expect(db.pagos[0].estado_match).toBe('sobrante'); // desimputado una sola vez
    expect(db.pagos[0].periodo_cobro_id).toBeNull();
    expect(reservarFolioMock).toHaveBeenCalledTimes(1); // no se consumió un 2do folio
  });
});

// =============================================================================
// Item 5 — Desimputación de pagos
// =============================================================================

describe('Job C-NC · desimputación de pagos', () => {
  it('pago CONCILIADO (terminal) vuelve a sobrante por UPDATE directo (no lo bloquea esEstadoTerminal)', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: TENANT, seller_id: SELLER, periodo_cobro_id: PERIODO,
      monto_clp: 119000, estado_match: 'conciliado',
    });

    await correrJob(db);

    // La fila sigue existiendo (la plata no se pierde) y volvió a sobrante.
    expect(db.pagos).toHaveLength(1);
    expect(db.pagos[0].estado_match).toBe('sobrante');
    expect(db.pagos[0].periodo_cobro_id).toBeNull();
    expect(db.pagos[0].seller_id).toBe(SELLER);
    // Bitácora de desimputación registrada.
    const acciones = bitacoraMock.mock.calls.map((c) => (c[1] as Record<string, unknown>).accion);
    expect(acciones).toContain('dinero.pago_desimputado_por_nc');
  });

  it('pago PARCIAL también se desimputa a sobrante conservando seller_id', async () => {
    const db = dbBase();
    db.pagos.push({
      id: 'pago-1', tenant_id: TENANT, seller_id: SELLER, periodo_cobro_id: PERIODO,
      monto_clp: 60000, estado_match: 'parcial',
    });

    await correrJob(db);

    expect(db.pagos[0].estado_match).toBe('sobrante');
    expect(db.pagos[0].seller_id).toBe(SELLER);
    expect(db.pagos[0].periodo_cobro_id).toBeNull();
  });

  it('varios pagos del período se desimputan todos; pagos de OTRO período no se tocan', async () => {
    const db = dbBase();
    db.pagos.push(
      { id: 'pago-1', tenant_id: TENANT, seller_id: SELLER, periodo_cobro_id: PERIODO, monto_clp: 60000, estado_match: 'parcial' },
      { id: 'pago-2', tenant_id: TENANT, seller_id: SELLER, periodo_cobro_id: PERIODO, monto_clp: 59000, estado_match: 'conciliado' },
      // Pago de OTRO período del mismo seller: NO debe tocarse.
      { id: 'pago-3', tenant_id: TENANT, seller_id: SELLER, periodo_cobro_id: 'otro-periodo', monto_clp: 5000, estado_match: 'conciliado' },
    );

    await correrJob(db);

    expect(db.pagos.find((p) => p.id === 'pago-1')!.estado_match).toBe('sobrante');
    expect(db.pagos.find((p) => p.id === 'pago-2')!.estado_match).toBe('sobrante');
    // El de otro período sigue conciliado e imputado.
    expect(db.pagos.find((p) => p.id === 'pago-3')!.estado_match).toBe('conciliado');
    expect(db.pagos.find((p) => p.id === 'pago-3')!.periodo_cobro_id).toBe('otro-periodo');
  });

  it('período sin pagos: no falla y aún anula y reimputa líneas', async () => {
    const db = dbBase();
    db.periodos[0].estado_cobro = 'pendiente';
    db.periodos[0].monto_pagado_clp = 0;
    db.lineas.push({ id: 'linea-1', tenant_id: TENANT, periodo_cobro_id: PERIODO });

    const r = (await correrJob(db)) as { resultado: string };

    expect(r.resultado).toBe('emitida');
    expect(db.periodos[0].estado).toBe('anulado');
    expect(db.lineas[0].periodo_cobro_id).toBe(PERIODO_ABIERTO);
  });
});

// =============================================================================
// Item 6 — Reimputación de líneas
// =============================================================================

describe('Job C-NC · reimputación de líneas', () => {
  it('todas las líneas del período anulado se reasignan al período abierto (ninguna huérfana)', async () => {
    const db = dbBase();
    db.lineas.push(
      { id: 'l1', tenant_id: TENANT, periodo_cobro_id: PERIODO },
      { id: 'l2', tenant_id: TENANT, periodo_cobro_id: PERIODO },
      { id: 'l3', tenant_id: TENANT, periodo_cobro_id: PERIODO },
    );

    await correrJob(db);

    const enAnulado = db.lineas.filter((l) => l.periodo_cobro_id === PERIODO);
    expect(enAnulado).toHaveLength(0); // ninguna huérfana apuntando al anulado
    const enAbierto = db.lineas.filter((l) => l.periodo_cobro_id === PERIODO_ABIERTO);
    expect(enAbierto).toHaveLength(3);
  });

  it('líneas de OTRO período no se reimputan (acotado por periodo_cobro_id)', async () => {
    const db = dbBase();
    db.lineas.push(
      { id: 'l1', tenant_id: TENANT, periodo_cobro_id: PERIODO },
      { id: 'l-ajena', tenant_id: TENANT, periodo_cobro_id: 'periodo-vecino' },
    );

    await correrJob(db);

    expect(db.lineas.find((l) => l.id === 'l1')!.periodo_cobro_id).toBe(PERIODO_ABIERTO);
    expect(db.lineas.find((l) => l.id === 'l-ajena')!.periodo_cobro_id).toBe('periodo-vecino');
  });
});
