/**
 * Pruebas del retiro registrado desde la web.
 * =============================================================================
 *
 * Lo que se fija acá, en orden de importancia:
 *
 * 1. **La bitácora se escribe ANTES de cualquier efecto.** Es invariante del
 *    proyecto y acá pesa el doble: cerrar la visita le paga al conductor, así
 *    que si el asiento quedara después, un fallo a mitad dejaría plata movida
 *    sin rastro de quién la mandó a mover.
 * 2. **El ciclo se ejecuta entero y en orden**: abrir → bultos → cerrar.
 * 3. **Ningún pedido desaparece en silencio.** El que no tiene código sale por
 *    `noRegistrados` con su motivo, no se descarta.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/identidad/auditoria', () => ({
  registrarEnBitacora: vi.fn(async () => undefined),
}));
vi.mock('./bodegas', () => ({
  abrirVisitaBodega: vi.fn(async () => ({
    sesion: { id: 'ses-1' },
    bodega: { sellerId: 'sel-1' },
    reutilizada: false,
  })),
}));
vi.mock('./escaneos', () => ({
  registrarLoteEscaneos: vi.fn(async () => ({ resultados: [] })),
}));
vi.mock('./sesiones', () => ({
  cerrarSesionRetiro: vi.fn(async () => ({ ok: true })),
}));

import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { abrirVisitaBodega } from './bodegas';
import { registrarLoteEscaneos } from './escaneos';
import { cerrarSesionRetiro } from './sesiones';
import { registrarRetiroDesdeWeb } from './registro-web';

/** Filas que devuelve el SELECT de pedidos, por prueba. */
let filasPedidos: Record<string, unknown>[] = [];

function clienteFalso() {
  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({ data: filasPedidos, error: null }),
          }),
        }),
      }),
    }),
  } as never;
}

const BASE = {
  tenantId: 'ten-1',
  conductorId: 'con-1',
  bodegaId: 'bod-1',
  actorUsuarioId: 'usr-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  filasPedidos = [];
});

describe('registrarRetiroDesdeWeb', () => {
  it('escribe la bitácora ANTES de abrir la visita', async () => {
    filasPedidos = [{ id: 'p1', ml_shipment_id: '44760788897', codigo_interno: null }];

    await registrarRetiroDesdeWeb(clienteFalso(), { ...BASE, pedidoIds: ['p1'] });

    const ordenBitacora = vi.mocked(registrarEnBitacora).mock.invocationCallOrder[0];
    const ordenAbrir = vi.mocked(abrirVisitaBodega).mock.invocationCallOrder[0];
    expect(ordenBitacora).toBeLessThan(ordenAbrir);

    expect(vi.mocked(registrarEnBitacora).mock.calls[0][1]).toMatchObject({
      accion: 'retiro.registrado_desde_web',
      actorUsuarioId: 'usr-1',
      detalle: { conductor_id: 'con-1', total_pedidos: 1 },
    });
  });

  it('ejecuta el ciclo entero y en orden: abrir → bultos → cerrar', async () => {
    filasPedidos = [{ id: 'p1', ml_shipment_id: '44760788897', codigo_interno: null }];

    await registrarRetiroDesdeWeb(clienteFalso(), { ...BASE, pedidoIds: ['p1'] });

    const abrir = vi.mocked(abrirVisitaBodega).mock.invocationCallOrder[0];
    const bultos = vi.mocked(registrarLoteEscaneos).mock.invocationCallOrder[0];
    const cerrar = vi.mocked(cerrarSesionRetiro).mock.invocationCallOrder[0];
    expect(abrir).toBeLessThan(bultos);
    expect(bultos).toBeLessThan(cerrar);

    // El conductor que eligió el coordinador es el que va en las tres.
    expect(vi.mocked(abrirVisitaBodega).mock.calls[0][1]).toMatchObject({
      conductorId: 'con-1',
      bodegaId: 'bod-1',
    });
    expect(vi.mocked(cerrarSesionRetiro).mock.calls[0][1]).toMatchObject({
      sesionId: 'ses-1',
      conductorId: 'con-1',
      actorUsuarioId: 'usr-1',
    });
  });

  it('usa ml_shipment_id en Flex y codigo_interno en same-day', async () => {
    filasPedidos = [
      { id: 'p1', ml_shipment_id: '44760788897', codigo_interno: null },
      { id: 'p2', ml_shipment_id: null, codigo_interno: 'RX-7K2M-9PQR' },
    ];

    await registrarRetiroDesdeWeb(clienteFalso(), { ...BASE, pedidoIds: ['p1', 'p2'] });

    const lote = vi.mocked(registrarLoteEscaneos).mock.calls[0][1];
    expect(lote.escaneos.map((e) => e.codigo)).toEqual(['44760788897', 'RX-7K2M-9PQR']);
    // Determinista, para que un reintento produzca los mismos ids.
    expect(lote.escaneos.map((e) => e.escaneoId)).toEqual(['web:p1', 'web:p2']);
    expect(lote).toMatchObject({ sesionId: 'ses-1', sellerIdBodega: 'sel-1', sesionCerrada: false });
  });

  it('un pedido sin código sale por noRegistrados y NO se descarta en silencio', async () => {
    filasPedidos = [
      { id: 'p1', ml_shipment_id: '44760788897', codigo_interno: null },
      { id: 'p2', ml_shipment_id: null, codigo_interno: null },
    ];

    const r = await registrarRetiroDesdeWeb(clienteFalso(), { ...BASE, pedidoIds: ['p1', 'p2'] });

    expect(r.noRegistrados).toEqual([{ pedidoId: 'p2', motivo: 'sin_codigo_identificable' }]);
    // El que sí tenía código entró igual: un pedido malo no tumba el retiro.
    expect(vi.mocked(registrarLoteEscaneos).mock.calls[0][1].escaneos).toHaveLength(1);
  });

  it('un pedido de otro courier no aparece en el SELECT y se reporta', async () => {
    filasPedidos = [{ id: 'p1', ml_shipment_id: '44760788897', codigo_interno: null }];

    const r = await registrarRetiroDesdeWeb(clienteFalso(), {
      ...BASE,
      pedidoIds: ['p1', 'ajeno'],
    });

    expect(r.noRegistrados).toEqual([{ pedidoId: 'ajeno', motivo: 'no_encontrado' }]);
  });

  it('no abre ninguna visita si NINGÚN pedido tiene código', async () => {
    filasPedidos = [{ id: 'p1', ml_shipment_id: null, codigo_interno: null }];

    await expect(
      registrarRetiroDesdeWeb(clienteFalso(), { ...BASE, pedidoIds: ['p1'] }),
    ).rejects.toThrow(/ningún|código/i);

    // Lo importante: no quedó una visita abierta y vacía colgando.
    expect(abrirVisitaBodega).not.toHaveBeenCalled();
    expect(cerrarSesionRetiro).not.toHaveBeenCalled();
  });

  it('rechaza una selección vacía sin tocar nada', async () => {
    await expect(
      registrarRetiroDesdeWeb(clienteFalso(), { ...BASE, pedidoIds: [] }),
    ).rejects.toThrow(/ningún pedido/i);

    expect(registrarEnBitacora).not.toHaveBeenCalled();
    expect(abrirVisitaBodega).not.toHaveBeenCalled();
  });
});
