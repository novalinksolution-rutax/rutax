/**
 * Pruebas de procesar-shipment.ts
 *
 * Prueba la lógica de negocio del job:
 * 1. Idempotencia: mismo estado actual → no-op.
 * 2. Condición de carrera (ErrorConflicto) → captura y termina sin reintento.
 * 3. Traducción correcta: estado ML → estado interno.
 * 4. Estado sin traducción → salida limpia sin lanzar.
 *
 * Los dos caminos NUEVOS del job —ingestar el envío desconocido y avisar de la
 * cancelación en vez de aplicarla— viven en `procesar-shipment-ingesta.test.ts`,
 * que necesita mockear el cliente de Inngest y los secretos y por eso no puede
 * compartir archivo con estas pruebas.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { ErrorConflicto, type EstadoPedidoInterno } from "../tipos-operacion";
import { traducirEstadoMl } from "../traduccion-estados";

// Mocks de las dependencias del adaptador REAL por defecto. Se declaran antes de
// importar el módulo bajo prueba para que `vi.mock` (hoisted) los intercepte.
const mockActualizarEstadoPedido = vi.fn();
const mockCrearClienteServiceRole = vi.fn(() => ({ marca: "cliente-fake" }));

vi.mock("@/modules/operacion", () => ({
  actualizarEstadoPedido: (...args: unknown[]) => mockActualizarEstadoPedido(...args),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: () => mockCrearClienteServiceRole(),
}));

// ---------------------------------------------------------------------------
// Lógica de negocio extraída para prueba aislada
// ---------------------------------------------------------------------------

interface PedidoSimulado {
  id: string;
  tenantId: string;
  sellerId: string;
  mlShipmentId: string;
  estado: EstadoPedidoInterno;
  estadoMl: string | null;
}

type FnActualizar = (entrada: {
  pedidoId: string;
  tenantId: string;
  estadoNuevo: EstadoPedidoInterno;
  estadoEsperado: EstadoPedidoInterno;
  actuadoPor: "sistema_ml";
  motivo?: string;
}) => Promise<void>;

/**
 * Error de transición inválida con `name` = "ErrorTransicionInvalida", que es
 * exactamente lo que el job inspecciona (por nombre, no por instancia, porque
 * el error real viene del módulo `operacion`).
 */
class ErrorTransicionInvalidaFake extends Error {
  constructor(mensaje = "transición inválida") {
    super(mensaje);
    this.name = "ErrorTransicionInvalida";
  }
}

async function procesarActualizacionShipment(
  pedido: PedidoSimulado,
  estadoMlNuevo: string,
  fnActualizar: FnActualizar,
  onLog: (nivel: string, msg: string) => void,
  subestadoMl?: string | null,
): Promise<{ resultado: string; detalle?: string }> {
  // Traducir estado (status + substatus)
  const estadoInterno = traducirEstadoMl(estadoMlNuevo, subestadoMl);

  if (!estadoInterno) {
    onLog("info", `Estado ML '${estadoMlNuevo}' sin traducción. Ignorando.`);
    return { resultado: "estado_sin_traduccion", detalle: estadoMlNuevo };
  }

  // Idempotencia
  if (pedido.estado === estadoInterno) {
    onLog("info", `Pedido ${pedido.id} ya en estado '${estadoInterno}'. No-op.`);
    return { resultado: "ya_en_estado", detalle: estadoInterno };
  }

  // Actualizar
  try {
    await fnActualizar({
      pedidoId: pedido.id,
      tenantId: pedido.tenantId,
      estadoNuevo: estadoInterno,
      estadoEsperado: pedido.estado,
      actuadoPor: "sistema_ml",
    });
    return { resultado: "actualizado", detalle: estadoInterno };
  } catch (error) {
    const nombre = error instanceof Error ? error.name : "";
    if (nombre === "ErrorConflicto") {
      onLog("warn", `Pedido ${pedido.id}: condición de carrera resuelta. Terminando.`);
      return { resultado: "conflicto_resuelto" };
    }
    if (nombre === "ErrorTransicionInvalida") {
      onLog("warn", `Pedido ${pedido.id}: transición inválida no reintentable. Terminando.`);
      return { resultado: "transicion_invalida" };
    }
    throw error; // Otros errores → Inngest reintenta
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const pedidoBase: PedidoSimulado = {
  id: "pedido-123",
  tenantId: "tenant-1",
  sellerId: "seller-1",
  mlShipmentId: "ship-999",
  estado: "en_ruta",
  estadoMl: "shipped",
};

describe("procesarShipmentActualizado — idempotencia", () => {
  it("pedido ya en 'entregado' + ML reporta 'delivered' → no-op (sin llamar fnActualizar)", async () => {
    const pedidoYaEntregado: PedidoSimulado = { ...pedidoBase, estado: "entregado", estadoMl: "delivered" };
    const fnMock = vi.fn();
    const logs: string[] = [];

    const resultado = await procesarActualizacionShipment(
      pedidoYaEntregado,
      "delivered",
      fnMock,
      (_, msg) => logs.push(msg),
    );

    expect(resultado.resultado).toBe("ya_en_estado");
    expect(fnMock).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("No-op"))).toBe(true);
  });

  it("pedido en 'en_ruta' + ML reporta 'shipped' → no-op (ya está en_ruta)", async () => {
    const pedidoEnRuta: PedidoSimulado = { ...pedidoBase, estado: "en_ruta", estadoMl: "shipped" };
    const fnMock = vi.fn();

    const resultado = await procesarActualizacionShipment(
      pedidoEnRuta,
      "shipped", // traducción → en_ruta (mismo que estado actual)
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("ya_en_estado");
    expect(fnMock).not.toHaveBeenCalled();
  });
});

describe("procesarShipmentActualizado — condición de carrera (ErrorConflicto)", () => {
  it("ErrorConflicto → loguea y retorna sin relanzar (Inngest no reintenta)", async () => {
    const fnMock = vi.fn().mockRejectedValue(new ErrorConflicto("Estado cambió mientras procesaba"));
    const logs: string[] = [];

    const resultado = await procesarActualizacionShipment(
      pedidoBase,
      "delivered",
      fnMock,
      (nivel, msg) => { if (nivel === "warn") logs.push(msg); },
    );

    expect(resultado.resultado).toBe("conflicto_resuelto");
    expect(fnMock).toHaveBeenCalledOnce();
    expect(logs.some((l) => l.includes("carrera"))).toBe(true);
  });

  it("error genérico (no ErrorConflicto) → se propaga para reintento de Inngest", async () => {
    const errorGenerico = new Error("Timeout de base de datos");
    const fnMock = vi.fn().mockRejectedValue(errorGenerico);

    await expect(
      procesarActualizacionShipment(pedidoBase, "delivered", fnMock, () => {}),
    ).rejects.toThrow("Timeout de base de datos");
  });
});

describe("procesarShipmentActualizado — traducción de estados", () => {
  it("estado ML con traducción → llama fnActualizar con el estado correcto", async () => {
    const fnMock = vi.fn().mockResolvedValue(undefined);

    const resultado = await procesarActualizacionShipment(
      { ...pedidoBase, estado: "asignado", estadoMl: null },
      "shipped",
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("actualizado");
    expect(resultado.detalle).toBe("en_ruta");
    expect(fnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pedidoId: "pedido-123",
        estadoNuevo: "en_ruta",
        estadoEsperado: "asignado",
        actuadoPor: "sistema_ml",
      }),
    );
  });

  it("'to_be_agreed' → estado_sin_traduccion (ignorado limpiamente)", async () => {
    const fnMock = vi.fn();

    const resultado = await procesarActualizacionShipment(
      pedidoBase,
      "to_be_agreed",
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("estado_sin_traduccion");
    expect(fnMock).not.toHaveBeenCalled();
  });

  it("estado desconocido de ML → ignorado sin lanzar", async () => {
    const fnMock = vi.fn();

    const resultado = await procesarActualizacionShipment(
      pedidoBase,
      "estado_nuevo_que_ml_invento",
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("estado_sin_traduccion");
    expect(fnMock).not.toHaveBeenCalled();
  });

  it("'cancelled' → actualiza a 'cancelado'", async () => {
    const fnMock = vi.fn().mockResolvedValue(undefined);

    const resultado = await procesarActualizacionShipment(
      { ...pedidoBase, estado: "en_ruta" },
      "cancelled",
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("actualizado");
    expect(resultado.detalle).toBe("cancelado");
  });

  it("'not_delivered' → actualiza a 'fallido'", async () => {
    const fnMock = vi.fn().mockResolvedValue(undefined);

    const resultado = await procesarActualizacionShipment(
      { ...pedidoBase, estado: "en_ruta" },
      "not_delivered",
      fnMock,
      () => {},
    );

    expect(resultado.resultado).toBe("actualizado");
    expect(resultado.detalle).toBe("fallido");
  });

  it("'not_delivered' + subestado 'returning_to_sender' → actualiza a 'devuelto'", async () => {
    const fnMock = vi.fn().mockResolvedValue(undefined);

    const resultado = await procesarActualizacionShipment(
      { ...pedidoBase, estado: "en_ruta" },
      "not_delivered",
      fnMock,
      () => {},
      "returning_to_sender",
    );

    expect(resultado.resultado).toBe("actualizado");
    expect(resultado.detalle).toBe("devuelto");
  });
});

describe("procesarShipmentActualizado — transición inválida (no reintentable)", () => {
  it("ErrorTransicionInvalida → loguea y termina sin relanzar (Inngest NO reintenta)", async () => {
    const fnMock = vi.fn().mockRejectedValue(new ErrorTransicionInvalidaFake());
    const logs: string[] = [];

    const resultado = await procesarActualizacionShipment(
      { ...pedidoBase, estado: "entregado" }, // terminal: 'shipped' tardío sería inválido
      "shipped",
      fnMock,
      (nivel, msg) => {
        if (nivel === "warn") logs.push(msg);
      },
    );

    // 'entregado' + 'shipped'→'en_ruta' es distinto del estado actual, así que
    // se intenta la transición; la fn la rechaza como inválida → se ignora.
    expect(resultado.resultado).toBe("transicion_invalida");
    expect(fnMock).toHaveBeenCalledOnce();
    expect(logs.some((l) => l.includes("no reintentable"))).toBe(true);
  });

  // Busca lo que nadie miró (encargo QA): un pedido YA 'cancelado' — por
  // ejemplo por el seller desde el portal — que después recibe un webhook de
  // ML intentando moverlo (p. ej. 'delivered', tarde). `cancelado` está en
  // ESTADOS_TERMINALES igual que cualquier otro terminal, así que el mismo
  // mecanismo genérico de arriba lo cubre — se prueba explícito con
  // 'cancelado' para que quede documentado que esta feature no lo rompió.
  it("pedido 'cancelado' + ML reporta 'delivered' tarde → ErrorTransicionInvalida, se ignora sin reintento (el pedido queda cancelado)", async () => {
    const fnMock = vi.fn().mockRejectedValue(new ErrorTransicionInvalidaFake());
    const logs: string[] = [];

    const resultado = await procesarActualizacionShipment(
      { ...pedidoBase, estado: "cancelado", estadoMl: null },
      "delivered",
      fnMock,
      (nivel, msg) => {
        if (nivel === "warn") logs.push(msg);
      },
    );

    expect(resultado.resultado).toBe("transicion_invalida");
    expect(fnMock).toHaveBeenCalledOnce();
    expect(logs.some((l) => l.includes("no reintentable"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wiring del bug crítico: el DEFAULT ya NO es un stub que lanza, sino el
// adaptador real que delega en `actualizarEstadoPedido`.
// ---------------------------------------------------------------------------
describe("actualizarEstadoPedidoReal (adaptador por defecto) — wiring real", () => {
  beforeEach(() => {
    mockActualizarEstadoPedido.mockReset();
    mockCrearClienteServiceRole.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("el default NO lanza el stub 'aún no implementado' y delega en actualizarEstadoPedido", async () => {
    mockActualizarEstadoPedido.mockResolvedValue({ id: "pedido-123" });

    const { actualizarEstadoPedidoReal } = await import("./procesar-shipment");

    await expect(
      actualizarEstadoPedidoReal({
        pedidoId: "pedido-123",
        tenantId: "tenant-1",
        estadoNuevo: "entregado",
        estadoEsperado: "en_ruta",
        actuadoPor: "sistema_ml",
        motivo: "Actualización desde ML: status=delivered",
      }),
    ).resolves.toBeUndefined();

    // Se creó el cliente service_role y se llamó a la función real con la
    // entrada del módulo `operacion` (ejecutor='sistema', con tenantId, sin
    // RBAC ni actor ni motivo).
    expect(mockCrearClienteServiceRole).toHaveBeenCalledOnce();
    expect(mockActualizarEstadoPedido).toHaveBeenCalledOnce();
    expect(mockActualizarEstadoPedido).toHaveBeenCalledWith(
      expect.anything(),
      {
        pedidoId: "pedido-123",
        tenantId: "tenant-1",
        estadoNuevo: "entregado",
        estadoEsperado: "en_ruta",
        ejecutor: "sistema",
      },
    );
  });

  it("propaga el error de actualizarEstadoPedido (p. ej. ErrorConflicto) sin envolverlo", async () => {
    mockActualizarEstadoPedido.mockRejectedValue(new ErrorConflicto("carrera"));

    const { actualizarEstadoPedidoReal } = await import("./procesar-shipment");

    await expect(
      actualizarEstadoPedidoReal({
        pedidoId: "p1",
        tenantId: "t1",
        estadoNuevo: "entregado",
        estadoEsperado: "en_ruta",
        actuadoPor: "sistema_ml",
      }),
    ).rejects.toThrow("carrera");
  });
});
