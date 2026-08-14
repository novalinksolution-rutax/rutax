/**
 * Pruebas del envoltorio de `operacion.aplicar_secuencia_paradas` — el lado de
 * escritura de la secuencia de paradas (etapa 7).
 *
 * Foco:
 *   1. El RPC va SIEMPRE a `.schema('operacion')` con los `p_*` EXACTOS y con la
 *      lista EN EL ORDEN recibido — la posición es el orden, así que una lista
 *      reordenada por el camino sería una ruta distinta.
 *   2. `pedidoIdsDesdeSecuencia` ordena por `orden` y no confía en la posición
 *      del arreglo que devuelve el motor.
 *   3. Los cinco errores previstos del SQL se traducen a mensajes de dominio —
 *      y P0002 se mantiene DELIBERADAMENTE ambiguo (manifiesto inexistente vs.
 *      ajeno son indistinguibles en el SQL, para no confirmar la existencia de
 *      datos de otro courier).
 *   4. Los `integer` de Postgres normalizados con `Number()` aunque lleguen como
 *      string.
 *   5. Los dos valores de `origen` coinciden con la lista cerrada del SQL —
 *      copiada aquí a mano, no derivada del propio módulo, que es el único modo
 *      de que las dos mitades no se separen en silencio (el patrón que ya mordió
 *      con el CHECK de `dinero.eventos_conciliacion.tipo_diferencia`).
 *
 * El doble de Supabase LANZA ante cualquier esquema, tabla o función RPC que no
 * sea exactamente la esperada — nunca devuelve algo vacío en silencio.
 */
import { describe, expect, it, vi } from "vitest";
import {
  aplicarSecuenciaParadasRpc,
  pedidoIdsDesdeSecuencia,
  ORIGENES_SECUENCIA,
  type OrigenSecuencia,
} from "./secuencia-paradas-rpc";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const MANIFIESTO_1 = "40000000-0000-0000-0000-000000000001";
const ACTOR_1 = "30000000-0000-0000-0000-000000000001";
const PEDIDO_1 = "50000000-0000-0000-0000-000000000001";
const PEDIDO_2 = "50000000-0000-0000-0000-000000000002";
const PEDIDO_3 = "50000000-0000-0000-0000-000000000003";

type RespuestaRpc = { data: unknown; error: { message: string; code?: string } | null };

function crearClienteRpc(respuesta: RespuestaRpc) {
  const rpc = vi.fn((nombreFn: string, params?: Record<string, unknown>) => {
    void params;
    if (nombreFn !== "aplicar_secuencia_paradas") {
      throw new Error(`RPC inesperado: ${nombreFn}`);
    }
    return Promise.resolve(respuesta);
  });
  const from = vi.fn((tabla: string) => {
    throw new Error(
      `.from() inesperado (tabla: ${tabla}) — este envoltorio solo debe llamar .rpc()`,
    );
  });
  const rpcSinEsquema = vi.fn((nombreFn: string) => {
    throw new Error(
      `.rpc('${nombreFn}') llamado SIN .schema('operacion') antes — PostgREST buscaría ` +
        `public.${nombreFn}, no lo encontraría, y fallaría en silencio.`,
    );
  });
  const schema = vi.fn((esquema: string) => {
    if (esquema !== "operacion") throw new Error(`Esquema inesperado: ${esquema}`);
    return { rpc, from };
  });
  return { cliente: { schema, from, rpc: rpcSinEsquema } as never, schema, rpc };
}

function filaSql(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    total_paradas: 3,
    total_sin_secuencia: 0,
    total_previas_limpiadas: 0,
    ...overrides,
  };
}

describe("aplicarSecuenciaParadasRpc · la llamada", () => {
  it("llama a operacion.aplicar_secuencia_paradas con los p_* exactos", async () => {
    const { cliente, schema, rpc } = crearClienteRpc({ data: [filaSql()], error: null });

    await aplicarSecuenciaParadasRpc(cliente, {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      pedidoIdsEnOrden: [PEDIDO_1, PEDIDO_2, PEDIDO_3],
      origen: "motor",
      actorUsuarioId: ACTOR_1,
    });

    expect(schema).toHaveBeenCalledWith("operacion");
    expect(rpc).toHaveBeenCalledWith("aplicar_secuencia_paradas", {
      p_tenant_id: TENANT_A,
      p_manifiesto_id: MANIFIESTO_1,
      p_pedido_ids: [PEDIDO_1, PEDIDO_2, PEDIDO_3],
      p_origen: "motor",
      p_actor_usuario_id: ACTOR_1,
    });
  });

  it("manda la lista EN EL ORDEN recibido — la posición es el orden de la ruta", async () => {
    const { cliente, rpc } = crearClienteRpc({ data: [filaSql()], error: null });

    await aplicarSecuenciaParadasRpc(cliente, {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      pedidoIdsEnOrden: [PEDIDO_3, PEDIDO_1, PEDIDO_2],
      origen: "manual",
      actorUsuarioId: ACTOR_1,
    });

    expect(rpc.mock.calls[0]?.[1]?.p_pedido_ids).toEqual([PEDIDO_3, PEDIDO_1, PEDIDO_2]);
  });

  it("acepta actor nulo (job de service_role) sin inventar un usuario", async () => {
    const { cliente, rpc } = crearClienteRpc({ data: [filaSql()], error: null });

    await aplicarSecuenciaParadasRpc(cliente, {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      pedidoIdsEnOrden: [PEDIDO_1],
      origen: "motor",
      actorUsuarioId: null,
    });

    expect(rpc.mock.calls[0]?.[1]?.p_actor_usuario_id).toBeNull();
  });

  it("acepta una lista vacía (limpiar la secuencia es una operación legítima)", async () => {
    const { cliente, rpc } = crearClienteRpc({
      data: [filaSql({ total_paradas: 0, total_sin_secuencia: 4, total_previas_limpiadas: 4 })],
      error: null,
    });

    const resultado = await aplicarSecuenciaParadasRpc(cliente, {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      pedidoIdsEnOrden: [],
      origen: "manual",
      actorUsuarioId: ACTOR_1,
    });

    expect(rpc.mock.calls[0]?.[1]?.p_pedido_ids).toEqual([]);
    expect(resultado).toEqual({
      totalParadas: 0,
      totalSinSecuencia: 4,
      totalPreviasLimpiadas: 4,
    });
  });
});

describe("aplicarSecuenciaParadasRpc · la respuesta", () => {
  it("normaliza los integer que PostgREST puede devolver como string", async () => {
    const { cliente } = crearClienteRpc({
      data: [
        filaSql({
          total_paradas: "27",
          total_sin_secuencia: "3",
          total_previas_limpiadas: "30",
        }),
      ],
      error: null,
    });

    const resultado = await aplicarSecuenciaParadasRpc(cliente, {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      pedidoIdsEnOrden: [PEDIDO_1],
      origen: "motor",
      actorUsuarioId: ACTOR_1,
    });

    expect(resultado).toEqual({
      totalParadas: 27,
      totalSinSecuencia: 3,
      totalPreviasLimpiadas: 30,
    });
  });

  it("tolera que el RPC devuelva un escalar en vez de un arreglo", async () => {
    const { cliente } = crearClienteRpc({ data: filaSql({ total_paradas: 5 }), error: null });

    const resultado = await aplicarSecuenciaParadasRpc(cliente, {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      pedidoIdsEnOrden: [PEDIDO_1],
      origen: "motor",
      actorUsuarioId: ACTOR_1,
    });

    expect(resultado.totalParadas).toBe(5);
  });

  it("lanza si el RPC no devuelve ninguna fila (nunca finge éxito)", async () => {
    const { cliente } = crearClienteRpc({ data: [], error: null });

    await expect(
      aplicarSecuenciaParadasRpc(cliente, {
        tenantId: TENANT_A,
        manifiestoId: MANIFIESTO_1,
        pedidoIdsEnOrden: [PEDIDO_1],
        origen: "motor",
        actorUsuarioId: ACTOR_1,
      }),
    ).rejects.toThrow(/no devolvió ninguna fila/);
  });
});

/**
 * Devuelve el mensaje del Error con que se rechazó la promesa. Falla la prueba
 * si NO se rechazó: un envoltorio que devolviera un resultado donde debía lanzar
 * es exactamente el defecto que estas pruebas buscan.
 */
async function mensajeDelError(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("Se esperaba que la llamada lanzara, y devolvió un resultado.");
}

describe("aplicarSecuenciaParadasRpc · traducción de errores del SQL", () => {
  async function llamarConError(code: string | undefined, message = "boom") {
    const { cliente } = crearClienteRpc({ data: null, error: { code, message } });
    return aplicarSecuenciaParadasRpc(cliente, {
      tenantId: TENANT_A,
      manifiestoId: MANIFIESTO_1,
      pedidoIdsEnOrden: [PEDIDO_1],
      origen: "motor",
      actorUsuarioId: ACTOR_1,
    });
  }

  it("22023 → lista inválida (repetidos o incompletos)", async () => {
    await expect(llamarConError("22023")).rejects.toThrow(/no es válida/i);
  });

  it("P0002 → manifiesto inexistente O ajeno, en UN SOLO mensaje ambiguo", async () => {
    // La ambigüedad es deliberada: distinguir los dos casos confirmaría la
    // existencia de un manifiesto de otro courier. No separar este mensaje.
    await expect(llamarConError("P0002")).rejects.toThrow(
      /no existe o no pertenece a tu operación/i,
    );
  });

  it("55000 → manifiesto ya cerrado", async () => {
    await expect(llamarConError("55000")).rejects.toThrow(/cerrado/i);
  });

  it("P0001 → la lista cambió mientras se ordenaba: pide RECARGAR, no reintentar", async () => {
    const mensaje = await mensajeDelError(llamarConError("P0001"));
    expect(mensaje).toMatch(/vuelve a cargar/i);
    // Reintentar con la misma lista volvería a fallar igual, así que el mensaje
    // no debe sugerirlo.
    expect(mensaje).not.toMatch(/int[eé]ntalo de nuevo/i);
  });

  it("23503 → actor inválido", async () => {
    await expect(llamarConError("23503")).rejects.toThrow(/usuario que aplica la ruta/i);
  });

  it("un código desconocido no se traga: llega con su mensaje original", async () => {
    await expect(llamarConError("XX999", "detalle crudo")).rejects.toThrow(/detalle crudo/);
  });

  it("nunca deja salir el error crudo de PostgREST tal cual para los códigos previstos", async () => {
    const mensaje = await mensajeDelError(llamarConError("P0002", "manifiesto 123 del tenant abc"));
    expect(mensaje).not.toContain("abc");
  });
});

describe("pedidoIdsDesdeSecuencia", () => {
  it("ordena por `orden`, sin confiar en la posición del arreglo del motor", () => {
    // El motor promete el NÚMERO, no la posición. Apoyarse en la posición es
    // cómo se cuela un bug que solo aparece cuando alguien cambia el solver.
    expect(
      pedidoIdsDesdeSecuencia([
        { pedidoId: PEDIDO_3, orden: 3 },
        { pedidoId: PEDIDO_1, orden: 1 },
        { pedidoId: PEDIDO_2, orden: 2 },
      ]),
    ).toEqual([PEDIDO_1, PEDIDO_2, PEDIDO_3]);
  });

  it("no muta el arreglo recibido", () => {
    const secuencia = [
      { pedidoId: PEDIDO_2, orden: 2 },
      { pedidoId: PEDIDO_1, orden: 1 },
    ];
    const copia = [...secuencia];
    pedidoIdsDesdeSecuencia(secuencia);
    expect(secuencia).toEqual(copia);
  });

  it("una secuencia vacía da una lista vacía (todas las paradas quedaron sin ubicar)", () => {
    expect(pedidoIdsDesdeSecuencia([])).toEqual([]);
  });
});

describe("los dos orígenes coinciden con la lista cerrada del SQL", () => {
  it("ORIGENES_SECUENCIA es exactamente lo que acepta p_origen en la migración", () => {
    // Copiada A MANO de 20260814000004 §3, paso (1):
    //   `if p_origen is null or p_origen not in ('motor', 'manual')`
    // No se deriva del propio módulo a propósito: si alguien agrega un valor
    // aquí sin agregarlo allá, la llamada fallaría con 22023 y el mensaje no
    // diría por qué.
    const listaDelSql: OrigenSecuencia[] = ["motor", "manual"];
    expect([...ORIGENES_SECUENCIA].sort()).toEqual([...listaDelSql].sort());
  });
});
