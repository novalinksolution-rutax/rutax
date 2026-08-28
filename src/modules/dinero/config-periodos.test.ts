/**
 * Tests de `config-periodos.ts` — el lector único de la periodicidad.
 * =============================================================================
 *
 * Estas pruebas existen por un bug concreto: `dinero.config_periodos` la leía el
 * motor y **no la escribía nadie**, así que la lectura caía siempre en el
 * respaldo `'mensual'` y todo courier facturaba mensual sin poder cambiarlo. Al
 * darle una pantalla, el riesgo se muda: que la pantalla diga una cosa y el
 * motor calcule otra.
 *
 * ⚠️ **Se prueba la función real, no una reimplementación.** Es la lección de
 * los tests viejos de `conciliar-periodo`, que reimplementaban la lógica dentro
 * del propio archivo de prueba y pasaban en verde con el bug vivo.
 *
 * ⚠️ El doble modela el ORDEN de la consulta real (`seller_id` descendente, los
 * nulos al final). Si lo modelara como "la primera que encuentre", la prueba de
 * precedencia pasaría sin demostrar nada — que es la otra forma de tener un test
 * verde sobre un bug.
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  PERIODICIDAD_POR_DEFECTO,
  contarPeriodosAbiertosConLineas,
  esTipoPeriodoFacturacion,
  leerPeriodicidadFacturacion,
  leerPeriodicidadTenant,
} from './config-periodos';

// =============================================================================
// Doble de Supabase
// =============================================================================

interface FilaConfig {
  tipo_periodo: string;
  seller_id: string | null;
  creado_en?: string;
}
interface FilaPeriodo {
  id: string;
  estado: string;
}
interface FilaLinea {
  periodo_cobro_id: string;
}

interface Datos {
  config?: FilaConfig[];
  periodos?: FilaPeriodo[];
  lineas?: FilaLinea[];
}

function crearClienteFalso(datos: Datos) {
  const config = datos.config ?? [];
  const periodos = datos.periodos ?? [];
  const lineas = datos.lineas ?? [];

  function builderConfig() {
    // `soloTenant` lo activa `.is('seller_id', null)`; `sellerPedido` lo activa
    // `.or(...)`. Son excluyentes, igual que en la función real.
    let soloTenant = false;
    let sellerPedido: string | null = null;
    let ordenado = false;

    const b = {
      select: () => b,
      eq: () => b,
      is: (col: string, val: unknown) => {
        if (col === 'seller_id' && val === null) soloTenant = true;
        return b;
      },
      or: (expr: string) => {
        const m = /seller_id\.eq\.([^,]+)/.exec(expr);
        sellerPedido = m ? m[1] : null;
        return b;
      },
      order: (col: string, opts: { ascending?: boolean; nullsFirst?: boolean }) => {
        // Solo se honra el orden que la función real pide.
        if (col === 'seller_id' && opts.ascending === false && opts.nullsFirst === false) {
          ordenado = true;
        }
        return b;
      },
      limit: (n: number) => {
        let filas = config.filter((f) => {
          if (soloTenant) return f.seller_id === null;
          if (sellerPedido !== null) return f.seller_id === sellerPedido || f.seller_id === null;
          return true;
        });

        if (ordenado) {
          // Descendente con nulos al final: la fila del seller antes que la del
          // tenant. Es lo que hace que el override gane.
          filas = [...filas].sort((a, z) => {
            if (a.seller_id === z.seller_id) return 0;
            if (a.seller_id === null) return 1;
            if (z.seller_id === null) return -1;
            return z.seller_id.localeCompare(a.seller_id);
          });
        }

        return Promise.resolve({ data: filas.slice(0, n), error: null });
      },
    };
    return b;
  }

  function builderPeriodos() {
    const filtros: Array<(f: FilaPeriodo) => boolean> = [];
    const b = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        if (col === 'estado') filtros.push((f) => f.estado === val);
        return b;
      },
      // Se `await`ea directamente sobre `.eq()`: el builder es thenable, igual
      // que el de PostgREST.
      then: (resolver: (r: { data: FilaPeriodo[]; error: null }) => unknown) =>
        resolver({ data: periodos.filter((f) => filtros.every((fn) => fn(f))), error: null }),
    };
    return b;
  }

  function builderLineas() {
    let ids: string[] = [];
    const b = {
      select: () => b,
      eq: () => b,
      in: (_col: string, valores: string[]) => {
        ids = valores;
        return b;
      },
      then: (resolver: (r: { data: FilaLinea[]; error: null }) => unknown) =>
        resolver({
          data: lineas.filter((l) => ids.includes(l.periodo_cobro_id)),
          error: null,
        }),
    };
    return b;
  }

  return {
    schema(esquema: string) {
      return {
        from(tabla: string) {
          if (esquema === 'dinero' && tabla === 'config_periodos') return builderConfig();
          if (esquema === 'dinero' && tabla === 'periodos_cobro') return builderPeriodos();
          if (esquema === 'dinero' && tabla === 'lineas_cobro') return builderLineas();
          throw new Error(`Tabla no modelada: ${esquema}.${tabla}`);
        },
      };
    },
  } as unknown as SupabaseClient;
}

// =============================================================================
// esTipoPeriodoFacturacion
// =============================================================================

describe('esTipoPeriodoFacturacion', () => {
  it('acepta los tres valores del CHECK', () => {
    expect(esTipoPeriodoFacturacion('semanal')).toBe(true);
    expect(esTipoPeriodoFacturacion('quincenal')).toBe(true);
    expect(esTipoPeriodoFacturacion('mensual')).toBe(true);
  });

  it('rechaza cualquier otra cosa — falla cerrado', () => {
    expect(esTipoPeriodoFacturacion('anual')).toBe(false);
    expect(esTipoPeriodoFacturacion('')).toBe(false);
    expect(esTipoPeriodoFacturacion(null)).toBe(false);
    expect(esTipoPeriodoFacturacion(undefined)).toBe(false);
    expect(esTipoPeriodoFacturacion(15)).toBe(false);
  });
});

// =============================================================================
// leerPeriodicidadFacturacion
// =============================================================================

describe('leerPeriodicidadFacturacion', () => {
  it('sin configuración devuelve el respaldo del motor (mensual)', async () => {
    const cliente = crearClienteFalso({ config: [] });
    const tipo = await leerPeriodicidadFacturacion(cliente, { tenantId: 't', sellerId: 's' });

    expect(tipo).toBe('mensual');
    expect(tipo).toBe(PERIODICIDAD_POR_DEFECTO);
  });

  it('usa la configuración del tenant cuando el seller no tiene la suya', async () => {
    const cliente = crearClienteFalso({
      config: [{ tipo_periodo: 'quincenal', seller_id: null }],
    });

    expect(await leerPeriodicidadFacturacion(cliente, { tenantId: 't', sellerId: 's' })).toBe(
      'quincenal',
    );
  });

  it('🔴 el override del seller GANA sobre el default del tenant', async () => {
    const cliente = crearClienteFalso({
      config: [
        { tipo_periodo: 'mensual', seller_id: null },
        { tipo_periodo: 'semanal', seller_id: 's' },
      ],
    });

    expect(await leerPeriodicidadFacturacion(cliente, { tenantId: 't', sellerId: 's' })).toBe(
      'semanal',
    );
  });

  it('🔴 sin sellerId (liquidación de conductor) el override del seller NO aplica', async () => {
    // Un conductor reparte pedidos de varios sellers en el mismo día: su
    // liquidación no tiene a cuál seller mirar, y por eso sigue la del tenant.
    const cliente = crearClienteFalso({
      config: [
        { tipo_periodo: 'mensual', seller_id: null },
        { tipo_periodo: 'semanal', seller_id: 's' },
      ],
    });

    expect(await leerPeriodicidadFacturacion(cliente, { tenantId: 't' })).toBe('mensual');
  });

  it('un valor que no está en el CHECK cae al respaldo, no se propaga', async () => {
    // Defensa contra una fila escrita fuera de la función de base (un seed a
    // mano, una migración futura que amplíe el CHECK sin avisar al motor).
    const cliente = crearClienteFalso({
      config: [{ tipo_periodo: 'bimestral', seller_id: null }],
    });

    expect(await leerPeriodicidadFacturacion(cliente, { tenantId: 't' })).toBe('mensual');
  });
});

// =============================================================================
// leerPeriodicidadTenant — la distinción que necesita la pantalla
// =============================================================================

describe('leerPeriodicidadTenant', () => {
  it('sin fila: mensual, y marcado como NO explícito', async () => {
    const cliente = crearClienteFalso({ config: [] });
    const r = await leerPeriodicidadTenant(cliente, 't');

    expect(r.tipoPeriodo).toBe('mensual');
    expect(r.explicita).toBe(false);
    expect(r.fijadaEn).toBeNull();
  });

  it('🔴 con fila mensual: el MISMO valor, pero explícito', async () => {
    // El caso que justifica el campo: "mensual heredado" y "mensual elegido" se
    // ven idénticos y solo uno de los dos es una decisión del courier.
    const cliente = crearClienteFalso({
      config: [{ tipo_periodo: 'mensual', seller_id: null, creado_en: '2026-08-28T12:00:00Z' }],
    });
    const r = await leerPeriodicidadTenant(cliente, 't');

    expect(r.tipoPeriodo).toBe('mensual');
    expect(r.explicita).toBe(true);
    expect(r.fijadaEn).toBe('2026-08-28T12:00:00Z');
  });

  it('ignora los overrides de seller', async () => {
    const cliente = crearClienteFalso({
      config: [{ tipo_periodo: 'semanal', seller_id: 's' }],
    });
    const r = await leerPeriodicidadTenant(cliente, 't');

    expect(r.tipoPeriodo).toBe('mensual');
    expect(r.explicita).toBe(false);
  });
});

// =============================================================================
// contarPeriodosAbiertosConLineas — el candado, leído para avisar
// =============================================================================

describe('contarPeriodosAbiertosConLineas', () => {
  it('sin períodos abiertos devuelve 0 y no consulta líneas', async () => {
    const cliente = crearClienteFalso({ periodos: [], lineas: [] });
    expect(await contarPeriodosAbiertosConLineas(cliente, 't')).toBe(0);
  });

  it('un período abierto SIN líneas no bloquea', async () => {
    const cliente = crearClienteFalso({
      periodos: [{ id: 'p1', estado: 'abierto' }],
      lineas: [],
    });
    expect(await contarPeriodosAbiertosConLineas(cliente, 't')).toBe(0);
  });

  it('🔴 cuenta PERÍODOS distintos, no líneas', async () => {
    // Tres líneas en un solo período son un período bloqueante, no tres. Contar
    // líneas haría que el aviso dijera "tienes 3 períodos abiertos" con uno.
    const cliente = crearClienteFalso({
      periodos: [{ id: 'p1', estado: 'abierto' }],
      lineas: [
        { periodo_cobro_id: 'p1' },
        { periodo_cobro_id: 'p1' },
        { periodo_cobro_id: 'p1' },
      ],
    });
    expect(await contarPeriodosAbiertosConLineas(cliente, 't')).toBe(1);
  });

  it('🔴 un período CERRADO con líneas no bloquea', async () => {
    // Cambiar la periodicidad no puede partir lo que ya se cerró: el candado
    // solo mira lo que sigue abierto.
    const cliente = crearClienteFalso({
      periodos: [
        { id: 'p1', estado: 'cerrado' },
        { id: 'p2', estado: 'abierto' },
      ],
      lineas: [{ periodo_cobro_id: 'p1' }],
    });
    expect(await contarPeriodosAbiertosConLineas(cliente, 't')).toBe(0);
  });

  it('cuenta dos períodos abiertos de sellers distintos con líneas', async () => {
    const cliente = crearClienteFalso({
      periodos: [
        { id: 'p1', estado: 'abierto' },
        { id: 'p2', estado: 'abierto' },
      ],
      lineas: [{ periodo_cobro_id: 'p1' }, { periodo_cobro_id: 'p2' }],
    });
    expect(await contarPeriodosAbiertosConLineas(cliente, 't')).toBe(2);
  });
});
