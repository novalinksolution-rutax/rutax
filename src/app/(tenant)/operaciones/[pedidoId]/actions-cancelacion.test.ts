/**
 * Pruebas de la Server Action `accionCancelarPedido` (rol interno).
 *
 * ANTES de esta ronda de QA, esta Server Action no tenía NINGUNA prueba propia
 * — solo las funciones de `operacion`/`dinero` que envuelve estaban probadas.
 * El foco es el ENSAMBLE de la capa de aplicación (docs/arquitectura/
 * edicion-y-cancelacion-de-pedidos.md §4.2/§7.3), que es justamente la
 * superficie que un atacante o un bug de UI puede golpear directamente:
 *   1. RBAC en la propia Server Action (no solo en la UI).
 *   2. Aislamiento de TENANT: el cliente de SESIÓN decide la pertenencia — un
 *      pedido de otro tenant nunca llega a `cancelarPedido`.
 *   3. El patrón de dos clientes: `clienteSesion` SOLO para `obtenerPedido`;
 *      `cancelarPedido` recibe SIEMPRE el cliente `service_role`.
 *   4. El preflight de dinero bloquea con `requiereConfirmacion` cuando la
 *      anulación no es automática, y NO ejecuta la cancelación hasta que el
 *      formulario venga con `confirmado=true`.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  exigirSesionActual: vi.fn(),
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

import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerPedido, cancelarPedido } from "@/modules/operacion/index";
import { preflightCancelacionPedido } from "@/modules/dinero/preflight-cancelacion";
import { accionCancelarPedido } from "./actions-cancelacion";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import type { Pedido } from "@/modules/operacion/tipos";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "20000000-0000-0000-0000-000000000002";
const PEDIDO_1 = "30000000-0000-0000-0000-000000000001";
const USUARIO_ID = "40000000-0000-0000-0000-000000000001";

function crearUsuario(overrides: Partial<UsuarioActual> = {}): UsuarioActual {
  return {
    tenantId: TENANT_A,
    tipoUsuario: "interno",
    sellerId: null,
    driverId: null,
    rol: "supervisor",
    estado: "activo",
    ...overrides,
  };
}

function crearSesion(overrides: Partial<UsuarioActual> = {}): SesionActual {
  return {
    usuarioId: USUARIO_ID,
    email: "supervisor@example.com",
    nombreCompleto: "Supervisor de Prueba",
    usuario: crearUsuario(overrides),
  };
}

function pedidoFalso(overrides: Partial<Pedido> = {}): Pedido {
  return {
    id: PEDIDO_1,
    tenantId: TENANT_A,
    sellerId: "seller-1",
    tipoPedido: "same_day",
    origen: "same_day_manual",
    mlOrderId: null,
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

describe("accionCancelarPedido — RBAC", () => {
  it("un rol sin ajustar_operacion_diaria (p. ej. coordinador) es rechazado, y NUNCA llama a obtenerPedido", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ rol: "coordinador" }));

    const resultado = await accionCancelarPedido(
      formulario({ pedidoId: PEDIDO_1, motivo: "Dirección duplicada" }),
    );

    expect(resultado).toEqual({ error: "No tienes permiso para cancelar pedidos." });
    expect(obtenerPedido).not.toHaveBeenCalled();
    expect(cancelarPedido).not.toHaveBeenCalled();
  });
});

describe("accionCancelarPedido — validación de motivo (defensa en la capa de aplicación)", () => {
  it("motivo de menos de 10 caracteres es rechazado ANTES de leer el pedido", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion());

    const resultado = await accionCancelarPedido(formulario({ pedidoId: PEDIDO_1, motivo: "corto" }));

    expect(resultado).toEqual({
      error: "El motivo debe tener al menos 10 caracteres.",
    });
    expect(obtenerPedido).not.toHaveBeenCalled();
  });
});

describe("accionCancelarPedido — aislamiento de TENANT (§4.2)", () => {
  it("obtenerPedido con el cliente de SESIÓN devuelve null (pedido de otro tenant) → 'Pedido no encontrado.', sin llamar a cancelarPedido", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ tenantId: TENANT_A }));
    vi.mocked(obtenerPedido).mockResolvedValue(null); // RLS decide: no existe en ESTE tenant

    const resultado = await accionCancelarPedido(
      formulario({ pedidoId: PEDIDO_1, motivo: "Intento sobre otro tenant" }),
    );

    expect(resultado).toEqual({ error: "Pedido no encontrado." });
    // La lectura de pertenencia se hizo con el cliente de SESIÓN, no con service_role.
    expect(obtenerPedido).toHaveBeenCalledWith(CLIENTE_SESION_FALSO, PEDIDO_1, TENANT_A);
    expect(cancelarPedido).not.toHaveBeenCalled();
    expect(preflightCancelacionPedido).not.toHaveBeenCalled();
  });

  it("el mensaje de 'no encontrado' es IDÉNTICO tanto si el pedido no existe como si es de otro tenant (no se filtra existencia)", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ tenantId: OTRO_TENANT }));
    vi.mocked(obtenerPedido).mockResolvedValue(null);

    const resultadoAjeno = await accionCancelarPedido(
      formulario({ pedidoId: PEDIDO_1, motivo: "Pedido que pertenece a otro tenant" }),
    );
    const resultadoInexistente = await accionCancelarPedido(
      formulario({ pedidoId: "id-que-no-existe", motivo: "Pedido que jamás existió" }),
    );

    expect(resultadoAjeno).toEqual(resultadoInexistente);
    expect(resultadoAjeno).toEqual({ error: "Pedido no encontrado." });
  });
});

describe("accionCancelarPedido — nunca se pasa el cliente de sesión a cancelarPedido (regresión 0164a56)", () => {
  it("camino feliz: cancelarPedido recibe el cliente service_role, NUNCA el de sesión", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion());
    vi.mocked(obtenerPedido).mockResolvedValue(pedidoFalso());
    vi.mocked(cancelarPedido).mockResolvedValue(pedidoFalso({ estado: "cancelado" }));

    const resultado = await accionCancelarPedido(
      formulario({ pedidoId: PEDIDO_1, motivo: "Dirección duplicada, cliente pidió cancelar" }),
    );

    expect(resultado).toEqual({ exito: true });
    expect(cancelarPedido).toHaveBeenCalledTimes(1);
    const [clienteRecibido, entrada] = vi.mocked(cancelarPedido).mock.calls[0];
    expect(clienteRecibido).toBe(CLIENTE_SERVICE_ROLE_FALSO);
    expect(clienteRecibido).not.toBe(CLIENTE_SESION_FALSO);
    expect(entrada).toMatchObject({
      pedidoId: PEDIDO_1,
      tenantId: TENANT_A,
      estadoEsperado: "pendiente_asignacion",
      ejecutor: "interno",
      actuadoPorUsuarioId: USUARIO_ID,
    });
  });
});

describe("accionCancelarPedido — preflight de dinero (D-A3, nunca bloquea, solo avisa)", () => {
  it("anulacionAutomatica=false y sin confirmar → requiereConfirmacion con las advertencias, SIN ejecutar la cancelación", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion());
    vi.mocked(obtenerPedido).mockResolvedValue(pedidoFalso());
    vi.mocked(preflightCancelacionPedido).mockResolvedValue({
      anulacionAutomatica: false,
      advertencias: [
        {
          codigo: "linea_cobro_no_anulable",
          categoria: "advierte",
          titulo: "El cobro ya está en un período facturado",
          detalle: "...",
          meta: {},
        },
      ],
    });

    const resultado = await accionCancelarPedido(
      formulario({ pedidoId: PEDIDO_1, motivo: "Cancelar con línea facturada" }),
    );

    expect(resultado).toMatchObject({ requiereConfirmacion: true });
    expect(cancelarPedido).not.toHaveBeenCalled();
  });

  it("anulacionAutomatica=false + confirmado=true → SÍ ejecuta la cancelación", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion());
    vi.mocked(obtenerPedido).mockResolvedValue(pedidoFalso());
    vi.mocked(cancelarPedido).mockResolvedValue(pedidoFalso({ estado: "cancelado" }));
    vi.mocked(preflightCancelacionPedido).mockResolvedValue({
      anulacionAutomatica: false,
      advertencias: [{ codigo: "estado_invalido", categoria: "advierte", titulo: "t", detalle: "d", meta: {} }],
    });

    const resultado = await accionCancelarPedido(
      formulario({ pedidoId: PEDIDO_1, motivo: "Confirmado tras ver advertencia", confirmado: "true" }),
    );

    expect(resultado).toEqual({ exito: true });
    expect(cancelarPedido).toHaveBeenCalledTimes(1);
  });
});

describe("accionCancelarPedido — errores de cancelarPedido se propagan como mensaje, no crashean la acción", () => {
  it("ErrorTransicionInvalida (p. ej. Flex vivo) se devuelve como { error }", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion());
    vi.mocked(obtenerPedido).mockResolvedValue(pedidoFalso({ tipoPedido: "flex" }));
    vi.mocked(cancelarPedido).mockRejectedValue(
      new Error("Solo se pueden cancelar pedidos same-day desde aquí — un Flex vivo lo gobierna Mercado Envíos."),
    );

    const resultado = await accionCancelarPedido(
      formulario({ pedidoId: PEDIDO_1, motivo: "Intento sobre un Flex vivo" }),
    );

    expect(resultado).toEqual({
      error: "Solo se pueden cancelar pedidos same-day desde aquí — un Flex vivo lo gobierna Mercado Envíos.",
    });
  });
});
