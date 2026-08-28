/**
 * Pruebas de la Server Action `accionCancelarPedidoSeller` (portal del seller).
 *
 * Foco explícito de QA (encargo, punto 3 — "Aislamiento"): un seller A que
 * intenta cancelar un pedido de un seller B por esta Server Action debe
 * recibir "Pedido no encontrado", SIN efecto y SIN que el mensaje distinga
 * entre "no existe" y "no es tuyo". Antes de esta ronda, esta Server Action
 * no tenía NINGUNA prueba propia — solo `cancelarPedido` (el módulo que
 * envuelve) estaba probado a este nivel.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  obtenerSesionActual: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/operacion/index", () => ({
  obtenerPedido: vi.fn(),
  cancelarPedido: vi.fn(),
}));

vi.mock("@/modules/dinero/preflight-cancelacion", () => ({
  preflightCancelacionPedido: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerPedido, cancelarPedido } from "@/modules/operacion/index";
import { preflightCancelacionPedido } from "@/modules/dinero/preflight-cancelacion";
import { accionCancelarPedidoSeller } from "./actions-cancelacion";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import type { Pedido } from "@/modules/operacion/tipos";
import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const SELLER_A = "11111111-1111-1111-1111-111111111111";
const PEDIDO_DE_B = "30000000-0000-0000-0000-000000000002";
const USUARIO_SELLER_A = "40000000-0000-0000-0000-000000000001";

function crearSesionSeller(overrides: Partial<UsuarioActual> = {}): SesionActual {
  return {
    usuarioId: USUARIO_SELLER_A,
    email: "sellerA@example.com",
    nombreCompleto: "Seller A",
    usuario: {
      tenantId: TENANT_A,
      tipoUsuario: "seller",
      sellerId: SELLER_A,
      driverId: null,
      rol: "seller",
      estado: "activo",
      areasHabilitadas: [...AREAS_PRODUCTO],
      ...overrides,
    },
  };
}

function pedidoFalso(overrides: Partial<Pedido> = {}): Pedido {
  return {
    id: PEDIDO_DE_B,
    tenantId: TENANT_A,
    sellerId: SELLER_A,
    tipoPedido: "same_day",
    fuente: "rutax_manual",
    origen: "same_day_manual",
    mlOrderId: null,
    idExterno: null,
    referenciaExterna: null,
    mlShipmentId: null,
    estado: "pendiente_asignacion",
    estadoMl: null,
    subestadoMl: null,
    ultimaSyncMlEn: null,
    driverIdAsignado: null,
    destinatarioNombre: "Cliente",
    destinatarioDireccion: "Calle 1",
    destinatarioComuna: "Maipú",
    destinatarioTelefono: null,
    instruccionesEntrega: null,
    fechaCompromiso: null,
    tarifaAplicableId: null,
    montoCobroClp: null,
    montoLiquidacionClp: null,
    cobroGenerado: false,
    liquidacionGenerada: false,
    notasInternas: null,
    creadoEn: "2026-08-11T10:00:00.000Z",
    actualizadoEn: "2026-08-11T10:00:00.000Z",
    lat: null,
    long: null,
    geoEstado: "pendiente",
    geoConfianza: null,
    geocodificadoEn: null,
    coberturaEstado: "pendiente",
    fechaCompromisoHora: null,
    corteRiesgo: false,
    slaCumplido: null,
    trackingToken: null,
    codigoInterno: null,
    canceladoEn: null,
    canceladoPorUsuarioId: null,
    motivoCancelacion: null,
    ...overrides,
  };
}

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

const CLIENTE_SESION_FALSO = { marca: "cliente-sesion" };
const CLIENTE_SERVICE_ROLE_FALSO = { marca: "cliente-service-role" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue(
    CLIENTE_SESION_FALSO as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    CLIENTE_SERVICE_ROLE_FALSO as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
  vi.mocked(preflightCancelacionPedido).mockResolvedValue({
    anulacionAutomatica: true,
    advertencias: [],
  });
});

describe("accionCancelarPedidoSeller — aislamiento seller A vs seller B (encargo, punto 3)", () => {
  it("seller A intenta cancelar un pedido de seller B ⇒ 'Pedido no encontrado.', SIN efecto", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesionSeller());
    // RLS (P2) decide: el SELECT hecho con el cliente de SESIÓN de seller A
    // nunca puede devolver una fila que pertenece a seller B — se simula null.
    vi.mocked(obtenerPedido).mockResolvedValue(null);

    const resultado = await accionCancelarPedidoSeller(
      formulario({ pedidoId: PEDIDO_DE_B, motivo: "Intento de cancelar pedido ajeno" }),
    );

    expect(resultado).toEqual({ error: "Pedido no encontrado." });
    expect(cancelarPedido).not.toHaveBeenCalled();
    expect(preflightCancelacionPedido).not.toHaveBeenCalled();
    // La lectura de pertenencia se hizo con el cliente de SESIÓN — RLS decide,
    // no un filtro de aplicación.
    expect(obtenerPedido).toHaveBeenCalledWith(CLIENTE_SESION_FALSO, PEDIDO_DE_B, TENANT_A);
  });

  it("el mensaje NO distingue entre 'no existe' y 'es de otro seller' — mismo resultado exacto en ambos casos", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesionSeller());
    vi.mocked(obtenerPedido).mockResolvedValue(null);

    const resultadoAjeno = await accionCancelarPedidoSeller(
      formulario({ pedidoId: PEDIDO_DE_B, motivo: "Pedido real, pero de otro seller" }),
    );
    const resultadoInexistente = await accionCancelarPedidoSeller(
      formulario({ pedidoId: "id-que-jamas-existio", motivo: "Este pedido no existe en ningún tenant" }),
    );

    expect(resultadoAjeno).toEqual(resultadoInexistente);
    expect(resultadoAjeno).toEqual({ error: "Pedido no encontrado." });
  });

  it("si por error obtenerPedido devolviera el pedido ajeno, cancelarPedido sigue llevando sellerId=A como guarda atómica en el WHERE", async () => {
    // Defensa en profundidad (§4.2): aunque la capa de lectura fallara, la
    // escritura NUNCA debe poder tocar la fila de otro seller porque
    // `cancelarPedido` agrega `sellerId` al WHERE del UPDATE.
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesionSeller());
    vi.mocked(obtenerPedido).mockResolvedValue(pedidoFalso({ sellerId: SELLER_A }));
    vi.mocked(cancelarPedido).mockResolvedValue(pedidoFalso({ estado: "cancelado" }));

    await accionCancelarPedidoSeller(
      formulario({ pedidoId: PEDIDO_DE_B, motivo: "Cancelación normal de mi propio pedido" }),
    );

    expect(cancelarPedido).toHaveBeenCalledTimes(1);
    const [clienteRecibido, entrada] = vi.mocked(cancelarPedido).mock.calls[0];
    expect(clienteRecibido).toBe(CLIENTE_SERVICE_ROLE_FALSO);
    expect(entrada).toMatchObject({ ejecutor: "seller", sellerId: SELLER_A });
  });
});

describe("accionCancelarPedidoSeller — sesión y RBAC", () => {
  it("un usuario interno (no seller) es redirigido a /portal, sin llamar a obtenerPedido", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue({
      usuarioId: "otro-usuario",
      email: null,
      nombreCompleto: null,
      usuario: {
        tenantId: TENANT_A,
        tipoUsuario: "interno",
        sellerId: null,
        driverId: null,
        rol: "supervisor",
        estado: "activo",
        areasHabilitadas: [...AREAS_PRODUCTO],
      },
    });

    await expect(
      accionCancelarPedidoSeller(formulario({ pedidoId: PEDIDO_DE_B, motivo: "Interno usando la ruta del seller" })),
    ).rejects.toThrow("REDIRECT:/portal");

    expect(obtenerPedido).not.toHaveBeenCalled();
  });

  it("motivo corto (<10 caracteres) se rechaza antes de leer el pedido", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesionSeller());

    const resultado = await accionCancelarPedidoSeller(formulario({ pedidoId: PEDIDO_DE_B, motivo: "corto" }));

    expect(resultado).toEqual({ error: "El motivo debe tener al menos 10 caracteres." });
    expect(obtenerPedido).not.toHaveBeenCalled();
  });
});

describe("accionCancelarPedidoSeller — camino feliz", () => {
  it("cancela SU PROPIO pedido correctamente, con ejecutor='seller' y sellerId de la sesión", async () => {
    vi.mocked(obtenerSesionActual).mockResolvedValue(crearSesionSeller());
    vi.mocked(obtenerPedido).mockResolvedValue(pedidoFalso({ sellerId: SELLER_A, estado: "pendiente_asignacion" }));
    vi.mocked(cancelarPedido).mockResolvedValue(pedidoFalso({ estado: "cancelado" }));

    const resultado = await accionCancelarPedidoSeller(
      formulario({ pedidoId: PEDIDO_DE_B, motivo: "Ya no necesito este envío" }),
    );

    expect(resultado).toEqual({ exito: true });
    const [, entrada] = vi.mocked(cancelarPedido).mock.calls[0];
    expect(entrada).toMatchObject({
      ejecutor: "seller",
      sellerId: SELLER_A,
      actuadoPorUsuarioId: USUARIO_SELLER_A,
      estadoEsperado: "pendiente_asignacion",
    });
  });
});
