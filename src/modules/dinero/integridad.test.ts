/**
 * Tests del detector de integridad `linea_cobro_sin_pedido_entregado` (QW6).
 *
 * Se prueba el predicado puro `esLineaCobroHuerfana` — la regla de negocio que
 * decide qué línea de cobro activa es inconsistente — sin BD, como el resto de
 * los tests de detectores del repo.
 */

import { describe, it, expect, vi } from 'vitest';
import { esLineaCobroHuerfana, detectarLineasCobroHuerfanas } from './integridad';

// La bandeja de excepciones no es lo que se prueba acá: se neutraliza para que el
// test hable solo de CÓMO se consulta la base.
// La bandeja de excepciones no es lo que se prueba acá: `existe...` devuelve
// false (nada reportado aún) para que los detectores lleguen hasta el final, e
// `insertar...` es un no-op. Así los tests hablan solo de CÓMO se consulta la
// base y de QUÉ condiciones se marcan.
vi.mock('./conciliacion-insercion', () => ({
  existeEventoConciliacion: vi.fn().mockResolvedValue(false),
  insertarEventoConciliacion: vi.fn().mockResolvedValue(undefined),
}));

describe('esLineaCobroHuerfana — detector de líneas de cobro huérfanas', () => {
  it('pedido ausente (undefined) → huérfana (la línea no debe seguir viva)', () => {
    expect(esLineaCobroHuerfana(undefined)).toBe(true);
  });

  it('estados que NO deben tener cobro activo → huérfana', () => {
    for (const estado of ['devuelto', 'cancelado', 'pendiente_asignacion', 'asignado', 'en_ruta']) {
      expect(esLineaCobroHuerfana(estado), `estado=${estado}`).toBe(true);
    }
  });

  it('estados que SÍ pueden tener cobro legítimo → no huérfana (evita falsos positivos)', () => {
    // entregado/entregado_manual generan cobro; fallido/fallido_manual pueden
    // generarlo si la incidencia afecta el cobro — nunca se marcan huérfanas.
    for (const estado of ['entregado', 'entregado_manual', 'fallido', 'fallido_manual']) {
      expect(esLineaCobroHuerfana(estado), `estado=${estado}`).toBe(false);
    }
  });

  it('un estado desconocido no listado → no huérfana (conservador, no falso positivo)', () => {
    expect(esLineaCobroHuerfana('estado_inventado')).toBe(false);
  });
});

/**
 * Regresión de los dos límites de PostgREST que dejaban este detector inútil a
 * escala real. Ambos fallaban en SILENCIO hacia arriba: el watchdog informaba
 * `lineas_huerfanas=0`, que se lee como "todo limpio" y significaba "nunca corrió".
 *
 *   1. `max_rows` (1000): un `select` sin paginar devuelve 1000 filas y ya, sin
 *      error → barrido incompleto.
 *   2. Largo de URL: `.in('id', [...])` con un id por línea del tenant devolvía
 *      `URI too long` con 715 líneas — el detector fallaba entero.
 *
 * Se prueba contra un doble del cliente que registra cada llamada, porque lo que
 * hay que fijar no es el resultado sino la FORMA de consultar: nunca una lista de
 * ids que crezca con el tamaño del tenant, nunca una lectura sin paginar.
 */
describe('detectarLineasCobroHuerfanas — forma de las consultas a escala', () => {
  const TENANT = '10000000-0000-0000-0000-000000000001';

  /** Construye un doble del cliente con N líneas activas, todas de pedidos `en_ruta`. */
  function clienteFalso(totalLineas: number, periodoCobroId: string | null = 'periodo-1') {
    const rangos: Array<[number, number]> = [];
    const lotesDeIds: number[] = [];

    const lineas = Array.from({ length: totalLineas }, (_, i) => ({
      id: `linea-${String(i).padStart(6, '0')}`,
      pedido_id: `pedido-${String(i).padStart(6, '0')}`,
      seller_id: 'seller-1',
      periodo_cobro_id: periodoCobroId,
      monto_final_clp: 1000,
    }));

    const constructorLineas = {
      select: () => constructorLineas,
      eq: () => constructorLineas,
      order: () => constructorLineas,
      range: (desde: number, hasta: number) => {
        rangos.push([desde, hasta]);
        return Promise.resolve({ data: lineas.slice(desde, hasta + 1), error: null });
      },
    };

    const constructorPedidos = {
      select: () => constructorPedidos,
      eq: () => constructorPedidos,
      in: (_columna: string, ids: string[]) => {
        lotesDeIds.push(ids.length);
        return Promise.resolve({
          data: ids.map((id) => ({ id, estado: 'en_ruta' })),
          error: null,
        });
      },
    };

    const cliente = {
      schema: (nombre: string) => ({
        from: () => (nombre === 'dinero' ? constructorLineas : constructorPedidos),
      }),
    };

    return { cliente, rangos, lotesDeIds };
  }

  it('pagina la lectura de líneas en vez de confiar en un select único (max_rows)', async () => {
    const { cliente, rangos } = clienteFalso(1200);

    await detectarLineasCobroHuerfanas(cliente as never, TENANT, 'run-1');

    // Más de una página: si leyera de una sola vez, PostgREST habría cortado en
    // 1000 y las 200 líneas restantes nunca se habrían revisado.
    expect(rangos.length).toBeGreaterThan(1);
    for (const [desde, hasta] of rangos) {
      expect(hasta - desde + 1).toBeLessThan(1000);
    }
  });

  it('consulta los pedidos en lotes acotados, no con un .in() del tamaño del tenant', async () => {
    const { cliente, lotesDeIds } = clienteFalso(1200);

    await detectarLineasCobroHuerfanas(cliente as never, TENANT, 'run-2');

    expect(lotesDeIds.length).toBeGreaterThan(1);
    // El techo es lo que importa: un lote grande vuelve a dar `URI too long`.
    for (const tamano of lotesDeIds) {
      expect(tamano).toBeLessThanOrEqual(200);
    }
    // Y no se pierde ningún pedido por el camino.
    expect(lotesDeIds.reduce((a, b) => a + b, 0)).toBe(1200);
  });
});

/**
 * `linea_cobro_sin_periodo`: una línea activa que nunca quedó colgada de un
 * período no entra en ninguna factura. Se detectó ejecutando N-E2E-1: si
 * `asignar-periodo-cobro` falla (porque el período destino ya estaba cerrado),
 * el paso anterior ya insertó la línea e Inngest memoiza los pasos completados,
 * así que queda huérfana de período para siempre.
 *
 * Lo importante del caso: NO lo cubre `esLineaCobroHuerfana`, que mira el estado
 * del pedido y excluye `fallido` a propósito — y `fallido` es justo el estado del
 * escenario típico. Por eso es una rama aparte y no una extensión del set.
 */
describe('detectarLineasCobroHuerfanas — líneas sin período', () => {
  const TENANT = '10000000-0000-0000-0000-000000000001';

  function clienteConEstadoPedido(estadoPedido: string, periodoCobroId: string | null) {
    const insertados: Array<Record<string, unknown>> = [];

    const constructorLineas = {
      select: () => constructorLineas,
      eq: () => constructorLineas,
      order: () => constructorLineas,
      range: (desde: number) =>
        Promise.resolve({
          data:
            desde === 0
              ? [
                  {
                    id: 'linea-1',
                    pedido_id: 'pedido-1',
                    seller_id: 'seller-1',
                    periodo_cobro_id: periodoCobroId,
                    monto_final_clp: 3500,
                  },
                ]
              : [],
          error: null,
        }),
    };

    const constructorPedidos = {
      select: () => constructorPedidos,
      eq: () => constructorPedidos,
      in: (_c: string, ids: string[]) =>
        Promise.resolve({ data: ids.map((id) => ({ id, estado: estadoPedido })), error: null }),
    };

    const cliente = {
      schema: (nombre: string) => ({
        from: () => (nombre === 'dinero' ? constructorLineas : constructorPedidos),
      }),
    };

    return { cliente, insertados };
  }

  it('marca la línea sin período aunque el pedido esté en un estado legítimo (fallido)', async () => {
    const { cliente } = clienteConEstadoPedido('fallido', null);

    const resultado = await detectarLineasCobroHuerfanas(cliente as never, TENANT, 'run-3');

    expect(resultado.sinPeriodo).toBe(1);
    // `fallido` puede cobrar legítimamente, así que NO es huérfana por estado.
    expect(resultado.huerfanas).toBe(0);
  });

  it('no marca nada cuando la línea sí tiene período', async () => {
    const { cliente } = clienteConEstadoPedido('fallido', 'periodo-1');

    const resultado = await detectarLineasCobroHuerfanas(cliente as never, TENANT, 'run-4');

    expect(resultado.sinPeriodo).toBe(0);
    expect(resultado.huerfanas).toBe(0);
  });

  it('las dos condiciones son ortogonales: una línea puede disparar ambas', async () => {
    // Pedido `devuelto` (huérfana por estado) Y sin período asignado.
    const { cliente } = clienteConEstadoPedido('devuelto', null);

    const resultado = await detectarLineasCobroHuerfanas(cliente as never, TENANT, 'run-5');

    expect(resultado.sinPeriodo).toBe(1);
    expect(resultado.huerfanas).toBe(1);
  });
});
