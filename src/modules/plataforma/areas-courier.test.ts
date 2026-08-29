/**
 * Tests de `areasApagadasPorTenant`.
 * =============================================================================
 *
 * Lo que se fija acá es una **inversión**: la tabla guarda las áreas ENCENDIDAS
 * (fila = encendida) y la pantalla necesita las APAGADAS. Es el tipo de lógica
 * que se lee bien y se equivoca callada: invertida al revés, el backstage
 * mostraría «4 áreas apagadas» de un courier que las tiene todas, y —peor— «las
 * cinco encendidas» de uno al que Rutax le tiene la facturación cerrada.
 *
 * Mismo patrón de mocks que el resto de `plataforma`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock('./autorizacion-admin', () => ({
  exigirSuperAdmin: vi.fn().mockResolvedValue({ usuarioId: 'admin-1', rolAdmin: 'admin_total' }),
  exigirSuperAdminEscritura: vi
    .fn()
    .mockResolvedValue({ usuarioId: 'admin-1', rolAdmin: 'admin_total' }),
}));

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { AREAS_PRODUCTO } from '@/modules/identidad/areas-producto';
import { areasApagadasPorTenant } from './areas-courier';

/** Doble mínimo de la cadena `.schema().from().select().in()`. */
function clienteCon(filas: Array<{ tenant_id: string; area: string }>) {
  const enIn = vi.fn().mockResolvedValue({ data: filas, error: null });
  return {
    schema: () => ({
      from: () => ({
        select: () => ({ in: enIn }),
      }),
    }),
    __in: enIn,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('areasApagadasPorTenant', () => {
  it('un courier con las cinco filas NO aparece en el mapa', () => {
    // El caso sano se omite del mapa a propósito: la pantalla pinta solo la
    // excepción, así que devolver una entrada con arreglo vacío la obligaría a
    // distinguir «vacío» de «ausente» para nada.
    const filas = AREAS_PRODUCTO.map((area) => ({ tenant_id: 't1', area }));
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteCon(filas) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    return areasApagadasPorTenant(['t1']).then((mapa) => {
      expect(mapa.has('t1')).toBe(false);
    });
  });

  it('🔴 un courier SIN ninguna fila tiene las cinco apagadas', async () => {
    // Contraprueba del anterior, y el caso que la inversión al revés rompería:
    // sin filas, un `select` ingenuo diría «no hay nada apagado».
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteCon([]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const mapa = await areasApagadasPorTenant(['t1']);
    expect(mapa.get('t1')).toEqual([...AREAS_PRODUCTO]);
  });

  it('🔴 no mezcla couriers: cada tenant recibe solo lo suyo', async () => {
    // El aislamiento entre couriers es la regla dura del proyecto, y acá se
    // agrupa en memoria a partir de una sola consulta con `in`: es exactamente
    // donde un `Map` mal llavado le atribuiría a un courier el estado de otro.
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteCon([
        { tenant_id: 't1', area: 'emision_facturas' },
        { tenant_id: 't2', area: 'folios_caf' },
      ]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const mapa = await areasApagadasPorTenant(['t1', 't2']);
    expect(mapa.get('t1')).not.toContain('emision_facturas');
    expect(mapa.get('t1')).toContain('folios_caf');
    expect(mapa.get('t2')).not.toContain('folios_caf');
    expect(mapa.get('t2')).toContain('emision_facturas');
  });

  it('sin tenants no consulta la base', async () => {
    const cliente = clienteCon([]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const mapa = await areasApagadasPorTenant([]);
    expect(mapa.size).toBe(0);
    expect(cliente.__in).not.toHaveBeenCalled();
  });

  it('ignora un área desconocida en la base sin caerse', async () => {
    // Si alguien inserta a mano un área que el código no conoce, no debe
    // contarse como encendida de nada: las cinco siguen midiéndose contra
    // `AREAS_PRODUCTO`, que es el catálogo del código.
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteCon([{ tenant_id: 't1', area: 'area_inventada' }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );

    const mapa = await areasApagadasPorTenant(['t1']);
    expect(mapa.get('t1')).toEqual([...AREAS_PRODUCTO]);
  });
});
