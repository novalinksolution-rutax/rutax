/**
 * Pruebas de la lectura del lado COURIER de Preparación del día
 * (`listarVisitasDelDia`, `obtenerCargaPorComuna`).
 *
 * El doble de Supabase LANZA ante un esquema o un nombre de RPC que no
 * esperaba — nunca devuelve vacío en silencio — para que una regresión (p.
 * ej. perder el `.schema("operacion")`, o llamar al RPC equivocado) tumbe la
 * prueba en vez de pasar con datos vacíos. Mismo criterio que
 * `./rpc.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { listarVisitasDelDia, obtenerCargaPorComuna } from "./preparacion";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const FECHA = "2026-08-14";

const SESION_1 = "30000000-0000-0000-0000-000000000001";
const SESION_2 = "30000000-0000-0000-0000-000000000002";
const BODEGA_1 = "70000000-0000-0000-0000-000000000001";
const SELLER_1 = "60000000-0000-0000-0000-000000000001";
const CONDUCTOR_1 = "20000000-0000-0000-0000-000000000001";

function crearClienteRpc(rpcEsperado: string, respuesta: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn((fn: string) => {
    if (fn !== rpcEsperado) {
      throw new Error(`RPC inesperado en el doble: '${fn}' (se esperaba '${rpcEsperado}')`);
    }
    return Promise.resolve(respuesta);
  });
  const schema = vi.fn((esquema: string) => {
    if (esquema !== "operacion") {
      throw new Error(`Esquema inesperado en el doble: '${esquema}' (se esperaba 'operacion')`);
    }
    return { rpc };
  });
  return { cliente: { schema } as never, schema, rpc };
}

// =============================================================================
// listarVisitasDelDia
// =============================================================================

const FILA_VISITA_BASE = {
  sesion_id: SESION_1,
  estado: "abierta" as const,
  abierta_en: "2026-08-14T13:00:00.000Z",
  cerrada_en: null,
  bodega_id: BODEGA_1,
  bodega_nombre: "Bodega Quilicura",
  bodega_comuna: "Quilicura",
  seller_id: SELLER_1,
  seller_nombre: "Tienda Uno SpA",
  conductor_id: CONDUCTOR_1,
  conductor_nombre: "Juan Pérez",
  bultos_vivos: 0,
  bultos_resueltos_vivos: 0,
  bultos_sin_resolver_vivos: 0,
  bultos_de_otro_seller: 0,
  ultimo_escaneo_en: null,
  acta_total: null,
  acta_resueltos: null,
  acta_sin_resolver: null,
};

describe("listarVisitasDelDia", () => {
  it("llama a operacion.preparacion_visitas_del_dia con los p_ exactos y convierte a number los bigint que llegan como string", async () => {
    const filaSql = {
      ...FILA_VISITA_BASE,
      bultos_vivos: "12",
      bultos_resueltos_vivos: "10",
      bultos_sin_resolver_vivos: "2",
      bultos_de_otro_seller: "1",
      ultimo_escaneo_en: "2026-08-14T13:05:00.000Z",
    };
    const { cliente, schema, rpc } = crearClienteRpc("preparacion_visitas_del_dia", {
      data: [filaSql],
      error: null,
    });

    const resultado = await listarVisitasDelDia(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(schema).toHaveBeenCalledWith("operacion");
    expect(rpc).toHaveBeenCalledWith("preparacion_visitas_del_dia", {
      p_tenant_id: TENANT_A,
      p_fecha: FECHA,
    });
    expect(resultado).toHaveLength(1);
    // toEqual ya es sensible al tipo ("12" !== 12), pero se deja también el
    // typeof explícito porque es justo lo que esta prueba existe para vigilar.
    expect(resultado[0].vivos).toEqual({ total: 12, resueltos: 10, sinResolver: 2 });
    expect(resultado[0].bultosDeOtroSeller).toBe(1);
    expect(typeof resultado[0].vivos.total).toBe("number");
    expect(typeof resultado[0].vivos.resueltos).toBe("number");
    expect(typeof resultado[0].vivos.sinResolver).toBe("number");
    expect(typeof resultado[0].bultosDeOtroSeller).toBe("number");
  });

  it("acta es null con la visita abierta (no un objeto de ceros) y viene poblada al cerrarla", async () => {
    const abierta = { ...FILA_VISITA_BASE, sesion_id: SESION_1, estado: "abierta" as const };
    const cerrada = {
      ...FILA_VISITA_BASE,
      sesion_id: SESION_2,
      estado: "cerrada" as const,
      cerrada_en: "2026-08-14T13:10:00.000Z",
      acta_total: 40,
      acta_resueltos: 38,
      acta_sin_resolver: 2,
    };
    const { cliente } = crearClienteRpc("preparacion_visitas_del_dia", {
      data: [abierta, cerrada],
      error: null,
    });

    const resultado = await listarVisitasDelDia(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(resultado[0].estado).toBe("abierta");
    expect(resultado[0].acta).toBeNull();
    expect(resultado[1].estado).toBe("cerrada");
    expect(resultado[1].acta).toEqual({ total: 40, resueltos: 38, sinResolver: 2 });
  });

  it("propaga el error del RPC con mensaje propio, en vez de devolver una lista vacía silenciosa", async () => {
    const { cliente } = crearClienteRpc("preparacion_visitas_del_dia", {
      data: null,
      error: { message: "la conexión con la base se cayó" },
    });

    await expect(listarVisitasDelDia(cliente, { tenantId: TENANT_A, fecha: FECHA })).rejects.toThrow(
      /Error al listar las visitas de la Preparación del día.*la conexión con la base se cayó/,
    );
  });
});

// =============================================================================
// obtenerCargaPorComuna
// =============================================================================

describe("obtenerCargaPorComuna", () => {
  it("llama a operacion.preparacion_carga_por_comuna con los p_ exactos, convierte bigint (string) y funde comunas que solo difieren en el acento", async () => {
    const filas = [
      {
        comuna_clave: "maipú",
        comuna_etiqueta: "Maipú",
        bultos_total: "22",
        bultos_asignados: "10",
        bultos_sin_resolver: "1",
      },
      {
        comuna_clave: "maipu",
        comuna_etiqueta: "Maipu",
        bultos_total: "18",
        bultos_asignados: "5",
        bultos_sin_resolver: "0",
      },
    ];
    const { cliente, schema, rpc } = crearClienteRpc("preparacion_carga_por_comuna", { data: filas, error: null });

    const resultado = await obtenerCargaPorComuna(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(schema).toHaveBeenCalledWith("operacion");
    expect(rpc).toHaveBeenCalledWith("preparacion_carga_por_comuna", {
      p_tenant_id: TENANT_A,
      p_fecha: FECHA,
    });
    // Una sola fila resultante, con la etiqueta CANÓNICA del catálogo y los
    // tres contadores SUMADOS (22+18, 10+5, 1+0) — no dos filas separadas.
    expect(resultado).toEqual([{ comuna: "Maipú", bultosTotal: 40, bultosAsignados: 15, bultosSinResolver: 1 }]);
  });

  it("una comuna fuera de la RM sobrevive con su etiqueta cruda, sin caer al grupo 'sin comuna'", async () => {
    const filas = [
      {
        comuna_clave: "concepcion",
        comuna_etiqueta: "Concepción",
        bultos_total: "5",
        bultos_asignados: "2",
        bultos_sin_resolver: "0",
      },
    ];
    const { cliente } = crearClienteRpc("preparacion_carga_por_comuna", { data: filas, error: null });

    const resultado = await obtenerCargaPorComuna(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(resultado).toEqual([{ comuna: "Concepción", bultosTotal: 5, bultosAsignados: 2, bultosSinResolver: 0 }]);
  });

  it("la fila de comuna_clave nula va SIEMPRE al final, aunque tenga más bultos que cualquier comuna real", async () => {
    const filas = [
      {
        comuna_clave: "nunoa",
        comuna_etiqueta: "Nunoa",
        bultos_total: "5",
        bultos_asignados: "1",
        bultos_sin_resolver: "0",
      },
      {
        comuna_clave: null,
        comuna_etiqueta: null,
        bultos_total: "999",
        bultos_asignados: "0",
        bultos_sin_resolver: "999",
      },
    ];
    const { cliente } = crearClienteRpc("preparacion_carga_por_comuna", { data: filas, error: null });

    const resultado = await obtenerCargaPorComuna(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(resultado).toHaveLength(2);
    expect(resultado[0].comuna).not.toBeNull();
    expect(resultado[resultado.length - 1]).toEqual({
      comuna: null,
      bultosTotal: 999,
      bultosAsignados: 0,
      bultosSinResolver: 999,
    });
  });

  it("el resto (sin la fila nula) queda ordenado por bultosTotal descendente", async () => {
    const filas = [
      {
        comuna_clave: "la florida",
        comuna_etiqueta: "La Florida",
        bultos_total: "10",
        bultos_asignados: "0",
        bultos_sin_resolver: "0",
      },
      {
        comuna_clave: "puente alto",
        comuna_etiqueta: "Puente Alto",
        bultos_total: "30",
        bultos_asignados: "0",
        bultos_sin_resolver: "0",
      },
      {
        comuna_clave: "maipu",
        comuna_etiqueta: "Maipu",
        bultos_total: "20",
        bultos_asignados: "0",
        bultos_sin_resolver: "0",
      },
    ];
    const { cliente } = crearClienteRpc("preparacion_carga_por_comuna", { data: filas, error: null });

    const resultado = await obtenerCargaPorComuna(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(resultado.map((r) => r.comuna)).toEqual(["Puente Alto", "Maipú", "La Florida"]);
  });

  it("propaga el error del RPC con mensaje propio, en vez de devolver una lista vacía silenciosa", async () => {
    const { cliente } = crearClienteRpc("preparacion_carga_por_comuna", {
      data: null,
      error: { message: "la función no existe" },
    });

    await expect(obtenerCargaPorComuna(cliente, { tenantId: TENANT_A, fecha: FECHA })).rejects.toThrow(
      /Error al obtener la carga por comuna de la Preparación del día.*la función no existe/,
    );
  });
});
