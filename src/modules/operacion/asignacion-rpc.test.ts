/**
 * Pruebas del envoltorio de `operacion.asignar_pedidos_en_bloque` — el lado
 * de escritura de la asignación en bloque (etapa 6). Foco explícito, por
 * encargo:
 *   1. El RPC se apunta SIEMPRE a `.schema('operacion')` con los `p_*`
 *      EXACTOS — un conductor equivocado en la llamada sería asignarle
 *      paquetes a quien no era.
 *   2. El mapeo de cada motivo de omisión SQL → dominio, incluida una prueba
 *      que ata la lista de motivos del SQL (copiada, no derivada) contra la
 *      tabla de traducción de `asignacion-rpc.ts` — el patrón de "dos mitades
 *      de una verdad que se separan en silencio" que ya mordió en este repo
 *      con el CHECK de `dinero.eventos_conciliacion.tipo_diferencia`
 *      (CLAUDE.md, "Un CHECK de lista se repone ENTERO").
 *   3. Los `integer` de Postgres normalizados con `Number()` aunque lleguen
 *      como string.
 *   4. `omitidos_detalle` vacío/nulo no revienta.
 *   5. Los tres errores previstos del SQL (22023, P0002, 23503) se traducen
 *      a mensajes de dominio — y P0002 se mantiene DELIBERADAMENTE ambiguo
 *      (conductor inexistente vs. ajeno son indistinguibles en el SQL).
 *
 * El doble de Supabase LANZA ante cualquier esquema, tabla o función RPC que
 * no sea exactamente la esperada — nunca devuelve algo vacío en silencio.
 */
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  asignarPedidosEnBloqueRpc,
  MOTIVOS_OMISION_SQL_A_DOMINIO,
  type MotivoOmision,
} from "./asignacion-rpc";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const CONDUCTOR_1 = "20000000-0000-0000-0000-000000000001";
const CONDUCTOR_2 = "20000000-0000-0000-0000-000000000002";
const ACTOR_1 = "30000000-0000-0000-0000-000000000001";
const MANIFIESTO_1 = "40000000-0000-0000-0000-000000000001";
const PEDIDO_1 = "50000000-0000-0000-0000-000000000001";
const PEDIDO_2 = "50000000-0000-0000-0000-000000000002";
const PEDIDO_3 = "50000000-0000-0000-0000-000000000003";
const PEDIDO_4 = "50000000-0000-0000-0000-000000000004";
const PEDIDO_5 = "50000000-0000-0000-0000-000000000005";

type RespuestaRpc = { data: unknown; error: { message: string; code?: string } | null };

/**
 * Doble estricto: lanza ante CUALQUIER esquema, tabla o función RPC que no
 * sea exactamente la esperada. Cubre tres formas de invocación incorrecta:
 *   - `.schema(x)` con `x !== 'operacion'`.
 *   - `.schema('operacion').from(...)` — este envoltorio solo debe usar `.rpc()`.
 *   - `.schema('operacion').rpc(x)` con `x !== 'asignar_pedidos_en_bloque'`.
 *   - `.rpc(...)` en la raíz del cliente, SIN `.schema('operacion')` antes
 *     (el gotcha documentado en `retiro/rpc.ts`: PostgREST buscaría
 *     `public.asignar_pedidos_en_bloque`, no la encontraría, y fallaría en
 *     silencio si el llamador no revisara el error).
 */
function crearClienteRpc(respuesta: RespuestaRpc) {
  const rpc = vi.fn((nombreFn: string, params?: Record<string, unknown>) => {
    void params;
    if (nombreFn !== "asignar_pedidos_en_bloque") {
      throw new Error(`RPC inesperado: ${nombreFn}`);
    }
    return Promise.resolve(respuesta);
  });
  const from = vi.fn((tabla: string) => {
    throw new Error(`.from() inesperado (tabla: ${tabla}) — este envoltorio solo debe llamar .rpc()`);
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
  return { cliente: { schema, from, rpc: rpcSinEsquema } as never, schema, rpc, from };
}

function filaSql(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    manifiesto_id: MANIFIESTO_1,
    manifiesto_creado: true,
    total_solicitados: 3,
    total_asignados: 3,
    total_reasignados: 0,
    total_omitidos: 0,
    omitidos_no_retirado: 0,
    omitidos_estado_no_asignable: 0,
    omitidos_ya_en_manifiesto: 0,
    omitidos_ajenos: 0,
    omitidos_detalle: [],
    ...overrides,
  };
}

function entradaBase(overrides: Partial<Parameters<typeof asignarPedidosEnBloqueRpc>[1]> = {}) {
  return {
    tenantId: TENANT_A,
    conductorId: CONDUCTOR_1,
    fecha: "2026-08-14",
    pedidoIds: [PEDIDO_1],
    actorUsuarioId: ACTOR_1,
    ...overrides,
  };
}

describe("asignarPedidosEnBloqueRpc — llamada exacta", () => {
  it("llama a operacion.asignar_pedidos_en_bloque con los p_ EXACTOS", async () => {
    const { cliente, schema, rpc } = crearClienteRpc({ data: [filaSql()], error: null });

    await asignarPedidosEnBloqueRpc(
      cliente,
      entradaBase({ pedidoIds: [PEDIDO_1, PEDIDO_2, PEDIDO_3] }),
    );

    expect(schema).toHaveBeenCalledWith("operacion");
    expect(rpc).toHaveBeenCalledWith("asignar_pedidos_en_bloque", {
      p_tenant_id: TENANT_A,
      p_conductor_id: CONDUCTOR_1,
      p_fecha: "2026-08-14",
      p_pedido_ids: [PEDIDO_1, PEDIDO_2, PEDIDO_3],
      p_actor_usuario_id: ACTOR_1,
    });
  });

  it("un conductor DISTINTO en la entrada viaja como ESE conductor exacto en el RPC — nunca otro", async () => {
    const { cliente, rpc } = crearClienteRpc({ data: [filaSql()], error: null });

    await asignarPedidosEnBloqueRpc(cliente, entradaBase({ conductorId: CONDUCTOR_2 }));

    expect(rpc).toHaveBeenCalledTimes(1);
    const params = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params.p_conductor_id).toBe(CONDUCTOR_2);
    expect(params.p_conductor_id).not.toBe(CONDUCTOR_1);
  });

  it("traduce la fila completa al contrato TypeScript", async () => {
    const { cliente } = crearClienteRpc({
      data: [filaSql({ manifiesto_creado: false, total_reasignados: 1 })],
      error: null,
    });

    const resultado = await asignarPedidosEnBloqueRpc(cliente, entradaBase());

    expect(resultado).toEqual({
      manifiestoId: MANIFIESTO_1,
      manifiestoCreado: false,
      totalSolicitados: 3,
      totalAsignados: 3,
      totalReasignados: 1,
      totalOmitidos: 0,
      omitidos: [],
    });
  });

  it("acepta que el RPC devuelva un objeto suelto (no array) — defensivo", async () => {
    const { cliente } = crearClienteRpc({ data: filaSql(), error: null });

    const resultado = await asignarPedidosEnBloqueRpc(cliente, entradaBase());

    expect(resultado.manifiestoId).toBe(MANIFIESTO_1);
  });

  it("lanza si el RPC no devuelve ninguna fila", async () => {
    const { cliente } = crearClienteRpc({ data: [], error: null });

    await expect(asignarPedidosEnBloqueRpc(cliente, entradaBase())).rejects.toThrow(
      /no devolvió ninguna fila/,
    );
  });
});

describe("asignarPedidosEnBloqueRpc — integer que llegan como string", () => {
  it("normaliza los cuatro totales con Number() aunque lleguen como string", async () => {
    const { cliente } = crearClienteRpc({
      data: [
        filaSql({
          total_solicitados: "30",
          total_asignados: "28",
          total_reasignados: "5",
          total_omitidos: "2",
        }),
      ],
      error: null,
    });

    const resultado = await asignarPedidosEnBloqueRpc(cliente, entradaBase());

    expect(resultado.totalSolicitados).toBe(30);
    expect(resultado.totalAsignados).toBe(28);
    expect(resultado.totalReasignados).toBe(5);
    expect(resultado.totalOmitidos).toBe(2);
    expect(typeof resultado.totalSolicitados).toBe("number");
    expect(typeof resultado.totalAsignados).toBe("number");
    expect(typeof resultado.totalReasignados).toBe("number");
    expect(typeof resultado.totalOmitidos).toBe("number");
  });
});

describe("asignarPedidosEnBloqueRpc — omitidos_detalle", () => {
  it("mapea cada uno de los cuatro motivos SQL al MotivoOmision del contrato", async () => {
    const { cliente } = crearClienteRpc({
      data: [
        filaSql({
          total_omitidos: 4,
          omitidos_detalle: [
            { pedido_id: PEDIDO_1, motivo: "ajeno" },
            { pedido_id: PEDIDO_2, motivo: "no_retirado" },
            { pedido_id: PEDIDO_3, motivo: "estado_no_asignable" },
            { pedido_id: PEDIDO_4, motivo: "ya_en_manifiesto" },
          ],
        }),
      ],
      error: null,
    });

    const resultado = await asignarPedidosEnBloqueRpc(
      cliente,
      entradaBase({ pedidoIds: [PEDIDO_1, PEDIDO_2, PEDIDO_3, PEDIDO_4, PEDIDO_5] }),
    );

    expect(resultado.omitidos).toEqual([
      { pedidoId: PEDIDO_1, motivo: "ajeno" },
      { pedidoId: PEDIDO_2, motivo: "no_retirado" },
      { pedidoId: PEDIDO_3, motivo: "estado_no_asignable" },
      // ⚠️ ESTE es el par que no coincide letra por letra con el SQL:
      // 'ya_en_manifiesto' (SQL) → 'ya_estaba_en_manifiesto' (dominio).
      { pedidoId: PEDIDO_4, motivo: "ya_estaba_en_manifiesto" },
    ]);
  });

  it("omitidos_detalle == [] no revienta", async () => {
    const { cliente } = crearClienteRpc({ data: [filaSql({ omitidos_detalle: [] })], error: null });

    const resultado = await asignarPedidosEnBloqueRpc(cliente, entradaBase());

    expect(resultado.omitidos).toEqual([]);
  });

  it("omitidos_detalle == null no revienta (defensivo — el SQL nunca lo manda así)", async () => {
    const { cliente } = crearClienteRpc({ data: [filaSql({ omitidos_detalle: null })], error: null });

    const resultado = await asignarPedidosEnBloqueRpc(cliente, entradaBase());

    expect(resultado.omitidos).toEqual([]);
  });

  it("lanza si el SQL emite un motivo que la tabla de traducción no reconoce", async () => {
    const { cliente } = crearClienteRpc({
      data: [
        filaSql({
          omitidos_detalle: [{ pedido_id: PEDIDO_1, motivo: "motivo_inventado_que_no_existe" }],
        }),
      ],
      error: null,
    });

    await expect(asignarPedidosEnBloqueRpc(cliente, entradaBase())).rejects.toThrow(
      /motivo de omisión desconocido/,
    );
  });
});

describe("asignarPedidosEnBloqueRpc — traducción de errores previstos del SQL", () => {
  it("22023 (lote vacío o parámetros nulos) se traduce a un mensaje de dominio", async () => {
    const { cliente } = crearClienteRpc({
      data: null,
      error: { message: "p_pedido_ids llegó vacío (o solo con nulos)", code: "22023" },
    });

    await expect(
      asignarPedidosEnBloqueRpc(cliente, entradaBase({ pedidoIds: [] })),
    ).rejects.toThrow(/No se recibió ningún pedido válido/);
  });

  it("P0002 (conductor inexistente) se traduce a un mensaje de dominio genérico", async () => {
    const { cliente } = crearClienteRpc({
      data: null,
      error: { message: `el conductor ${CONDUCTOR_1} no existe en el tenant ${TENANT_A}`, code: "P0002" },
    });

    await expect(asignarPedidosEnBloqueRpc(cliente, entradaBase())).rejects.toThrow(
      "El conductor no existe o no pertenece a tu equipo.",
    );
  });

  it("P0002 de un conductor AJENO produce el mensaje IDÉNTICO al de uno inexistente — no lo separes", async () => {
    const { cliente: clienteInexistente } = crearClienteRpc({
      data: null,
      error: { message: "el conductor X no existe en el tenant Y", code: "P0002" },
    });
    const { cliente: clienteAjeno } = crearClienteRpc({
      data: null,
      error: { message: "el conductor X pertenece al tenant Z, no a Y", code: "P0002" },
    });

    let mensajeInexistente = "";
    let mensajeAjeno = "";
    try {
      await asignarPedidosEnBloqueRpc(clienteInexistente, entradaBase());
    } catch (err) {
      mensajeInexistente = err instanceof Error ? err.message : "";
    }
    try {
      await asignarPedidosEnBloqueRpc(clienteAjeno, entradaBase());
    } catch (err) {
      mensajeAjeno = err instanceof Error ? err.message : "";
    }

    expect(mensajeInexistente).not.toBe("");
    expect(mensajeInexistente).toBe(mensajeAjeno);
  });

  it("23503 (actor inexistente) se traduce a un mensaje de dominio", async () => {
    const { cliente } = crearClienteRpc({
      data: null,
      error: {
        message: 'insert or update on table "asignaciones_pedido" violates foreign key constraint',
        code: "23503",
      },
    });

    await expect(asignarPedidosEnBloqueRpc(cliente, entradaBase())).rejects.toThrow(
      "El usuario que ejecuta la asignación no es válido.",
    );
  });

  it("un código no previsto cae al mensaje genérico con el detalle de Postgres, sin perderlo", async () => {
    const { cliente } = crearClienteRpc({
      data: null,
      error: { message: "la clasificación no cuadra (30 solicitados, 29 a escribir, 0 omitidos)", code: "P0001" },
    });

    await expect(asignarPedidosEnBloqueRpc(cliente, entradaBase())).rejects.toThrow(
      /la clasificación no cuadra/,
    );
  });

  it("un error sin código (falla de red/infraestructura) también cae al mensaje genérico", async () => {
    const { cliente } = crearClienteRpc({
      data: null,
      error: { message: "fetch failed" },
    });

    await expect(asignarPedidosEnBloqueRpc(cliente, entradaBase())).rejects.toThrow(/fetch failed/);
  });
});

// =============================================================================
// La prueba que ata las dos listas
// =============================================================================
//
// Copiada del filtro final de `omitidos_detalle` en
// supabase/migrations/20260814000001_operacion_asignacion_en_bloque.sql
// (§1, paso (5)): `where cl.motivo in ('ajeno', 'no_retirado',
// 'estado_no_asignable', 'ya_en_manifiesto')`. A PROPÓSITO no se deriva de
// `MOTIVOS_OMISION_SQL_A_DOMINIO` — si se derivara de la misma tabla que
// prueba, un editor podría borrar una entrada de las dos mitades a la vez y
// esta prueba seguiría en verde. Igual que el CHECK de
// `dinero.eventos_conciliacion.tipo_diferencia` (CLAUDE.md): la copia
// independiente es la única defensa real contra el drift silencioso.
const MOTIVOS_SQL_DE_LA_MIGRACION = [
  "ajeno",
  "no_retirado",
  "estado_no_asignable",
  "ya_en_manifiesto",
] as const;

// Los cuatro valores del union `MotivoOmision`, escritos a mano — NO
// `Object.values(MOTIVOS_OMISION_SQL_A_DOMINIO)`, por la misma razón de arriba.
const MOTIVOS_DOMINIO_DEL_CONTRATO: readonly MotivoOmision[] = [
  "no_retirado",
  "estado_no_asignable",
  "ya_estaba_en_manifiesto",
  "ajeno",
];

describe("MOTIVOS_OMISION_SQL_A_DOMINIO — ata la lista del SQL con la del contrato TypeScript", () => {
  it("tiene EXACTAMENTE una clave por cada motivo que el SQL puede emitir en omitidos_detalle", () => {
    expect(new Set(Object.keys(MOTIVOS_OMISION_SQL_A_DOMINIO))).toEqual(
      new Set(MOTIVOS_SQL_DE_LA_MIGRACION),
    );
  });

  it("cubre EXACTAMENTE los cuatro valores de MotivoOmision — ninguno de más, ninguno de menos", () => {
    expect(new Set(Object.values(MOTIVOS_OMISION_SQL_A_DOMINIO))).toEqual(
      new Set(MOTIVOS_DOMINIO_DEL_CONTRATO),
    );
  });

  it("cada clave del SQL mapea a un valor distinto (sin colisiones que fusionen dos motivos en uno)", () => {
    const valores = Object.values(MOTIVOS_OMISION_SQL_A_DOMINIO);
    expect(new Set(valores).size).toBe(valores.length);
  });
});
