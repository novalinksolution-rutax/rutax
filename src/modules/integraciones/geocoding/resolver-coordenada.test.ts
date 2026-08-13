/**
 * Tests de `resolverCoordenadaConCache`.
 * =====================================================================
 * Extraído del "Paso 2" de `jobs/geocodificar-pedido.ts` (ver ese archivo
 * para los tests de extremo a extremo del job, que siguen intactos y pasan
 * consumiendo este helper). Aquí se cubre lo que es responsabilidad PROPIA
 * del helper:
 *   1. Cache MISS → llama al puerto y hace UPSERT.
 *   2. Cache HIT → NO llama al puerto, arma el resultado desde la fila cacheada.
 *   3. El caché es compartido entre llamadores distintos (mismo direccion+comuna
 *      → mismo clave_hash), que es justo por qué se comparte entre pedidos y
 *      bodegas.
 *   4. `timeoutMs` se propaga al puerto SOLO cuando el llamador lo pasa — el
 *      job (sin timeoutMs) preserva el comportamiento histórico.
 *   5. Logger opcional: se usa en HIT si está, no revienta si no está.
 *   6. Errores de lectura/escritura del cache se propagan como `Error`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/supabase/service-role', () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import {
  resolverCoordenadaConCache,
  setPuertoGeocoding,
  resetPuertoGeocoding,
  TIMEOUT_GEOCODING_SINCRONO_MS,
} from './resolver-coordenada';
import { calcularClaveHash } from './normalizacion';
import type { PuertoGeocoding } from './puerto';
import type { ResultadoGeocoding } from './tipos';

/** Cliente Supabase chainable mínimo — el helper solo toca `geocoding_cache`. */
function crearSupabaseMock(cache: Record<string, unknown> | null) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const eq = vi.fn();
  const maybeSingle = vi.fn().mockResolvedValue({ data: cache, error: null });

  const builder = {
    select: vi.fn(() => builder),
    eq: eq.mockImplementation(() => builder),
    maybeSingle,
    upsert,
  };

  const cliente = {
    schema: vi.fn(() => cliente),
    from: vi.fn(() => builder),
  };

  return { cliente, upsert, eq, maybeSingle };
}

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
  proveedor: 'google',
};

afterEach(() => {
  resetPuertoGeocoding();
  vi.clearAllMocks();
});

describe('resolverCoordenadaConCache — cache MISS', () => {
  it('sin fila en cache → llama al puerto y hace UPSERT con clave_hash/direccion_norm/comuna_norm', async () => {
    const { cliente, upsert, eq } = crearSupabaseMock(null);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const { puerto, geocodificar } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    const resultado = await resolverCoordenadaConCache({
      direccion: 'Av. Providencia 1234',
      comuna: 'Providencia',
    });

    const { claveHash, direccionNorm, comunaNorm } = calcularClaveHash(
      'Av. Providencia 1234',
      'Providencia',
    );

    expect(eq).toHaveBeenCalledWith('clave_hash', claveHash);
    expect(geocodificar).toHaveBeenCalledOnce();
    expect(geocodificar).toHaveBeenCalledWith({
      direccion: 'Av. Providencia 1234',
      comuna: 'Providencia',
      timeoutMs: undefined,
    });

    expect(upsert).toHaveBeenCalledOnce();
    const filaUpsert = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(filaUpsert).toMatchObject({
      clave_hash: claveHash,
      direccion_norm: direccionNorm,
      comuna_norm: comunaNorm,
      lat: RESUELTO_PROVIDENCIA.lat,
      long: RESUELTO_PROVIDENCIA.long,
      geo_estado: 'resuelto',
      confianza: RESUELTO_PROVIDENCIA.confianza,
      proveedor: 'google',
    });

    // El resultado devuelto es el que produjo el puerto, sin transformar.
    expect(resultado).toEqual(RESUELTO_PROVIDENCIA);
  });

  it('propaga timeoutMs al puerto cuando el llamador lo pasa (camino síncrono)', async () => {
    const { cliente } = crearSupabaseMock(null);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const { puerto, geocodificar } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    await resolverCoordenadaConCache({
      direccion: 'Av. Providencia 1234',
      comuna: 'Providencia',
      timeoutMs: TIMEOUT_GEOCODING_SINCRONO_MS,
    });

    expect(geocodificar).toHaveBeenCalledWith({
      direccion: 'Av. Providencia 1234',
      comuna: 'Providencia',
      timeoutMs: TIMEOUT_GEOCODING_SINCRONO_MS,
    });
  });

  it('error al hacer upsert (tras ya haber llamado al puerto) → lanza Error', async () => {
    const { cliente, upsert } = crearSupabaseMock(null);
    upsert.mockResolvedValue({ error: { message: 'connection reset' } });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const { puerto, geocodificar } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    await expect(
      resolverCoordenadaConCache({ direccion: 'X 123', comuna: 'Providencia' }),
    ).rejects.toThrow('Error al upsert en geocoding_cache: connection reset');
    expect(geocodificar).toHaveBeenCalledOnce();
  });
});

describe('resolverCoordenadaConCache — cache HIT', () => {
  it('con fila en cache → NO llama al puerto, NO hace upsert, arma ResultadoGeocoding desde la fila', async () => {
    const { cliente, upsert } = crearSupabaseMock({
      lat: -33.43,
      long: -70.61,
      geo_estado: 'resuelto',
      confianza: 0.8,
      proveedor: 'google',
      comuna_norm: 'providencia',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const { puerto, geocodificar } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    const resultado = await resolverCoordenadaConCache({
      direccion: 'Av. Providencia 1234',
      comuna: 'Providencia',
    });

    expect(geocodificar).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(resultado).toEqual({
      resuelto: true,
      lat: -33.43,
      long: -70.61,
      confianza: 0.8,
      estado: 'resuelto',
      comunaResuelta: 'Providencia',
      proveedor: 'google',
    });
  });

  it('fila cacheada no_resuelto → resuelto:false y comunaResuelta refleja la comuna declarada (no la del cache)', async () => {
    const { cliente } = crearSupabaseMock({
      lat: null,
      long: null,
      geo_estado: 'no_resuelto',
      confianza: null,
      proveedor: 'stub',
      comuna_norm: 'providencia',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const { puerto } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    const resultado = await resolverCoordenadaConCache({
      direccion: 'Av. Providencia 1234',
      comuna: 'Providencia',
    });

    expect(resultado.resuelto).toBe(false);
    expect(resultado.estado).toBe('no_resuelto');
    expect(resultado.comunaResuelta).toBe('Providencia');
  });

  it('invoca el logger en HIT cuando se provee, y no revienta cuando no se provee', async () => {
    const { cliente } = crearSupabaseMock({
      lat: -33.43,
      long: -70.61,
      geo_estado: 'resuelto',
      confianza: 0.8,
      proveedor: 'google',
      comuna_norm: 'providencia',
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const { puerto } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    const info = vi.fn();
    await resolverCoordenadaConCache({
      direccion: 'Av. Providencia 1234',
      comuna: 'Providencia',
      logger: { info },
    });
    expect(info).toHaveBeenCalledOnce();

    // Sin logger: no debe lanzar.
    await expect(
      resolverCoordenadaConCache({ direccion: 'Av. Providencia 1234', comuna: 'Providencia' }),
    ).resolves.toBeDefined();
  });

  it('error al leer el cache → lanza Error y NO llama al puerto', async () => {
    const { cliente, maybeSingle } = crearSupabaseMock(null);
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout de red' } });
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const { puerto, geocodificar } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    await expect(
      resolverCoordenadaConCache({ direccion: 'X 123', comuna: 'Providencia' }),
    ).rejects.toThrow('Error al leer geocoding_cache: timeout de red');
    expect(geocodificar).not.toHaveBeenCalled();
  });
});

describe('resolverCoordenadaConCache — caché compartido entre llamadores', () => {
  it('misma direccion+comuna desde dos llamadores distintos (pedido vs. bodega) usa el mismo clave_hash', async () => {
    const { cliente, eq } = crearSupabaseMock(null);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      cliente as unknown as ReturnType<typeof crearClienteServiceRole>,
    );
    const { puerto } = puertoDoble(RESUELTO_PROVIDENCIA);
    setPuertoGeocoding(() => puerto);

    // "Pedido": llama con la dirección normal.
    await resolverCoordenadaConCache({ direccion: 'Av. Providencia 1234', comuna: 'Providencia' });
    // "Bodega": misma dirección con distinto casing/espacios — debe normalizar igual.
    await resolverCoordenadaConCache({ direccion: '  av. PROVIDENCIA   1234 ', comuna: 'providencia' });

    const clavesUsadas = eq.mock.calls.map((llamada) => llamada[1]);
    expect(clavesUsadas[0]).toBe(clavesUsadas[1]);
  });
});
