/**
 * Tests del job geocoding/geocodificarPedido.
 * =====================================================================
 *
 * El job real es una función Inngest con `step.run` y dependencias de Supabase
 * (service_role) + el puerto de geocoding. Aquí se ejercita el HANDLER real:
 *   - `@/lib/inngest/cliente` está mockeado para que `createFunction(config, handler)`
 *     devuelva `{ config, handler }` (mismo patrón que dinero/jobs).
 *   - `step.run(label, fn)` se simula ejecutando `fn()` directamente (sin durabilidad).
 *   - Supabase service_role se mockea con un cliente chainable por tabla.
 *   - El puerto se inyecta vía `setPuertoGeocoding` (sin red).
 *
 * Casos:
 *   2. Cache MISS → llama al puerto (spy) y hace UPSERT en geocoding_cache.
 *   3. Cache HIT → NO llama al puerto; usa el resultado cacheado.
 *   4. Idempotencia → geo_estado != 'pendiente' → no-op (sin puerto, sin escritura).
 *   5. no_resuelto → persiste y termina OK (sin throw, no se reintenta lo irresoluble).
 *   6. calcularCobertura (función pura).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks de módulos externos
// ---------------------------------------------------------------------------

// `createFunction(config, handler)` → captura el handler para invocarlo directo.
vi.mock('@/lib/inngest/cliente', () => ({
  inngest: {
    createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  jobGeocodificarPedido,
  calcularCobertura,
  setPuertoGeocoding,
  resetPuertoGeocoding,
} from './geocodificar-pedido';
import type { PuertoGeocoding } from '../puerto';
import type { ResultadoGeocoding } from '../tipos';

// ---------------------------------------------------------------------------
// Infraestructura de test: handler, step falso y Supabase chainable
// ---------------------------------------------------------------------------

/** El handler real del job (capturado por el mock de createFunction). */
const handler = (jobGeocodificarPedido as unknown as {
  handler: (ctx: {
    event: { data: Record<string, unknown> };
    step: { run: (label: string, fn: () => Promise<unknown>) => Promise<unknown> };
    logger: { info: (m: string) => void; warn: (m: string) => void };
  }) => Promise<{ resultado: string; geoEstado?: string }>;
}).handler;

/** `step.run` que ejecuta el callback directamente (sin durabilidad). */
const stepFalso = {
  run: <T>(_label: string, fn: () => Promise<T>): Promise<T> => fn(),
};

const loggerFalso = { info: vi.fn(), warn: vi.fn() };

/**
 * Construye un cliente Supabase chainable que responde por tabla.
 *
 * Cada query del job termina en `.maybeSingle()`, `.limit()` o en una mutación
 * (`.upsert()` / `.update()`); el builder devuelve esos resultados según la
 * tabla y registra los spies de upsert/update para aserciones.
 */
function crearSupabaseMock(opciones: {
  /** Fila de `operacion.pedidos` que devuelve el step 1. `null` = no encontrado. */
  pedido: Record<string, unknown> | null;
  /** Fila de `integraciones.geocoding_cache`. `null` = cache MISS. */
  cache: Record<string, unknown> | null;
  /** ¿Hay tarifa vigente? Controla el resultado del `.limit()` de tarifas. */
  hayTarifa: boolean;
}) {
  const upsertCache = vi.fn().mockResolvedValue({ error: null });
  const updatePedido = vi.fn().mockReturnThis();

  // Builder por tabla. `terminal` resuelve maybeSingle/limit.
  function builderPara(tabla: string) {
    const builder: Record<string, unknown> = {};
    const self = () => builder;

    builder.select = vi.fn(self);
    builder.eq = vi.fn(self);
    builder.lte = vi.fn(self);
    builder.or = vi.fn(self);
    builder.order = vi.fn(self);

    builder.maybeSingle = vi.fn(async () => {
      if (tabla === 'pedidos') return { data: opciones.pedido, error: null };
      if (tabla === 'geocoding_cache') return { data: opciones.cache, error: null };
      return { data: null, error: null };
    });

    builder.limit = vi.fn(async () => {
      if (tabla === 'tarifas') {
        return { data: opciones.hayTarifa ? [{ id: 'tarifa-1' }] : [], error: null };
      }
      return { data: [], error: null };
    });

    builder.upsert = upsertCache;

    // update(...).eq(...) → Promise<{error}>; encadenable y "thenable".
    builder.update = vi.fn((valores: Record<string, unknown>) => {
      updatePedido(valores);
      return {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    return builder;
  }

  const cliente = {
    _ultimaTabla: '' as string,
    schema: vi.fn(() => cliente),
    from: vi.fn((tabla: string) => builderPara(tabla)),
  };

  return { cliente, upsertCache, updatePedido };
}

/** Puerto doble con spy en `geocodificar`, devolviendo `resultado`. */
function puertoDoble(resultado: ResultadoGeocoding) {
  const geocodificar = vi.fn().mockResolvedValue(resultado);
  const puerto: PuertoGeocoding = { geocodificar };
  return { puerto, geocodificar };
}

const RESUELTO_PROVIDENCIA: ResultadoGeocoding = {
  resuelto: true,
  lat: -33.4314,
  long: -70.6111,
  confianza: 0.9,
  estado: 'resuelto',
  comunaResuelta: 'Providencia',
  proveedor: 'stub',
};

const eventoBase = {
  pedidoId: 'pedido-1',
  tenantId: 'tenant-1',
  sellerId: 'seller-1',
  direccion: 'Av. Providencia 1234',
  comuna: 'Providencia',
  tipoPedido: 'flex' as const,
};

const pedidoPendiente = {
  id: 'pedido-1',
  tenant_id: 'tenant-1',
  seller_id: 'seller-1',
  geo_estado: 'pendiente',
  destinatario_comuna: 'Providencia',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  resetPuertoGeocoding();
});

// ===========================================================================
// CASO 2 — Cache MISS
// ===========================================================================

describe('geocodificarPedido — cache MISS', () => {
  it('sin fila en cache → llama al puerto y hace UPSERT en geocoding_cache', async () => {
    const { cliente, upsertCache } = crearSupabaseMock({
      pedido: pedidoPendiente,
      cache: null,
      hayTarifa: true,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const { puerto, geocodificar } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    const res = await handler({ event: { data: eventoBase }, step: stepFalso, logger: loggerFalso });

    expect(geocodificar).toHaveBeenCalledOnce();
    expect(geocodificar).toHaveBeenCalledWith({
      direccion: eventoBase.direccion,
      comuna: 'Providencia',
      // El job pasa un techo de tiempo propio (15 s), más holgado que el del
      // camino síncrono de bodegas porque aquí nadie espera en pantalla: existe
      // para que un fetch colgado no retenga su slot de concurrencia. Se afirma
      // que VIAJA hasta el puerto, no solo que el job lo declara.
      timeoutMs: 15_000,
    });
    // Se cachea el resultado del proveedor.
    expect(upsertCache).toHaveBeenCalledOnce();
    const filaCache = upsertCache.mock.calls[0][0] as Record<string, unknown>;
    expect(filaCache.geo_estado).toBe('resuelto');
    expect(filaCache.proveedor).toBe('stub');
    expect(filaCache).toHaveProperty('clave_hash');
    expect(res.resultado).toBe('geocodificado');
    expect(res.geoEstado).toBe('resuelto');
  });
});

// ===========================================================================
// CASO 3 — Cache HIT
// ===========================================================================

describe('geocodificarPedido — cache HIT', () => {
  it('con fila en cache → NO llama al puerto (spy sin invocar) y usa lo cacheado', async () => {
    const { cliente, upsertCache, updatePedido } = crearSupabaseMock({
      pedido: pedidoPendiente,
      cache: {
        lat: -33.43,
        long: -70.61,
        geo_estado: 'resuelto',
        confianza: 0.8,
        proveedor: 'google',
        comuna_norm: 'providencia',
      },
      hayTarifa: true,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const { puerto, geocodificar } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    const res = await handler({ event: { data: eventoBase }, step: stepFalso, logger: loggerFalso });

    expect(geocodificar).not.toHaveBeenCalled();
    expect(upsertCache).not.toHaveBeenCalled();
    // Persiste lo cacheado en el pedido.
    expect(updatePedido).toHaveBeenCalledOnce();
    const valores = updatePedido.mock.calls[0][0] as Record<string, unknown>;
    expect(valores.geo_estado).toBe('resuelto');
    expect(valores.lat).toBe(-33.43);
    expect(res.resultado).toBe('geocodificado');
  });
});

// ===========================================================================
// CASO 4 — Idempotencia (ya geocodificado)
// ===========================================================================

describe('geocodificarPedido — idempotencia', () => {
  it("geo_estado != 'pendiente' → no-op (no llama puerto, no escribe)", async () => {
    const { cliente, upsertCache, updatePedido } = crearSupabaseMock({
      pedido: { ...pedidoPendiente, geo_estado: 'resuelto' },
      cache: null,
      hayTarifa: true,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const { puerto, geocodificar } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    const res = await handler({ event: { data: eventoBase }, step: stepFalso, logger: loggerFalso });

    expect(res.resultado).toBe('ya_geocodificado');
    expect(res.geoEstado).toBe('resuelto');
    expect(geocodificar).not.toHaveBeenCalled();
    expect(upsertCache).not.toHaveBeenCalled();
    expect(updatePedido).not.toHaveBeenCalled();
  });

  it('pedido no encontrado → no-op limpio (sin throw, sin puerto)', async () => {
    const { cliente, updatePedido } = crearSupabaseMock({
      pedido: null,
      cache: null,
      hayTarifa: true,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const { puerto, geocodificar } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    const res = await handler({ event: { data: eventoBase }, step: stepFalso, logger: loggerFalso });

    expect(res.resultado).toBe('pedido_no_encontrado');
    expect(geocodificar).not.toHaveBeenCalled();
    expect(updatePedido).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// CASO 5 — no_resuelto no reintenta
// ===========================================================================

describe('geocodificarPedido — no_resuelto persiste sin reintentar', () => {
  it("puerto devuelve 'no_resuelto' → persiste y termina OK (sin throw)", async () => {
    const { cliente, upsertCache, updatePedido } = crearSupabaseMock({
      pedido: { ...pedidoPendiente, destinatario_comuna: 'Valparaíso' },
      cache: null,
      hayTarifa: false,
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const noResuelto: ResultadoGeocoding = {
      resuelto: false,
      lat: null,
      long: null,
      confianza: null,
      estado: 'no_resuelto',
      comunaResuelta: null,
      proveedor: 'stub',
    };
    const { puerto, geocodificar } = puertoDoble(noResuelto);
    setPuertoGeocoding(() => puerto);

    const res = await handler({
      event: { data: { ...eventoBase, comuna: 'Valparaíso' } },
      step: stepFalso,
      logger: loggerFalso,
    });

    // No lanza: el job persiste el no_resuelto y retorna geocodificado.
    expect(res.resultado).toBe('geocodificado');
    expect(res.geoEstado).toBe('no_resuelto');
    expect(geocodificar).toHaveBeenCalledOnce();
    // Igual se cachea (una dirección irresoluble es un hecho cacheable).
    expect(upsertCache).toHaveBeenCalledOnce();
    const valores = updatePedido.mock.calls[0][0] as Record<string, unknown>;
    expect(valores.geo_estado).toBe('no_resuelto');
    expect(valores.lat).toBeNull();
    // Comuna declarada fuera de catálogo → requiere_revision.
    expect(valores.cobertura_estado).toBe('requiere_revision');
  });
});

// ===========================================================================
// CASO 6 — calcularCobertura (función pura)
// ===========================================================================

describe('calcularCobertura — función pura', () => {
  it('comuna fuera de catálogo → requiere_revision (manda sobre tarifa)', () => {
    expect(
      calcularCobertura({
        comunaDeclarada: 'Valparaíso',
        comunaResuelta: null,
        hayTarifaVigente: true,
      }),
    ).toBe('requiere_revision');
  });

  it('comuna válida pero sin tarifa vigente → sin_tarifa_zona', () => {
    expect(
      calcularCobertura({
        comunaDeclarada: 'Maipú',
        comunaResuelta: 'Maipú',
        hayTarifaVigente: false,
      }),
    ).toBe('sin_tarifa_zona');
  });

  it('comuna resuelta distinta de la declarada → requiere_revision', () => {
    expect(
      calcularCobertura({
        comunaDeclarada: 'Maipú',
        comunaResuelta: 'Puente Alto',
        hayTarifaVigente: true,
      }),
    ).toBe('requiere_revision');
  });

  it('comuna válida + tarifa vigente + comuna resuelta coincide → tarifada', () => {
    expect(
      calcularCobertura({
        comunaDeclarada: 'Providencia',
        comunaResuelta: 'Providencia',
        hayTarifaVigente: true,
      }),
    ).toBe('tarifada');
  });

  it('comuna resuelta null (geocoding no resolvió) pero declarada válida + tarifa → tarifada', () => {
    expect(
      calcularCobertura({
        comunaDeclarada: 'Providencia',
        comunaResuelta: null,
        hayTarifaVigente: true,
      }),
    ).toBe('tarifada');
  });

  it('coincidencia tolerante a acentos/casing (nunoa vs Ñuñoa) → tarifada', () => {
    expect(
      calcularCobertura({
        comunaDeclarada: 'Ñuñoa',
        comunaResuelta: 'nunoa',
        hayTarifaVigente: true,
      }),
    ).toBe('tarifada');
  });
});
