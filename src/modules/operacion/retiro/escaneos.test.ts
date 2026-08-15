/**
 * Pruebas de `registrarLoteEscaneos`. El doble de `bultos_retiro` simula las
 * DOS unicidades reales de la tabla (tenant+escaneo_id, sesion+codigo) para
 * probar la fusión de duplicados sin tocar Postgres. `qr-credencial` e
 * `inngest` se mockean: ya tienen su propia cobertura (`qr-credencial.test.ts`)
 * y aquí solo importa que se LLAMEN con los argumentos correctos y que un
 * fallo suyo NUNCA tumbe el resultado del escaneo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("./qr-credencial", () => ({
  guardarCredencialQr: vi.fn().mockResolvedValue(undefined),
}));

import { inngest } from "@/lib/inngest/cliente";
import { guardarCredencialQr } from "./qr-credencial";
import { MAX_ESCANEOS_POR_LOTE, registrarLoteEscaneos, type EscaneoEntrada } from "./escaneos";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const CONDUCTOR_1 = "20000000-0000-0000-0000-000000000001";
const SESION_1 = "30000000-0000-0000-0000-000000000001";
const SELLER_1 = "60000000-0000-0000-0000-000000000001";
const SELLER_2 = "60000000-0000-0000-0000-000000000002";
const PEDIDO_1 = "40000000-0000-0000-0000-000000000001";

interface FilaFixture {
  [clave: string]: unknown;
}

/** Doble con estado real para `bultos_retiro`: simula las DOS unicidades de la tabla. */
function crearCliente(opts: {
  pedidos?: FilaFixture[];
  sellers?: FilaFixture[];
  bultosIniciales?: FilaFixture[];
  erroresInsertPorEscaneoId?: Record<string, { code?: string; message: string }>;
  /** Simula una excepción de infraestructura (no un `{error}` manejado) para este escaneo_id. */
  lanzarExcepcionParaEscaneoId?: string;
  /** Fuerza que `resolver_bulto_retiro` devuelva error (para probar el best-effort). */
  errorRpcResolver?: { code?: string; message: string };
}) {
  const bultos: FilaFixture[] = [...(opts.bultosIniciales ?? [])];
  let contador = 0;

  function tablaFiltrable(fixture: FilaFixture[]) {
    const filtrosEq: { columna: string; valor: unknown }[] = [];
    let filtroIn: { columna: string; valores: unknown[] } | null = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (columna: string, valor: unknown) => {
      filtrosEq.push({ columna, valor });
      return b;
    };
    b.in = (columna: string, valores: unknown[]) => {
      filtroIn = { columna, valores };
      return b;
    };
    b.then = (resolve: (r: { data: FilaFixture[]; error: null }) => void) => {
      let resultado = fixture.filter((f) => filtrosEq.every((flt) => f[flt.columna] === flt.valor));
      if (filtroIn) resultado = resultado.filter((f) => filtroIn!.valores.includes(f[filtroIn!.columna]));
      resolve({ data: resultado, error: null });
    };
    return b;
  }

  function tablaBultos() {
    let modoUpsert = false;
    let filaAInsertar: FilaFixture | null = null;
    let payloadUpdate: FilaFixture | null = null;
    const filtrosEq: { columna: string; valor: unknown }[] = [];

    const b: Record<string, unknown> = {};
    b.upsert = (payload: FilaFixture) => {
      modoUpsert = true;
      filaAInsertar = payload;
      return b;
    };
    // El UPDATE del rescate de QR (`flex_manual` → `flex_qr`). Aplica los
    // filtros DE VERDAD sobre el fixture, incluido el compare-and-swap
    // `codigo_formato = 'flex_manual'`: un doble que ignorara ese `.eq` haría
    // pasar una prueba de idempotencia que en realidad no se cumple.
    b.update = (payload: FilaFixture) => {
      payloadUpdate = payload;
      return b;
    };
    b.then = (resolve: (r: { data: null; error: null }) => void) => {
      if (payloadUpdate) {
        for (const f of bultos) {
          if (filtrosEq.every((flt) => f[flt.columna] === flt.valor)) Object.assign(f, payloadUpdate);
        }
      }
      resolve({ data: null, error: null });
    };
    b.select = () => b;
    b.eq = (columna: string, valor: unknown) => {
      filtrosEq.push({ columna, valor });
      return b;
    };
    b.maybeSingle = async () => {
      if (modoUpsert && filaAInsertar) {
        const payload = filaAInsertar;
        if (opts.lanzarExcepcionParaEscaneoId && payload.escaneo_id === opts.lanzarExcepcionParaEscaneoId) {
          throw new Error("timeout de red simulado");
        }
        const errorForzado = opts.erroresInsertPorEscaneoId?.[payload.escaneo_id as string];
        if (errorForzado) {
          return { data: null, error: errorForzado };
        }
        const chocaEscaneo = bultos.some(
          (f) => f.tenant_id === payload.tenant_id && f.escaneo_id === payload.escaneo_id,
        );
        const chocaCodigo = bultos.some(
          (f) => f.sesion_retiro_id === payload.sesion_retiro_id && f.codigo_normalizado === payload.codigo_normalizado,
        );
        if (chocaEscaneo || chocaCodigo) {
          // Simula el DO NOTHING silencioso de `ON CONFLICT DO NOTHING` sin árbitro.
          return { data: null, error: null };
        }
        const nueva = { id: `bulto-generado-${++contador}`, ...payload };
        bultos.push(nueva);
        return { data: nueva, error: null };
      }
      const filas = bultos.filter((f) => filtrosEq.every((flt) => f[flt.columna] === flt.valor));
      return { data: filas[0] ?? null, error: null };
    };
    return b;
  }

  const from = vi.fn((tabla: string) => {
    if (tabla === "pedidos") return tablaFiltrable(opts.pedidos ?? []);
    if (tabla === "sellers") return tablaFiltrable(opts.sellers ?? []);
    if (tabla === "bultos_retiro") return tablaBultos();
    throw new Error(`Tabla no soportada en el doble: ${tabla}`);
  });

  // Doble de `operacion.resolver_bulto_retiro`. LANZA ante cualquier otro RPC o
  // esquema a propósito: un doble permisivo dejaría pasar una llamada mal
  // dirigida sin que ninguna prueba se entere, que es exactamente cómo estos
  // defectos sobreviven semanas en este repo.
  const rpc = vi.fn(async (nombre: string, args: Record<string, unknown>) => {
    if (nombre !== "resolver_bulto_retiro") {
      throw new Error(`RPC no soportado en el doble: ${nombre}`);
    }
    if (opts.errorRpcResolver) return { data: null, error: opts.errorRpcResolver };
    return {
      data: [
        {
          bulto_resuelto_id: args.p_bulto_id,
          pedido_resuelto_id: args.p_pedido_id,
          seller_resuelto_id: SELLER_1,
          resuelto_ts: new Date().toISOString(),
          sesion_estaba_cerrada: true,
          pedido_marcado_retirado: true,
        },
      ],
      error: null,
    };
  });

  const schema = vi.fn((nombre: string) => {
    if (nombre !== "operacion") throw new Error(`Esquema no soportado en el doble: ${nombre}`);
    return { rpc };
  });

  return { cliente: { from, schema } as never, from, schema, rpc, bultos };
}

function loteBase(entrada: {
  tenantId?: string;
  sesionId?: string;
  conductorId?: string;
  sellerIdBodega?: string;
  sesionCerrada?: boolean;
  escaneos: EscaneoEntrada[];
}) {
  return {
    tenantId: entrada.tenantId ?? TENANT_A,
    sesionId: entrada.sesionId ?? SESION_1,
    conductorId: entrada.conductorId ?? CONDUCTOR_1,
    sellerIdBodega: entrada.sellerIdBodega ?? SELLER_1,
    sesionCerrada: entrada.sesionCerrada ?? false,
    escaneos: entrada.escaneos,
  };
}

const PAYLOAD_FLEX_1 =
  '{"id":"44760788897","sender_id":2114191787,"hash_code":"fwH77GO2qbT3SrRS/UKb14MN2s5JA3AhWG4Pen/l6WY=","security_digit":"0"}';

const PEDIDO_FLEX_FIXTURE: FilaFixture = {
  id: PEDIDO_1,
  tenant_id: TENANT_A,
  ml_shipment_id: "44760788897",
  codigo_interno: null,
  seller_id: SELLER_1,
  estado: "pendiente_asignacion",
  situacion_retiro: "pendiente",
  destinatario_comuna: "Maipú",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registrarLoteEscaneos — contrato general", () => {
  it("lote vacío devuelve resultados vacíos sin tocar la BD", async () => {
    const { cliente, from } = crearCliente({});
    const resultado = await registrarLoteEscaneos(cliente, loteBase({ escaneos: [] }));
    expect(resultado.resultados).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("MAX_ESCANEOS_POR_LOTE es 50 (el contrato del endpoint)", () => {
    expect(MAX_ESCANEOS_POR_LOTE).toBe(50);
  });
});

describe("registrarLoteEscaneos — estructuralmente inválido -> rechazado, SIN tocar la BD para ese ítem", () => {
  it("codigo vacío -> rechazado, resolucion null", async () => {
    const { cliente } = crearCliente({});
    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ escaneos: [{ escaneoId: "esc-1", codigo: "   ", escaneadoEn: new Date().toISOString() }] }),
    );

    expect(resultados).toEqual([
      { escaneoId: "esc-1", estado: "rechazado", resolucion: null, bultoId: null, pedido: null, motivo: "falta_codigo" },
    ]);
  });

  it("escaneadoEn no parseable -> rechazado", async () => {
    const { cliente } = crearCliente({});
    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ escaneos: [{ escaneoId: "esc-1", codigo: "RX-7K2M-9PQR", escaneadoEn: "no-es-fecha" }] }),
    );
    expect(resultados[0].estado).toBe("rechazado");
    expect(resultados[0].motivo).toBe("escaneado_en_invalido");
  });

  it("un ítem rechazado NO tumba a los demás del mismo lote", async () => {
    const { cliente } = crearCliente({});
    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({
        escaneos: [
          { escaneoId: "esc-malo", codigo: "", escaneadoEn: new Date().toISOString() },
          { escaneoId: "esc-bueno", codigo: "RX-7K2M-9PQR", escaneadoEn: new Date().toISOString() },
        ],
      }),
    );

    expect(resultados.find((r) => r.escaneoId === "esc-malo")!.estado).toBe("rechazado");
    expect(resultados.find((r) => r.escaneoId === "esc-bueno")!.estado).toBe("registrado");
  });
});

describe("registrarLoteEscaneos — un código desconocido es un estado NORMAL, no un error", () => {
  it("se guarda igual: registrado, resolucion ilegible, credencial preservada", async () => {
    const { cliente, bultos } = crearCliente({});
    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ escaneos: [{ escaneoId: "esc-1", codigo: "un garabato ilegible", escaneadoEn: new Date().toISOString() }] }),
    );

    expect(resultados[0].estado).toBe("registrado");
    expect(resultados[0].resolucion).toBe("ilegible");
    expect(resultados[0].pedido).toBeNull();
    expect(bultos).toHaveLength(1);
    expect(bultos[0].codigo_formato).toBe("desconocido");
    expect(guardarCredencialQr).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({ credencial: { tipoPayload: "codigo_crudo", valor: "un garabato ilegible" } }),
    );
    // Un desconocido no tiene shipment id: NUNCA dispara la resolución diferida.
    expect(inngest.send).not.toHaveBeenCalled();
  });
});

describe("registrarLoteEscaneos — flex_qr", () => {
  it("resuelto contra la ingesta: registrado, resuelto, DTO con el pedido, sin evento diferido", async () => {
    const { cliente } = crearCliente({
      pedidos: [PEDIDO_FLEX_FIXTURE],
      sellers: [{ id: SELLER_1, tenant_id: TENANT_A, razon_social: "Tienda Uno SpA" }],
    });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ escaneos: [{ escaneoId: "esc-1", codigo: PAYLOAD_FLEX_1, escaneadoEn: new Date().toISOString() }] }),
    );

    expect(resultados[0].estado).toBe("registrado");
    expect(resultados[0].resolucion).toBe("resuelto");
    expect(resultados[0].pedido).toMatchObject({ pedidoId: PEDIDO_1, sellerNombre: "Tienda Uno SpA", comuna: "Maipú" });
    expect(guardarCredencialQr).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({ credencial: { tipoPayload: "flex_hash", hashCode: expect.any(String), securityDigit: "0" } }),
    );
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("un bulto de OTRO seller que aparece en esta bodega: esDeEstaBodega = false (lo destapa, no lo bloquea)", async () => {
    const { cliente } = crearCliente({
      pedidos: [PEDIDO_FLEX_FIXTURE],
      sellers: [{ id: SELLER_1, tenant_id: TENANT_A, razon_social: "Tienda Uno SpA" }],
    });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({
        sellerIdBodega: SELLER_2, // la bodega que se visita es de OTRO seller
        escaneos: [{ escaneoId: "esc-1", codigo: PAYLOAD_FLEX_1, escaneadoEn: new Date().toISOString() }],
      }),
    );

    expect(resultados[0].estado).toBe("registrado"); // se acepta igual, nunca se bloquea
    expect(resultados[0].pedido?.esDeEstaBodega).toBe(false);
  });

  it("NO resuelto (candidato ajeno o aún no ingestado): no_procesado, y SÍ dispara la resolución diferida", async () => {
    const { cliente, bultos } = crearCliente({ pedidos: [], sellers: [] });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ escaneos: [{ escaneoId: "esc-1", codigo: PAYLOAD_FLEX_1, escaneadoEn: "2026-08-13T13:00:00.000Z" }] }),
    );

    expect(resultados[0].estado).toBe("registrado");
    expect(resultados[0].resolucion).toBe("no_procesado");
    expect(resultados[0].pedido).toBeNull();

    expect(inngest.send).toHaveBeenCalledTimes(1);
    const llamada = vi.mocked(inngest.send).mock.calls[0][0] as { name: string; id: string; data: Record<string, unknown> };
    expect(llamada.name).toBe("operacion/bulto-retiro.sin-pedido");
    expect(llamada.id).toBe(`bulto-retiro-sin-pedido-${bultos[0].id}`);
    expect(llamada.data).toMatchObject({
      tenantId: TENANT_A,
      sesionRetiroId: SESION_1,
      mlShipmentId: "44760788897",
      escaneadoEn: "2026-08-13T13:00:00.000Z",
    });
  });
});

describe("registrarLoteEscaneos — rutax_interno sin match: no_procesado, SIN evento diferido", () => {
  it("un codigo_interno same-day no ingestado no dispara la resolución diferida (no hay ML que consultar)", async () => {
    const { cliente } = crearCliente({ pedidos: [] });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ escaneos: [{ escaneoId: "esc-1", codigo: "RX-7K2M-9PQR", escaneadoEn: new Date().toISOString() }] }),
    );

    expect(resultados[0].resolucion).toBe("no_procesado");
    expect(inngest.send).not.toHaveBeenCalled();
    // rutax_interno no lleva credencial (Rutax siempre puede regenerar la etiqueta).
    expect(guardarCredencialQr).not.toHaveBeenCalled();
  });
});

describe("registrarLoteEscaneos — idempotencia y fusión de duplicados", () => {
  it("reintento del MISMO escaneo_id (timeout de red, reintento de lote): duplicado_fusionado, mismo bulto", async () => {
    const yaExistente: FilaFixture = {
      id: "bulto-ya-existente",
      tenant_id: TENANT_A,
      sesion_retiro_id: SESION_1,
      escaneo_id: "esc-1",
      codigo_formato: "rutax_interno",
      codigo_normalizado: "RX-7K2M-9PQR",
      pedido_id: null,
    };
    const { cliente } = crearCliente({ bultosIniciales: [yaExistente] });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ escaneos: [{ escaneoId: "esc-1", codigo: "RX-7K2M-9PQR", escaneadoEn: new Date().toISOString() }] }),
    );

    expect(resultados[0].estado).toBe("duplicado_fusionado");
    expect(resultados[0].bultoId).toBe("bulto-ya-existente");
    // Un fusionado NUNCA vuelve a guardar credencial ni a publicar el evento.
    expect(guardarCredencialQr).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("doble escaneo FÍSICO (mismo código, escaneo_id nuevo): duplicado_fusionado contra el bulto original", async () => {
    const yaExistente: FilaFixture = {
      id: "bulto-original",
      tenant_id: TENANT_A,
      sesion_retiro_id: SESION_1,
      escaneo_id: "esc-primera-vez",
      codigo_formato: "rutax_interno",
      codigo_normalizado: "RX-7K2M-9PQR",
      pedido_id: null,
    };
    const { cliente } = crearCliente({ bultosIniciales: [yaExistente] });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ escaneos: [{ escaneoId: "esc-ráfaga-2", codigo: "RX-7K2M-9PQR", escaneadoEn: new Date().toISOString() }] }),
    );

    expect(resultados[0].estado).toBe("duplicado_fusionado");
    expect(resultados[0].bultoId).toBe("bulto-original");
  });
});

// =============================================================================
// Rescate del QR de un bulto que entró TECLEADO
// =============================================================================
/**
 * El conductor teclea el número porque la etiqueta no se deja escanear, y más
 * tarde el QR sí se lee. Sin rescate ese `hash_code` se perdería para siempre:
 * es una firma de ML que no se puede calcular y `GET /shipment_labels` exige
 * `ready_to_ship`, así que una vez retirado el bulto la etiqueta no se
 * reimprime. Es la única oportunidad, y no vuelve.
 */
describe("registrarLoteEscaneos — rescate del QR de un bulto tecleado", () => {
  /** El bulto tal como lo dejó el ingreso manual: sin credencial, sin ml_user_id. */
  const BULTO_TECLEADO: FilaFixture = {
    id: "bulto-tecleado",
    tenant_id: TENANT_A,
    sesion_retiro_id: SESION_1,
    escaneo_id: "esc-tecleado",
    codigo_formato: "flex_manual",
    codigo_normalizado: "44760788897",
    ml_shipment_id: "44760788897",
    ml_user_id: null,
    pedido_id: PEDIDO_1,
  };

  it("al llegar el QR del mismo bulto, guarda la credencial y asciende el formato", async () => {
    const fila = { ...BULTO_TECLEADO };
    const { cliente } = crearCliente({
      bultosIniciales: [fila],
      pedidos: [PEDIDO_FLEX_FIXTURE],
      sellers: [{ id: SELLER_1, tenant_id: TENANT_A, razon_social: "Seller 1" }],
    });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({
        escaneos: [{ escaneoId: "esc-qr-tardio", codigo: PAYLOAD_FLEX_1, escaneadoEn: new Date().toISOString() }],
      }),
    );

    // Sigue siendo UN bulto: es el mismo paquete físico.
    expect(resultados[0].estado).toBe("duplicado_fusionado");
    expect(resultados[0].bultoId).toBe("bulto-tecleado");

    // El dato irrecuperable quedó a salvo…
    expect(guardarCredencialQr).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({ bultoId: "bulto-tecleado", tenantId: TENANT_A }),
    );
    // …y la fila deja de decir "tecleado, sin QR", que sería falso.
    expect(fila.codigo_formato).toBe("flex_qr");
    // El sender_id lo trae el QR; tecleando no se podía conocer.
    expect(fila.ml_user_id).toBe("2114191787");
  });

  it("si la credencial no se pudo guardar, el formato NO se toca", async () => {
    // Entre dos inconsistencias se elige la que conserva el dato: un
    // `flex_manual` sin credencial se puede reintentar con el próximo escaneo;
    // un `flex_qr` sin credencial mentiría diciendo que el QR ya se capturó, y
    // nadie volvería a intentarlo.
    vi.mocked(guardarCredencialQr).mockRejectedValueOnce(new Error("fallo simulado"));

    const fila = { ...BULTO_TECLEADO };
    const { cliente } = crearCliente({
      bultosIniciales: [fila],
      pedidos: [PEDIDO_FLEX_FIXTURE],
      sellers: [{ id: SELLER_1, tenant_id: TENANT_A, razon_social: "Seller 1" }],
    });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({
        escaneos: [{ escaneoId: "esc-qr-tardio", codigo: PAYLOAD_FLEX_1, escaneadoEn: new Date().toISOString() }],
      }),
    );

    // El escaneo NUNCA se pierde por esto: sigue siendo una fusión correcta.
    expect(resultados[0].estado).toBe("duplicado_fusionado");
    expect(fila.codigo_formato).toBe("flex_manual");
  });

  it("un bulto que ya entró por QR no se re-rescata (idempotente)", async () => {
    const fila: FilaFixture = { ...BULTO_TECLEADO, codigo_formato: "flex_qr", ml_user_id: "2114191787" };
    const { cliente } = crearCliente({
      bultosIniciales: [fila],
      pedidos: [PEDIDO_FLEX_FIXTURE],
      sellers: [{ id: SELLER_1, tenant_id: TENANT_A, razon_social: "Seller 1" }],
    });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({
        escaneos: [{ escaneoId: "esc-ráfaga", codigo: PAYLOAD_FLEX_1, escaneadoEn: new Date().toISOString() }],
      }),
    );

    expect(resultados[0].estado).toBe("duplicado_fusionado");
    // Su credencial ya está guardada desde la primera vez; reinsertarla
    // chocaría contra la PK 1:1 de bultos_retiro_qr.
    expect(guardarCredencialQr).not.toHaveBeenCalled();
  });
});

describe("registrarLoteEscaneos — aislamiento entre ítems del mismo lote", () => {
  it("un fallo de Postgres en UN ítem no tumba a los otros 49 (aquí: los otros 2)", async () => {
    const { cliente } = crearCliente({
      erroresInsertPorEscaneoId: { "esc-2": { code: "22023", message: "algo raro en este ítem" } },
    });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({
        escaneos: [
          { escaneoId: "esc-1", codigo: "RX-7K2M-9PQR", escaneadoEn: new Date().toISOString() },
          { escaneoId: "esc-2", codigo: "RX-AAAA-BBBB", escaneadoEn: new Date().toISOString() },
          { escaneoId: "esc-3", codigo: "RX-CCCC-DDDD", escaneadoEn: new Date().toISOString() },
        ],
      }),
    );

    expect(resultados.find((r) => r.escaneoId === "esc-1")!.estado).toBe("registrado");
    expect(resultados.find((r) => r.escaneoId === "esc-2")!.estado).toBe("rechazado");
    expect(resultados.find((r) => r.escaneoId === "esc-3")!.estado).toBe("registrado");
  });

  it("una EXCEPCIÓN de infraestructura (no un {error} manejado) en UN ítem tampoco tumba el Promise.all completo", async () => {
    const { cliente } = crearCliente({ lanzarExcepcionParaEscaneoId: "esc-2" });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({
        escaneos: [
          { escaneoId: "esc-1", codigo: "RX-7K2M-9PQR", escaneadoEn: new Date().toISOString() },
          { escaneoId: "esc-2", codigo: "RX-AAAA-BBBB", escaneadoEn: new Date().toISOString() },
          { escaneoId: "esc-3", codigo: "RX-CCCC-DDDD", escaneadoEn: new Date().toISOString() },
        ],
      }),
    );

    expect(resultados).toHaveLength(3); // registrarLoteEscaneos NO se cayó entero
    expect(resultados.find((r) => r.escaneoId === "esc-1")!.estado).toBe("registrado");
    expect(resultados.find((r) => r.escaneoId === "esc-2")!.estado).toBe("rechazado");
    expect(resultados.find((r) => r.escaneoId === "esc-3")!.estado).toBe("registrado");
  });
});

describe("registrarLoteEscaneos — fallos best-effort no tumban el escaneo", () => {
  it("si guardarCredencialQr falla, el bulto sigue 'registrado' (perder la credencial es menos grave que perder el escaneo)", async () => {
    vi.mocked(guardarCredencialQr).mockRejectedValueOnce(new Error("cifrado caído"));
    const { cliente } = crearCliente({ pedidos: [], sellers: [] });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ escaneos: [{ escaneoId: "esc-1", codigo: PAYLOAD_FLEX_1, escaneadoEn: new Date().toISOString() }] }),
    );

    expect(resultados[0].estado).toBe("registrado");
  });

  it("si inngest.send falla, el bulto sigue 'registrado'", async () => {
    vi.mocked(inngest.send).mockRejectedValueOnce(new Error("inngest caído"));
    const { cliente } = crearCliente({ pedidos: [], sellers: [] });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ escaneos: [{ escaneoId: "esc-1", codigo: PAYLOAD_FLEX_1, escaneadoEn: new Date().toISOString() }] }),
    );

    expect(resultados[0].estado).toBe("registrado");
  });
});

/**
 * El escaneo que llega DESPUÉS del cierre de la visita. Es el caso normal, no un
 * borde: la señal en bodega es mala, el conductor cierra adentro, y la cola sin
 * conexión drena cuando sale a la calle.
 *
 * Sin esta propagación el bulto queda con su `pedido_id` puesto y el pedido en
 * `situacion_retiro = 'pendiente'` para siempre — arriba de la van, contado en la
 * carga por comuna, y ausente de la bandeja de asignación.
 */
describe("registrarLoteEscaneos — bulto posterior al cierre", () => {
  const escaneoFlex = () => ({
    escaneoId: "esc-1",
    codigo: PAYLOAD_FLEX_1,
    escaneadoEn: new Date().toISOString(),
  });

  it("con la visita CERRADA y el bulto resuelto, marca el pedido como retirado", async () => {
    const { cliente, rpc, schema } = crearCliente({
      pedidos: [PEDIDO_FLEX_FIXTURE],
      sellers: [{ id: SELLER_1, tenant_id: TENANT_A, razon_social: "Comercial Andes" }],
    });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ sesionCerrada: true, escaneos: [escaneoFlex()] }),
    );

    expect(resultados[0].estado).toBe("registrado");
    expect(schema).toHaveBeenCalledWith("operacion");
    // Los argumentos EXACTOS: un RPC llamado con el pedido de otro sería
    // marcar como retirado un pedido que nadie retiró.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("resolver_bulto_retiro", {
      p_tenant_id: TENANT_A,
      p_bulto_id: resultados[0].bultoId,
      p_pedido_id: PEDIDO_1,
    });
  });

  it("con la visita ABIERTA no lo llama: de eso se encarga el cierre", async () => {
    const { cliente, rpc } = crearCliente({
      pedidos: [PEDIDO_FLEX_FIXTURE],
      sellers: [{ id: SELLER_1, tenant_id: TENANT_A, razon_social: "Comercial Andes" }],
    });

    await registrarLoteEscaneos(cliente, loteBase({ sesionCerrada: false, escaneos: [escaneoFlex()] }));

    expect(rpc).not.toHaveBeenCalled();
  });

  it("con la visita cerrada pero el bulto SIN resolver, no lo llama", async () => {
    // Sin pedido no hay nada que marcar, y llamarlo con un pedido inventado
    // sería una atribución falsa.
    const { cliente, rpc } = crearCliente({ pedidos: [], sellers: [] });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ sesionCerrada: true, escaneos: [escaneoFlex()] }),
    );

    expect(resultados[0].estado).toBe("registrado");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("EN UNA FUSIÓN TAMBIÉN lo llama — es la única vía de recuperación", async () => {
    // El reintento del lote entra siempre por la rama de fusión. Si la
    // propagación viviera dentro del bloque de "solo el recién insertado", un
    // fallo dejaría el pedido en `pendiente` sin segunda oportunidad.
    const { cliente, rpc } = crearCliente({
      pedidos: [PEDIDO_FLEX_FIXTURE],
      sellers: [{ id: SELLER_1, tenant_id: TENANT_A, razon_social: "Comercial Andes" }],
      bultosIniciales: [
        {
          id: "bulto-preexistente",
          tenant_id: TENANT_A,
          sesion_retiro_id: SESION_1,
          escaneo_id: "esc-anterior",
          codigo_normalizado: "44760788897",
          pedido_id: PEDIDO_1,
        },
      ],
    });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ sesionCerrada: true, escaneos: [escaneoFlex()] }),
    );

    expect(resultados[0].estado).toBe("duplicado_fusionado");
    expect(rpc).toHaveBeenCalledWith("resolver_bulto_retiro", {
      p_tenant_id: TENANT_A,
      p_bulto_id: "bulto-preexistente",
      p_pedido_id: PEDIDO_1,
    });
  });

  it("si el RPC falla, el escaneo sigue 'registrado' — nunca se pierde un escaneo", async () => {
    const { cliente, rpc } = crearCliente({
      pedidos: [PEDIDO_FLEX_FIXTURE],
      sellers: [{ id: SELLER_1, tenant_id: TENANT_A, razon_social: "Comercial Andes" }],
      errorRpcResolver: { code: "23514", message: "violación de CHECK simulada" },
    });

    const { resultados } = await registrarLoteEscaneos(
      cliente,
      loteBase({ sesionCerrada: true, escaneos: [escaneoFlex()] }),
    );

    // El bulto YA está guardado y confirmado: devolver `rechazado` lo dejaría
    // atascado en la cola del conductor por algo que sí se escribió.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(resultados[0].estado).toBe("registrado");
    expect(resultados[0].bultoId).not.toBeNull();
  });
});
