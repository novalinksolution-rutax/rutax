/**
 * Tests de `reservarFolio` — reserva de folios CAF POR TIPO de documento.
 *
 * Regresión del FIX: la versión original (inline en C3) no discriminaba
 * `tipo_documento` y podía consumir folios 61 para emitir facturas 33.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorFolioAgotado } from '@/modules/integraciones/dte';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { reservarFolio } from './folios';

interface FilaCaf {
  id: string;
  tenant_id: string;
  tipo_documento: number;
  estado: string;
  folio_actual: number;
  folio_hasta: number;
}

function crearFakeSupabase(cafs: FilaCaf[]) {
  return {
    schema(_s: string) {
      return {
        from(_t: string) {
          return {
            select() {
              const filtros: Array<(f: FilaCaf) => boolean> = [];
              const b = {
                eq(col: keyof FilaCaf, val: unknown) {
                  filtros.push((f) => f[col] === val);
                  return b;
                },
                order(col: keyof FilaCaf, opts: { ascending: boolean }) {
                  void col; void opts;
                  return b;
                },
                limit(_n: number) {
                  return b;
                },
                maybeSingle() {
                  const filas = cafs
                    .filter((f) => filtros.every((fn) => fn(f)))
                    .sort((a, b2) => a.folio_actual - b2.folio_actual);
                  return Promise.resolve({ data: filas[0] ?? null, error: null });
                },
              };
              return b;
            },
            update(patch: Partial<FilaCaf>) {
              const filtrosU: Array<(f: FilaCaf) => boolean> = [];
              const bu = {
                eq(col: keyof FilaCaf, val: unknown) {
                  filtrosU.push((f) => f[col] === val);
                  return bu;
                },
                then(resolve: (v: { error: null }) => unknown) {
                  for (const f of cafs) {
                    if (filtrosU.every((fn) => fn(f))) Object.assign(f, patch);
                  }
                  return Promise.resolve({ error: null }).then(resolve);
                },
              };
              return bu;
            },
          };
        },
      };
    },
  };
}

const TENANT = 't-1';

beforeEach(() => {
  vi.mocked(crearClienteServiceRole).mockReset();
});

describe('reservarFolio', () => {
  it('reserva del CAF del tipo pedido e incrementa folio_actual', async () => {
    const cafs: FilaCaf[] = [
      { id: 'caf33', tenant_id: TENANT, tipo_documento: 33, estado: 'vigente', folio_actual: 10, folio_hasta: 100 },
    ];
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearFakeSupabase(cafs) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const r = await reservarFolio(TENANT, 33);
    expect(r.folio).toBe(10);
    expect(cafs[0].folio_actual).toBe(11);
  });

  it('REGRESIÓN del fix: pedir tipo 33 NO consume un CAF tipo 61', async () => {
    // Solo hay CAF tipo 61 vigente: la factura (33) NO debe usarlo.
    const cafs: FilaCaf[] = [
      { id: 'caf61', tenant_id: TENANT, tipo_documento: 61, estado: 'vigente', folio_actual: 1, folio_hasta: 50 },
    ];
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearFakeSupabase(cafs) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    await expect(reservarFolio(TENANT, 33)).rejects.toBeInstanceOf(ErrorFolioAgotado);
    // El CAF 61 quedó intacto.
    expect(cafs[0].folio_actual).toBe(1);
  });

  it('con ambos CAF vigentes, cada tipo consume el suyo', async () => {
    const cafs: FilaCaf[] = [
      { id: 'caf33', tenant_id: TENANT, tipo_documento: 33, estado: 'vigente', folio_actual: 5, folio_hasta: 100 },
      { id: 'caf61', tenant_id: TENANT, tipo_documento: 61, estado: 'vigente', folio_actual: 1, folio_hasta: 50 },
    ];
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearFakeSupabase(cafs) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const f33 = await reservarFolio(TENANT, 33);
    const f61 = await reservarFolio(TENANT, 61);
    expect(f33.folio).toBe(5);
    expect(f61.folio).toBe(1);
    expect(cafs[0].folio_actual).toBe(6);
    expect(cafs[1].folio_actual).toBe(2);
  });

  it('rango agotado (folio_actual > folio_hasta) → ErrorFolioAgotado con el tipo', async () => {
    const cafs: FilaCaf[] = [
      { id: 'caf61', tenant_id: TENANT, tipo_documento: 61, estado: 'vigente', folio_actual: 51, folio_hasta: 50 },
    ];
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearFakeSupabase(cafs) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    try {
      await reservarFolio(TENANT, 61);
      expect.unreachable('debió lanzar ErrorFolioAgotado');
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorFolioAgotado);
      expect((e as ErrorFolioAgotado).tipoDocumento).toBe(61);
      expect((e as Error).message).toContain('tipo 61');
    }
  });
});
