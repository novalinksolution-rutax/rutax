/**
 * Pruebas de la purga por retención.
 *
 * Lo que se prueba NO es que borre —eso es la parte fácil— sino **qué se niega a
 * borrar**. Un borrado de más en datos personales es irreversible: no hay
 * papelera, no hay `undo`, y la evidencia que se fue era la prueba de una entrega
 * que alguien podía estar reclamando.
 */

import { describe, it, expect } from 'vitest';
import {
  fechaCorte,
  pedidosConRetencion,
  DIAS_RETENCION_IMAGENES,
  DIAS_RETENCION_METADATOS,
} from './purgar-evidencias';

describe('fechaCorte', () => {
  it('resta los días pedidos y devuelve un instante ISO', () => {
    const ahora = new Date('2026-08-05T12:00:00.000Z');
    expect(fechaCorte(ahora, 90)).toBe('2026-05-07T12:00:00.000Z');
    expect(fechaCorte(ahora, 365)).toBe('2025-08-05T12:00:00.000Z');
  });

  it('la política declarada es 90 días para imágenes y 1 año para metadatos', () => {
    // Fijados como test para que un cambio de política sea deliberado y visible
    // en el diff, no un número que alguien ajusta de paso.
    expect(DIAS_RETENCION_IMAGENES).toBe(90);
    expect(DIAS_RETENCION_METADATOS).toBe(365);
  });
});

/**
 * Doble del cliente. Cada tabla devuelve lo que el escenario declare.
 *
 * El constructor es **thenable**: `.select()/.eq()/.in()` devuelven siempre el
 * mismo objeto y la resolución ocurre recién al esperarlo. Hace falta porque la
 * consulta de incidencias encadena DOS `.in()` seguidos (`pedido_id` y `estado`);
 * un doble que resolviera en el primero rompería solo en esa consulta, que es
 * justo la de la retención por incidencia abierta.
 */
function clienteFalso(datos: {
  incidencias?: Array<{ pedido_id: string }>;
  lineas?: Array<{ pedido_id: string; periodo_cobro_id: string | null }>;
  periodos?: Array<{ id: string; estado_cobro: string }>;
}) {
  const constructor = (filas: unknown[]) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.in = () => b;
    b.then = (resolver: (v: unknown) => unknown) => resolver({ data: filas, error: null });
    return b;
  };

  return {
    schema: (esquema: string) => ({
      from: (tabla: string) => {
        if (tabla === 'incidencias') return constructor(datos.incidencias ?? []);
        if (tabla === 'lineas_cobro') return constructor(datos.lineas ?? []);
        if (tabla === 'periodos_cobro') return constructor(datos.periodos ?? []);
        throw new Error(`tabla inesperada: ${esquema}.${tabla}`);
      },
    }),
  };
}

const TENANT = '10000000-0000-0000-0000-000000000001';

describe('pedidosConRetencion — qué NO se puede purgar', () => {
  it('retiene el pedido con una incidencia abierta', async () => {
    const cliente = clienteFalso({
      incidencias: [{ pedido_id: 'p1' }],
      lineas: [
        { pedido_id: 'p1', periodo_cobro_id: 'per1' },
        { pedido_id: 'p2', periodo_cobro_id: 'per1' },
      ],
      periodos: [{ id: 'per1', estado_cobro: 'pagado' }],
    });

    const retenidos = await pedidosConRetencion(cliente as never, TENANT, ['p1', 'p2']);

    expect(retenidos.has('p1')).toBe(true);
    expect(retenidos.has('p2')).toBe(false);
  });

  it('retiene el pedido cuyo período de cobro no está pagado', async () => {
    const cliente = clienteFalso({
      lineas: [
        { pedido_id: 'p1', periodo_cobro_id: 'perPagado' },
        { pedido_id: 'p2', periodo_cobro_id: 'perPendiente' },
        { pedido_id: 'p3', periodo_cobro_id: 'perParcial' },
      ],
      periodos: [
        { id: 'perPagado', estado_cobro: 'pagado' },
        { id: 'perPendiente', estado_cobro: 'pendiente' },
        { id: 'perParcial', estado_cobro: 'parcial' },
      ],
    });

    const retenidos = await pedidosConRetencion(cliente as never, TENANT, ['p1', 'p2', 'p3']);

    expect(retenidos.has('p1')).toBe(false);
    expect(retenidos.has('p2')).toBe(true);
    // Un pago parcial es un cobro abierto: la evidencia todavía puede hacer falta.
    expect(retenidos.has('p3')).toBe(true);
  });

  it('`no_aplica` no retiene — es un same-day de gasto propio, no un cobro abierto', async () => {
    const cliente = clienteFalso({
      lineas: [{ pedido_id: 'p1', periodo_cobro_id: 'per1' }],
      periodos: [{ id: 'per1', estado_cobro: 'no_aplica' }],
    });

    const retenidos = await pedidosConRetencion(cliente as never, TENANT, ['p1']);
    expect(retenidos.has('p1')).toBe(false);
  });

  it('retiene el pedido cuya línea de cobro quedó SIN período', async () => {
    // El caso `linea_cobro_sin_periodo`: un cobro que no entró en ninguna factura.
    // Borrar su evidencia sería perder la prueba de un cobro que todavía se puede
    // reclamar.
    const cliente = clienteFalso({
      lineas: [{ pedido_id: 'p1', periodo_cobro_id: null }],
    });

    const retenidos = await pedidosConRetencion(cliente as never, TENANT, ['p1']);
    expect(retenidos.has('p1')).toBe(true);
  });

  it('un pedido sin línea de cobro ni incidencia sí se puede purgar', async () => {
    const cliente = clienteFalso({});
    const retenidos = await pedidosConRetencion(cliente as never, TENANT, ['p1', 'p2']);
    expect(retenidos.size).toBe(0);
  });

  it('sin candidatos no consulta nada', async () => {
    // El doble lanza ante cualquier tabla inesperada, así que si tocara la base
    // con la lista vacía este test fallaría.
    const cliente = { schema: () => { throw new Error('no debería consultar'); } };
    const retenidos = await pedidosConRetencion(cliente as never, TENANT, []);
    expect(retenidos.size).toBe(0);
  });
});
