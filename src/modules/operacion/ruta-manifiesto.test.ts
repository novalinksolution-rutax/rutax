/**
 * Pruebas de `ruta-manifiesto.ts` — la orquestación entre el motor de ruteo y
 * la base de datos (etapa 7 de "retiro en bodega + ruteo").
 *
 * FUENTE DE VERDAD DE PRIVACIDAD: `docs/seguridad/punto-de-termino-conductor.md`.
 * La prueba más importante de este archivo es §6.3 punto 9: dos conductores con
 * las mismas paradas, uno con punto de término y otro sin él, tienen que
 * producir un resultado con las MISMAS claves y sin una sola cifra que delate
 * la coordenada del ancla.
 *
 * `obtenerAnclaFinRuta` (de `./punto-termino-conductor`) y
 * `aplicarSecuenciaParadasRpc`/`pedidoIdsDesdeSecuencia` (de
 * `./secuencia-paradas-rpc`) se mockean: lo que este archivo prueba es la
 * ORQUESTACIÓN (`calcularYAplicarRutaManifiesto` + `obtenerOrigenRutaDelCourier`)
 * y el MOTOR REAL (`./ruteo`, no mockeado — es puro y determinista), no la
 * escritura del RPC en sí (eso lo cubre `secuencia-paradas-rpc.test.ts`) ni la
 * lectura de la tabla del ancla (eso lo cubre `punto-termino-conductor.ts` vía
 * las rutas Bearer).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./punto-termino-conductor", () => ({
  obtenerAnclaFinRuta: vi.fn(),
}));

vi.mock("./secuencia-paradas-rpc", async (importActual) => {
  const actual =
    await importActual<typeof import("./secuencia-paradas-rpc")>();
  return {
    ...actual,
    aplicarSecuenciaParadasRpc: vi.fn(),
  };
});

import { obtenerAnclaFinRuta } from "./punto-termino-conductor";
import { aplicarSecuenciaParadasRpc } from "./secuencia-paradas-rpc";
import {
  calcularYAplicarRutaManifiesto,
  obtenerOrigenRutaDelCourier,
  ErrorManifiestoNoEncontrado,
  ErrorSinBodegaOrigen,
  recalcularRutaTrasCambio,
} from "./ruta-manifiesto";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const MANIFIESTO_1 = "40000000-0000-0000-0000-000000000001";
const MANIFIESTO_2 = "40000000-0000-0000-0000-000000000002";
const ACTOR_1 = "30000000-0000-0000-0000-000000000001";
const DRIVER_CON_ANCLA = "20000000-0000-0000-0000-000000000001";
const DRIVER_SIN_ANCLA = "20000000-0000-0000-0000-000000000002";
const PEDIDO_1 = "50000000-0000-0000-0000-000000000001";
const PEDIDO_2 = "50000000-0000-0000-0000-000000000002";

// =============================================================================
// Fake Supabase en memoria: filtra y ordena de verdad, para que un cambio en
// los `.eq()`/`.not()`/`.order()` del código de producción SÍ pueda cambiar
// qué fila gana — igual que cambiaría en Postgres real.
// =============================================================================

type Fila = Record<string, unknown>;

function valorComparable(v: unknown): number | string {
  if (typeof v === "boolean") return v ? 1 : 0;
  return v as number | string;
}

function builderTabla(filas: Fila[]) {
  const filtros: ((f: Fila) => boolean)[] = [];
  const ordenes: { col: string; ascending: boolean }[] = [];

  function resolver(): Fila[] {
    const resultado = filas.filter((f) => filtros.every((fn) => fn(f)));
    resultado.sort((a, b) => {
      for (const { col, ascending } of ordenes) {
        const av = valorComparable(a[col]);
        const bv = valorComparable(b[col]);
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return ascending ? cmp : -cmp;
      }
      return 0;
    });
    return resultado;
  }

  const self = {
    select: () => self,
    eq: (col: string, val: unknown) => {
      filtros.push((f) => f[col] === val);
      return self;
    },
    not: (col: string, op: string, val: unknown) => {
      if (op === "is" && val === null) {
        filtros.push((f) => f[col] !== null && f[col] !== undefined);
      }
      return self;
    },
    order: (col: string, opts: { ascending: boolean }) => {
      ordenes.push({ col, ascending: opts.ascending });
      return self;
    },
    maybeSingle: async () => {
      const r = resolver();
      return { data: r[0] ?? null, error: null };
    },
    then: (resolve: (v: { data: Fila[]; error: null }) => unknown) =>
      Promise.resolve({ data: resolver(), error: null }).then(resolve),
  };
  return self;
}

function crearClienteFake(opts: {
  manifiestos?: Fila[];
  courierBodegas?: Fila[];
  asignacionesPedido?: Fila[];
}) {
  const manifiestos = opts.manifiestos ?? [];
  const courierBodegas = opts.courierBodegas ?? [];
  const asignacionesPedido = opts.asignacionesPedido ?? [];

  const from = vi.fn((tabla: string) => {
    if (tabla === "manifiestos") return builderTabla(manifiestos);
    if (tabla === "asignaciones_pedido") return builderTabla(asignacionesPedido);
    throw new Error(`from() inesperado en esquema public: ${tabla}`);
  });

  const schema = vi.fn((esquema: string) => {
    if (esquema === "identidad") {
      return {
        from: vi.fn((tabla: string) => {
          if (tabla === "courier_bodegas") return builderTabla(courierBodegas);
          throw new Error(`from() inesperado en esquema identidad: ${tabla}`);
        }),
      };
    }
    throw new Error(`schema() inesperado: ${esquema}`);
  });

  return { from, schema } as unknown as SupabaseClient;
}

function bodegaFila(overrides: Fila = {}): Fila {
  return {
    id: "bodega-1",
    tenant_id: TENANT_A,
    nombre: "Bodega Principal",
    lat: -33.45,
    long: -70.66,
    es_principal: true,
    creado_en: "2026-01-01T00:00:00Z",
    activa: true,
    geo_estado: "resuelto",
    ...overrides,
  };
}

function asignacionFila(pedidoId: string, coords: { lat: number | null; long: number | null }, overrides: Fila = {}): Fila {
  return {
    tenant_id: TENANT_A,
    manifiesto_id: MANIFIESTO_1,
    activa: true,
    pedido_id: pedidoId,
    pedidos: { id: pedidoId, lat: coords.lat, long: coords.long },
    ...overrides,
  };
}

function manifiestoFila(driverId: string, overrides: Fila = {}): Fila {
  return { id: MANIFIESTO_1, tenant_id: TENANT_A, driver_id: driverId, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// recalcularRutaTrasCambio — el gatillo automático (2026-09-05)
// =============================================================================

describe("recalcularRutaTrasCambio", () => {
  const origen = { lat: -33.45, long: -70.66 };
  const parada = { lat: -33.4, long: -70.6 };

  function clienteConUnaParada() {
    return crearClienteFake({
      manifiestos: [manifiestoFila(DRIVER_CON_ANCLA)],
      courierBodegas: [bodegaFila({ lat: origen.lat, long: origen.long })],
      asignacionesPedido: [asignacionFila(PEDIDO_1, parada)],
    });
  }

  it("NO llama al motor cuando el manifiesto sigue en 'borrador'", async () => {
    // El coordinador todavía lo está armando por lotes parciales: recalcular
    // acá pagaría a Google por cada bulto en vez de una vez por manifiesto.
    //
    // ⚠️ El camino de éxito se deja LISTO PARA FUNCIONAR (misma configuración
    // que la prueba de 'confirmado'/'en_ruta' de abajo): si la guarda de
    // estado desapareciera, esta llamada SÍ terminaría invocando el RPC. Sin
    // eso, un `calcularYAplicarRutaManifiesto` que fallara por cualquier otro
    // motivo (p. ej. sin mockear `obtenerAnclaFinRuta`) daría el mismo
    // resultado observable —el RPC nunca se llama— sin que la guarda tuviera
    // nada que ver, y la prueba pasaría igual con la guarda borrada.
    vi.mocked(obtenerAnclaFinRuta).mockResolvedValue(null);
    vi.mocked(aplicarSecuenciaParadasRpc).mockResolvedValue({
      totalParadas: 1,
      totalSinSecuencia: 0,
      totalPreviasLimpiadas: 0,
    });

    await recalcularRutaTrasCambio(clienteConUnaParada(), {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      estadoManifiesto: "borrador",
      actorUsuarioId: ACTOR_1,
      motivo: "prueba",
    });

    expect(aplicarSecuenciaParadasRpc).not.toHaveBeenCalled();
  });

  it.each(["confirmado", "en_ruta"] as const)(
    "SÍ recalcula cuando el manifiesto está '%s'",
    async (estado) => {
      vi.mocked(obtenerAnclaFinRuta).mockResolvedValue(null);
      vi.mocked(aplicarSecuenciaParadasRpc).mockResolvedValue({
        totalParadas: 1,
        totalSinSecuencia: 0,
        totalPreviasLimpiadas: 0,
      });

      await recalcularRutaTrasCambio(clienteConUnaParada(), {
        tenantId: TENANT_A,
        manifiestoId: MANIFIESTO_1,
        estadoManifiesto: estado,
        actorUsuarioId: ACTOR_1,
        motivo: "prueba",
      });

      expect(aplicarSecuenciaParadasRpc).toHaveBeenCalledTimes(1);
    },
  );

  it("🔴 si el ruteo falla, NO propaga el error — el hecho que lo disparó ya ocurrió", async () => {
    // Mismo principio que el motor de dinero: el paso que puede negarse va al
    // final, y su fallo no se lleva por delante lo que ya se confirmó.
    vi.mocked(obtenerAnclaFinRuta).mockResolvedValue(null);
    vi.mocked(aplicarSecuenciaParadasRpc).mockRejectedValue(new Error("Google no respondió"));

    await expect(
      recalcularRutaTrasCambio(clienteConUnaParada(), {
        tenantId: TENANT_A,
        manifiestoId: MANIFIESTO_1,
        estadoManifiesto: "en_ruta",
        actorUsuarioId: ACTOR_1,
        motivo: "prueba",
      }),
    ).resolves.toBeUndefined();
  });
});


// =============================================================================
// 1. obtenerOrigenRutaDelCourier — selección de la bodega de origen
// =============================================================================

describe("obtenerOrigenRutaDelCourier", () => {
  it("prefiere la bodega principal aunque sea más nueva que una activa no principal", async () => {
    const principal = bodegaFila({
      id: "b-principal",
      es_principal: true,
      creado_en: "2026-02-01T00:00:00Z",
    });
    const secundaria = bodegaFila({
      id: "b-secundaria",
      es_principal: false,
      creado_en: "2026-01-01T00:00:00Z",
    });
    const cliente = crearClienteFake({ courierBodegas: [secundaria, principal] });

    const origen = await obtenerOrigenRutaDelCourier(cliente, TENANT_A);

    expect(origen?.id).toBe("b-principal");
  });

  it("si la principal no está geocodificada (no pasa el filtro geo_estado=resuelto), cae a la más ANTIGUA de las activas con coordenada resuelta", async () => {
    const principalNoGeocodificada = bodegaFila({
      id: "b-principal",
      es_principal: true,
      geo_estado: "no_resuelto",
      lat: null,
      long: null,
      creado_en: "2025-01-01T00:00:00Z", // sería la más antigua si no se filtrara
    });
    const vieja = bodegaFila({
      id: "b-vieja",
      es_principal: false,
      creado_en: "2026-01-01T00:00:00Z",
    });
    const nueva = bodegaFila({
      id: "b-nueva",
      es_principal: false,
      creado_en: "2026-03-01T00:00:00Z",
    });
    const cliente = crearClienteFake({
      courierBodegas: [nueva, principalNoGeocodificada, vieja],
    });

    const origen = await obtenerOrigenRutaDelCourier(cliente, TENANT_A);

    expect(origen?.id).toBe("b-vieja");
  });

  it("sin ninguna bodega usable → null", async () => {
    const cliente = crearClienteFake({ courierBodegas: [] });
    expect(await obtenerOrigenRutaDelCourier(cliente, TENANT_A)).toBeNull();
  });

  it("una fila con coordenada corrupta (defensa aunque el filtro SQL debiera excluirla) → null, no lanza", async () => {
    const corrupta = bodegaFila({ lat: 999, long: -70.66 });
    const cliente = crearClienteFake({ courierBodegas: [corrupta] });

    expect(await obtenerOrigenRutaDelCourier(cliente, TENANT_A)).toBeNull();
  });

  it("mapea correctamente id/nombre/lat/long de la fila ganadora", async () => {
    const cliente = crearClienteFake({
      courierBodegas: [bodegaFila({ id: "b-1", nombre: "Galpón Maipú", lat: -33.5, long: -70.75 })],
    });

    const origen = await obtenerOrigenRutaDelCourier(cliente, TENANT_A);

    expect(origen).toEqual({ id: "b-1", nombre: "Galpón Maipú", lat: -33.5, long: -70.75 });
  });
});

// =============================================================================
// 2. calcularYAplicarRutaManifiesto — errores de dominio
// =============================================================================

describe("calcularYAplicarRutaManifiesto — errores de dominio", () => {
  it("manifiesto inexistente (o de otro tenant) → ErrorManifiestoNoEncontrado", async () => {
    const cliente = crearClienteFake({ manifiestos: [] });

    await expect(
      calcularYAplicarRutaManifiesto(cliente, {
        tenantId: TENANT_A,
        manifiestoId: MANIFIESTO_1,
        actorUsuarioId: ACTOR_1,
      }),
    ).rejects.toThrow(ErrorManifiestoNoEncontrado);
  });

  it("sin bodega de origen usable → ErrorSinBodegaOrigen, y NUNCA se llega a leer el ancla del conductor", async () => {
    const cliente = crearClienteFake({
      manifiestos: [manifiestoFila(DRIVER_CON_ANCLA)],
      courierBodegas: [], // sin ninguna bodega usable
      asignacionesPedido: [asignacionFila(PEDIDO_1, { lat: -33.4, long: -70.6 })],
    });

    await expect(
      calcularYAplicarRutaManifiesto(cliente, {
        tenantId: TENANT_A,
        manifiestoId: MANIFIESTO_1,
        actorUsuarioId: ACTOR_1,
      }),
    ).rejects.toThrow(ErrorSinBodegaOrigen);

    // El error de bodega (visible para CUALQUIER coordinador) no puede depender
    // de si este conductor definió su punto de término: el ancla ni se lee.
    expect(obtenerAnclaFinRuta).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 3. La prueba de privacidad — §6.3 punto 9 del documento de seguridad
// =============================================================================

describe("calcularYAplicarRutaManifiesto — privacidad del punto de término (§6.3 punto 9)", () => {
  // Geometría deliberada: UNA sola parada. Con un solo punto a visitar no hay
  // NADA que el optimizador pueda reordenar (no existe una permutación
  // alternativa), así que `distanciaTotalM` tiene que ser IDÉNTICO exista o no
  // ancla — la instrucción explícita de la tarea es elegir una geometría así
  // para que la aserción de igualdad sea limpia, sin el matiz legítimo de
  // `motor.test.ts` (el ancla SÍ puede cambiar el ORDEN elegido, y por lo
  // tanto el total, cuando hay más de una parada — ver la cabecera de
  // `ruteo/motor.ts`).
  const origen = { lat: -33.45, long: -70.66 };
  const parada = { lat: -33.4, long: -70.6 };

  // Coordenada del ancla deliberadamente MUY lejana y con muchos decimales
  // distintivos: si se colara en cualquier cifra de la salida (aunque fuera
  // sumada o combinada de forma no obvia), el valor exacto de sus componentes
  // no podría aparecer por azar.
  const ANCLA = { lat: -19.123456, long: -52.654321 };

  function mockearAncla() {
    vi.mocked(obtenerAnclaFinRuta).mockImplementation(async (_c, _t, conductorId) => {
      if (conductorId === DRIVER_CON_ANCLA) return { lat: ANCLA.lat, long: ANCLA.long };
      if (conductorId === DRIVER_SIN_ANCLA) return null;
      throw new Error(`obtenerAnclaFinRuta llamado con un conductor inesperado: ${conductorId}`);
    });
  }

  function mockearRpc() {
    // El envoltorio de escritura no es lo que esta prueba audita (eso lo cubre
    // secuencia-paradas-rpc.test.ts): se fija un resultado estable para que la
    // comparación entre los dos conductores no dependa de él.
    vi.mocked(aplicarSecuenciaParadasRpc).mockResolvedValue({
      totalParadas: 1,
      totalSinSecuencia: 0,
      totalPreviasLimpiadas: 0,
    });
  }

  it("mismas claves, mismo distanciaTotalM, y ningún número de la salida coincide con la coordenada del ancla", async () => {
    mockearAncla();
    mockearRpc();

    const clienteConAncla = crearClienteFake({
      manifiestos: [manifiestoFila(DRIVER_CON_ANCLA)],
      courierBodegas: [bodegaFila({ lat: origen.lat, long: origen.long })],
      asignacionesPedido: [asignacionFila(PEDIDO_1, parada)],
    });
    const resultadoConAncla = await calcularYAplicarRutaManifiesto(clienteConAncla, {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      actorUsuarioId: ACTOR_1,
    });

    const clienteSinAncla = crearClienteFake({
      manifiestos: [manifiestoFila(DRIVER_SIN_ANCLA, { id: MANIFIESTO_2 })],
      courierBodegas: [bodegaFila({ lat: origen.lat, long: origen.long })],
      asignacionesPedido: [
        asignacionFila(PEDIDO_1, parada, { manifiesto_id: MANIFIESTO_2 }),
      ],
    });
    const resultadoSinAncla = await calcularYAplicarRutaManifiesto(clienteSinAncla, {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_2,
      actorUsuarioId: ACTOR_1,
    });

    // Confirma que la prueba de verdad ejercitó los dos caminos (uno CON ancla
    // leída, otro SIN ella) antes de comparar nada.
    expect(obtenerAnclaFinRuta).toHaveBeenCalledWith(clienteConAncla, TENANT_A, DRIVER_CON_ANCLA);
    expect(obtenerAnclaFinRuta).toHaveBeenCalledWith(clienteSinAncla, TENANT_A, DRIVER_SIN_ANCLA);

    // 1. Las mismas claves.
    expect(Object.keys(resultadoConAncla).sort()).toEqual(Object.keys(resultadoSinAncla).sort());

    // 2. En ningún punto del objeto serializado aparece un número igual a la
    //    coordenada del ancla.
    const serializado = JSON.stringify(resultadoConAncla);
    expect(serializado).not.toContain(String(ANCLA.lat));
    expect(serializado).not.toContain(String(ANCLA.long));

    // 3. distanciaTotalM NUNCA incluye un tramo hacia el ancla — con una sola
    //    parada, no hay nada que reordenar, así que el número tiene que ser
    //    EXACTAMENTE igual con y sin ancla.
    expect(resultadoConAncla.distanciaTotalM).toBe(resultadoSinAncla.distanciaTotalM);
  });

  it("los dos escenarios pasan la MISMA lista de pedidos en el MISMO orden al RPC (el ancla no reordena con una sola parada)", async () => {
    mockearAncla();
    mockearRpc();

    const clienteConAncla = crearClienteFake({
      manifiestos: [manifiestoFila(DRIVER_CON_ANCLA)],
      courierBodegas: [bodegaFila({ lat: origen.lat, long: origen.long })],
      asignacionesPedido: [
        asignacionFila(PEDIDO_1, parada),
        asignacionFila(PEDIDO_2, { lat: -33.42, long: -70.62 }),
      ],
    });

    await calcularYAplicarRutaManifiesto(clienteConAncla, {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      actorUsuarioId: ACTOR_1,
    });

    const llamada = vi.mocked(aplicarSecuenciaParadasRpc).mock.calls[0][1];
    expect(llamada.origen).toBe("motor");
    expect(new Set(llamada.pedidoIdsEnOrden)).toEqual(new Set([PEDIDO_1, PEDIDO_2]));
  });
});

// =============================================================================
// 4. El ancla corrupta no puede delatar a nadie
// =============================================================================

describe("calcularYAplicarRutaManifiesto — un ancla corrupta se descarta en silencio", () => {
  function clienteBase() {
    return crearClienteFake({
      manifiestos: [manifiestoFila(DRIVER_CON_ANCLA)],
      courierBodegas: [bodegaFila()],
      asignacionesPedido: [asignacionFila(PEDIDO_1, { lat: -33.4, long: -70.6 })],
    });
  }

  beforeEach(() => {
    vi.mocked(aplicarSecuenciaParadasRpc).mockResolvedValue({
      totalParadas: 1,
      totalSinSecuencia: 0,
      totalPreviasLimpiadas: 0,
    });
  });

  it("ancla con lat NaN → NO lanza, la ruta se calcula como si no hubiera ancla", async () => {
    vi.mocked(obtenerAnclaFinRuta).mockResolvedValue({ lat: NaN, long: -70.6 });

    const resultado = await calcularYAplicarRutaManifiesto(clienteBase(), {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      actorUsuarioId: ACTOR_1,
    });

    expect(resultado.totalParadas).toBe(1);
  });

  it("ancla fuera del rango físico (lat > 90) → NO lanza", async () => {
    vi.mocked(obtenerAnclaFinRuta).mockResolvedValue({ lat: 999, long: -70.6 });

    const resultado = await calcularYAplicarRutaManifiesto(clienteBase(), {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      actorUsuarioId: ACTOR_1,
    });

    expect(resultado.totalParadas).toBe(1);
  });

  it("un conductor SIN ancla en absoluto (null) también rutea normal — caso de control", async () => {
    vi.mocked(obtenerAnclaFinRuta).mockResolvedValue(null);

    const resultado = await calcularYAplicarRutaManifiesto(clienteBase(), {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      actorUsuarioId: ACTOR_1,
    });

    expect(resultado.totalParadas).toBe(1);
  });
});
