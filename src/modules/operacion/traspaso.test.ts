/**
 * Pruebas del módulo de traspaso (etapa 9).
 *
 * Lo que se custodia acá NO es la reja —esa vive en SQL y la prueba
 * `rls_aislamiento_traspaso.test.sql` contra un Postgres real—, sino la capa de
 * TRADUCCIÓN, que es donde el conductor puede quedarse sin saber qué le pasó:
 *
 * · Un código ilegible o desconocido NO puede tumbar el lote. El conductor está
 *   de pie en la calle con el otro esperándolo.
 * · Cada bulto escaneado tiene que volver con SU propio resultado, aunque el
 *   RPC hable en términos de pedidos y él haya escaneado etiquetas.
 * · Si NINGÚN código resuelve, no se llama al RPC — lanzaría por lote vacío y
 *   convertiría un resultado legítimo ("no conozco estas 3 etiquetas") en un 500.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./traspaso-rpc", () => ({ traspasarPedidosRpc: vi.fn() }));
vi.mock("./ruta-manifiesto", () => ({ recalcularRutaTrasCambio: vi.fn() }));
vi.mock("./manifiesto-vigente", () => ({ obtenerManifiestoVigenteDelConductor: vi.fn() }));
vi.mock("./retiro/dto-pedido", async (original) => ({
  ...(await original<typeof import("./retiro/dto-pedido")>()),
  buscarPedidosPorCodigos: vi.fn(),
}));

import { traspasarPedidosRpc } from "./traspaso-rpc";
import { buscarPedidosPorCodigos } from "./retiro/dto-pedido";
import { traspasarBultosEscaneados, ErrorLoteExcedido, MAX_BULTOS_POR_TRASPASO } from "./traspaso";
import { recalcularRutaTrasCambio } from "./ruta-manifiesto";
import { obtenerManifiestoVigenteDelConductor } from "./manifiesto-vigente";

const TENANT = "10000000-0000-0000-0000-000000000001";
const PEDRO = "40000000-0000-0000-0000-000000000002";
const USUARIO = "usuario-pedro";

/** Un código Flex válido: el shipment id pelado que la app manda del QR. */
const CODIGO_FLEX = "44012345678";
const PEDIDO_1 = "60000000-0000-0000-0000-000000000001";

function candidato(pedidoId: string, codigoNormalizado: string) {
  return {
    pedidoId,
    codigoVisible: codigoNormalizado,
    sellerId: "seller-1",
    comuna: "Maipú",
    estado: "en_ruta",
    situacionRetiro: "retirado",
  };
}

// Doble mínimo: el módulo solo usa el cliente para resolver nombres de origen.
const clienteFalso = {
  from: () => ({
    select: () => ({
      eq: () => ({
        in: async () => ({ data: [{ id: "juan-id", nombre_completo: "Juan Pérez" }] }),
      }),
    }),
  }),
} as never;

beforeEach(() => {
  // `clearAllMocks` NO resetea implementaciones, y una implementación filtrada
  // entre pruebas ya mordió antes en este proyecto.
  vi.mocked(buscarPedidosPorCodigos).mockReset();
  vi.mocked(traspasarPedidosRpc).mockReset();
  vi.mocked(recalcularRutaTrasCambio).mockReset().mockResolvedValue(undefined);
  vi.mocked(obtenerManifiestoVigenteDelConductor).mockReset();
});

/**
 * Cliente falso más completo que `clienteFalso`: además de resolver nombres de
 * origen (tabla `conductores`), sabe responder
 * `.from("manifiestos").select("estado").eq(...).eq(...).maybeSingle()` — lo
 * que necesita el gatillo del recálculo automático para leer el estado del
 * manifiesto RECEPTOR reutilizado.
 */
function clienteConManifiestoReceptor(estado: string | null) {
  return {
    from: (tabla: string) => {
      if (tabla === "conductores") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: [{ id: "juan-id", nombre_completo: "Juan Pérez" }] }),
            }),
          }),
        };
      }
      if (tabla === "manifiestos") {
        const builder: Record<string, unknown> = {};
        const self = () => builder;
        builder.select = vi.fn(self);
        builder.eq = vi.fn(self);
        builder.maybeSingle = vi.fn(async () => ({
          data: estado === null ? null : { estado },
          error: null,
        }));
        return builder;
      }
      throw new Error(`from() inesperado: ${tabla}`);
    },
  } as never;
}

describe("traspasarBultosEscaneados", () => {
  it("un código ILEGIBLE no tumba el lote: vuelve con su motivo y los demás se traspasan", async () => {
    vi.mocked(buscarPedidosPorCodigos).mockResolvedValue(
      new Map([[CODIGO_FLEX, candidato(PEDIDO_1, CODIGO_FLEX)]]),
    );
    vi.mocked(traspasarPedidosRpc).mockResolvedValue({
      manifiestoId: "man-1",
      manifiestoCreado: false,
      totalSolicitados: 1,
      totalTraspasados: 1,
      totalOmitidos: 0,
      omitidos: {},
      origenes: { [PEDIDO_1]: "juan-id" },
    });

    const r = await traspasarBultosEscaneados(clienteFalso, {
      tenantId: TENANT,
      conductorReceptorId: PEDRO,
      actorUsuarioId: USUARIO,
      // El segundo es basura: ni Flex ni interno.
      codigos: [CODIGO_FLEX, "%%%"],
    });

    expect(r.totalEscaneados).toBe(2);
    expect(r.totalTraspasados).toBe(1);
    expect(r.bultos).toHaveLength(2);
    expect(r.bultos[0]).toMatchObject({ traspasado: true, motivo: null });
    expect(r.bultos[1]).toMatchObject({ traspasado: false, motivo: "ilegible" });
  });

  it("NINGÚN código resuelve → no se llama al RPC (lanzaría por lote vacío y sería un 500)", async () => {
    vi.mocked(buscarPedidosPorCodigos).mockResolvedValue(new Map());

    const r = await traspasarBultosEscaneados(clienteFalso, {
      tenantId: TENANT,
      conductorReceptorId: PEDRO,
      actorUsuarioId: USUARIO,
      codigos: [CODIGO_FLEX],
    });

    expect(traspasarPedidosRpc).not.toHaveBeenCalled();
    expect(r.totalTraspasados).toBe(0);
    expect(r.bultos[0]).toMatchObject({ traspasado: false, motivo: "sin_pedido" });
    // Y NO se inventa un manifiesto que no existe.
    expect(r.manifiestoId).toBeNull();
  });

  it("el motivo del RPC llega al bulto que le corresponde, no a otro", async () => {
    vi.mocked(buscarPedidosPorCodigos).mockResolvedValue(
      new Map([[CODIGO_FLEX, candidato(PEDIDO_1, CODIGO_FLEX)]]),
    );
    vi.mocked(traspasarPedidosRpc).mockResolvedValue({
      manifiestoId: "man-1",
      manifiestoCreado: false,
      totalSolicitados: 1,
      totalTraspasados: 0,
      totalOmitidos: 1,
      omitidos: { [PEDIDO_1]: "ya_mio" },
      origenes: {},
    });

    const r = await traspasarBultosEscaneados(clienteFalso, {
      tenantId: TENANT,
      conductorReceptorId: PEDRO,
      actorUsuarioId: USUARIO,
      codigos: [CODIGO_FLEX],
    });

    expect(r.bultos[0]).toMatchObject({
      pedidoId: PEDIDO_1,
      traspasado: false,
      motivo: "ya_mio",
    });
  });

  it("el RECEPTOR que viaja al RPC es el del parámetro, nunca uno del cuerpo", async () => {
    // Es la garantía de seguridad de la ruta: el receptor sale del token. Si esta
    // función algún día lo tomara de otro lado, un conductor podría moverle
    // pedidos —y plata— a otro.
    vi.mocked(buscarPedidosPorCodigos).mockResolvedValue(
      new Map([[CODIGO_FLEX, candidato(PEDIDO_1, CODIGO_FLEX)]]),
    );
    vi.mocked(traspasarPedidosRpc).mockResolvedValue({
      manifiestoId: "man-1", manifiestoCreado: false, totalSolicitados: 1,
      totalTraspasados: 1, totalOmitidos: 0, omitidos: {}, origenes: {},
    });

    await traspasarBultosEscaneados(clienteFalso, {
      tenantId: TENANT,
      conductorReceptorId: PEDRO,
      actorUsuarioId: USUARIO,
      codigos: [CODIGO_FLEX],
    });

    expect(traspasarPedidosRpc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ conductorReceptorId: PEDRO, tenantId: TENANT }),
    );
  });

  it("el mismo código escaneado dos veces llega UNA sola vez al RPC", async () => {
    // Viene de un escáner: la ráfaga de la cámara y el conductor pasando dos
    // veces el mismo bulto son lo normal. Dos ids iguales en el arreglo harían
    // que el SQL intentara dos asignaciones activas del mismo pedido.
    vi.mocked(buscarPedidosPorCodigos).mockResolvedValue(
      new Map([[CODIGO_FLEX, candidato(PEDIDO_1, CODIGO_FLEX)]]),
    );
    vi.mocked(traspasarPedidosRpc).mockResolvedValue({
      manifiestoId: "man-1", manifiestoCreado: false, totalSolicitados: 1,
      totalTraspasados: 1, totalOmitidos: 0, omitidos: {}, origenes: {},
    });

    await traspasarBultosEscaneados(clienteFalso, {
      tenantId: TENANT,
      conductorReceptorId: PEDRO,
      actorUsuarioId: USUARIO,
      codigos: [CODIGO_FLEX, CODIGO_FLEX],
    });

    const args = vi.mocked(traspasarPedidosRpc).mock.calls[0][1];
    expect(args.pedidoIds).toEqual([PEDIDO_1]);
  });

  it("los orígenes vuelven con NOMBRE y cantidad — 'recibiste 1 de Juan Pérez'", async () => {
    vi.mocked(buscarPedidosPorCodigos).mockResolvedValue(
      new Map([[CODIGO_FLEX, candidato(PEDIDO_1, CODIGO_FLEX)]]),
    );
    vi.mocked(traspasarPedidosRpc).mockResolvedValue({
      manifiestoId: "man-1", manifiestoCreado: false, totalSolicitados: 1,
      totalTraspasados: 1, totalOmitidos: 0, omitidos: {},
      origenes: { [PEDIDO_1]: "juan-id" },
    });

    const r = await traspasarBultosEscaneados(clienteFalso, {
      tenantId: TENANT,
      conductorReceptorId: PEDRO,
      actorUsuarioId: USUARIO,
      codigos: [CODIGO_FLEX],
    });

    expect(r.origenes).toEqual([{ conductorId: "juan-id", nombre: "Juan Pérez", cantidad: 1 }]);
  });

  it("un lote sobre el tope se rechaza ANTES de tocar la base", async () => {
    await expect(
      traspasarBultosEscaneados(clienteFalso, {
        tenantId: TENANT,
        conductorReceptorId: PEDRO,
        actorUsuarioId: USUARIO,
        codigos: Array.from({ length: MAX_BULTOS_POR_TRASPASO + 1 }, (_, i) => `4401234${i}`),
      }),
    ).rejects.toBeInstanceOf(ErrorLoteExcedido);

    expect(buscarPedidosPorCodigos).not.toHaveBeenCalled();
    expect(traspasarPedidosRpc).not.toHaveBeenCalled();
  });
});

describe("traspasarBultosEscaneados — el gatillo del recálculo automático", () => {
  function traspasoOk(overrides: Partial<Awaited<ReturnType<typeof traspasarPedidosRpc>>> = {}) {
    vi.mocked(buscarPedidosPorCodigos).mockResolvedValue(
      new Map([[CODIGO_FLEX, candidato(PEDIDO_1, CODIGO_FLEX)]]),
    );
    vi.mocked(traspasarPedidosRpc).mockResolvedValue({
      manifiestoId: "man-receptor",
      manifiestoCreado: false,
      totalSolicitados: 1,
      totalTraspasados: 1,
      totalOmitidos: 0,
      omitidos: {},
      origenes: { [PEDIDO_1]: "juan-id" },
      ...overrides,
    });
  }

  it("recalcula el manifiesto del RECEPTOR cuando se reutilizó uno 'confirmado'/'en_ruta'", async () => {
    traspasoOk();
    vi.mocked(obtenerManifiestoVigenteDelConductor).mockResolvedValue(null);
    const cliente = clienteConManifiestoReceptor("en_ruta");

    await traspasarBultosEscaneados(cliente, {
      tenantId: TENANT,
      conductorReceptorId: PEDRO,
      actorUsuarioId: USUARIO,
      codigos: [CODIGO_FLEX],
    });

    expect(recalcularRutaTrasCambio).toHaveBeenCalledWith(cliente, {
      tenantId: TENANT,
      manifiestoId: "man-receptor",
      estadoManifiesto: "en_ruta",
      actorUsuarioId: USUARIO,
      motivo: "traspaso-recibido",
    });
  });

  it("receptor con manifiestoCreado: true → nace 'borrador', no se lee el estado", async () => {
    traspasoOk({ manifiestoCreado: true });
    vi.mocked(obtenerManifiestoVigenteDelConductor).mockResolvedValue(null);
    // Este cliente NO sabe responder .from("manifiestos"): si el código
    // intentara leer el estado igual, la prueba lo delataría por completo
    // (lanzaría dentro del try/catch y `recalcularRutaTrasCambio` seguiría sin
    // llamarse, pero por la razón EQUIVOCADA — así que se comprueba también
    // que el intento de recálculo del receptor específicamente no ocurrió).
    await traspasarBultosEscaneados(clienteFalso, {
      tenantId: TENANT,
      conductorReceptorId: PEDRO,
      actorUsuarioId: USUARIO,
      codigos: [CODIGO_FLEX],
    });

    expect(recalcularRutaTrasCambio).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ motivo: "traspaso-recibido" }),
    );
  });

  it("recalcula el manifiesto vigente de CADA conductor de ORIGEN", async () => {
    traspasoOk();
    vi.mocked(obtenerManifiestoVigenteDelConductor).mockResolvedValue({
      id: "man-juan",
      nombre: "Reparto",
      fechaOperacion: "2026-09-05",
      estado: "en_ruta",
    });
    const cliente = clienteConManifiestoReceptor("borrador");

    await traspasarBultosEscaneados(cliente, {
      tenantId: TENANT,
      conductorReceptorId: PEDRO,
      actorUsuarioId: USUARIO,
      codigos: [CODIGO_FLEX],
    });

    expect(obtenerManifiestoVigenteDelConductor).toHaveBeenCalledWith(cliente, {
      tenantId: TENANT,
      driverId: "juan-id",
      fecha: expect.any(String),
    });
    expect(recalcularRutaTrasCambio).toHaveBeenCalledWith(cliente, {
      tenantId: TENANT,
      manifiestoId: "man-juan",
      estadoManifiesto: "en_ruta",
      actorUsuarioId: USUARIO,
      motivo: "traspaso-enviado",
    });
  });

  it("origen SIN manifiesto vigente hoy → no dispara nada para él, sin lanzar", async () => {
    traspasoOk();
    vi.mocked(obtenerManifiestoVigenteDelConductor).mockResolvedValue(null);
    const cliente = clienteConManifiestoReceptor("borrador");

    await expect(
      traspasarBultosEscaneados(cliente, {
        tenantId: TENANT,
        conductorReceptorId: PEDRO,
        actorUsuarioId: USUARIO,
        codigos: [CODIGO_FLEX],
      }),
    ).resolves.toBeDefined();

    expect(recalcularRutaTrasCambio).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ motivo: "traspaso-enviado" }),
    );
  });

  it("🔴 si el receptor falla, el traspaso NO se pierde y el origen se intenta igual", async () => {
    traspasoOk();
    vi.mocked(obtenerManifiestoVigenteDelConductor).mockResolvedValue({
      id: "man-juan",
      nombre: "Reparto",
      fechaOperacion: "2026-09-05",
      estado: "confirmado",
    });
    // Cliente cuyo .from("manifiestos") (la lectura del RECEPTOR) explota.
    const cliente = {
      from: (tabla: string) => {
        if (tabla === "conductores") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({ data: [{ id: "juan-id", nombre_completo: "Juan Pérez" }] }),
              }),
            }),
          };
        }
        throw new Error("se cayó la lectura del receptor");
      },
    } as never;

    const r = await traspasarBultosEscaneados(cliente, {
      tenantId: TENANT,
      conductorReceptorId: PEDRO,
      actorUsuarioId: USUARIO,
      codigos: [CODIGO_FLEX],
    });

    // El traspaso en sí no se ve afectado.
    expect(r.totalTraspasados).toBe(1);
    // Y el ORIGEN, que no depende de esa lectura, sí se intentó.
    expect(recalcularRutaTrasCambio).toHaveBeenCalledWith(
      cliente,
      expect.objectContaining({ motivo: "traspaso-enviado" }),
    );
  });

  it("sin ningún bulto traspasado (todos omitidos) → no se dispara nada", async () => {
    traspasoOk({ totalTraspasados: 0 });
    const cliente = clienteConManifiestoReceptor("en_ruta");

    await traspasarBultosEscaneados(cliente, {
      tenantId: TENANT,
      conductorReceptorId: PEDRO,
      actorUsuarioId: USUARIO,
      codigos: [CODIGO_FLEX],
    });

    expect(recalcularRutaTrasCambio).not.toHaveBeenCalled();
    expect(obtenerManifiestoVigenteDelConductor).not.toHaveBeenCalled();
  });
});
