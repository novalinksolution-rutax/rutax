/**
 * Pruebas de `actionCambiarEstadoPedido` — el drawer genérico "Cambiar estado".
 *
 * Foco explícito de QA (encargo, punto 4 — "El agujero que se acaba de
 * cerrar"): el drawer genérico ofrecía `cancelado` sin la barrera `same_day`
 * ni el preflight de dinero. Se corrigió en dos capas: el selector de la UI
 * (no probado aquí, es presentación) y un guard en esta misma Server Action
 * (`docs/arquitectura/edicion-y-cancelacion-de-pedidos.md`, commit `20d16c4`).
 * Esta suite se salta la UI a propósito y llama la Server Action DIRECTO, con
 * un pedido Flex vivo y con los tres orígenes nuevos — exactamente lo que pide
 * el encargo — para demostrar que el guard cierra el hueco incluso si alguien
 * (o un bug futuro del componente) intenta la ruta vieja.
 *
 * También verifica la REGRESIÓN que NO debe ocurrir: la válvula preexistente
 * `fallido → cancelado` (para un Flex atascado) debe seguir funcionando
 * exactamente igual después de agregar el guard.
 *
 * Antes de esta ronda de QA, `actions.ts` no tenía ninguna prueba propia.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  exigirSesionActual: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/operacion/index", () => ({
  actualizarEstadoPedido: vi.fn(),
  crearPedidoSameDay: vi.fn(),
  abrirIncidencia: vi.fn(),
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
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { actualizarEstadoPedido } from "@/modules/operacion/index";
import { actionCambiarEstadoPedido } from "./actions";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import type { EstadoPedido } from "@/modules/operacion/tipos";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const PEDIDO_1 = "20000000-0000-0000-0000-000000000001";
const USUARIO_ID = "30000000-0000-0000-0000-000000000001";

function crearSesion(overrides: Partial<UsuarioActual> = {}): SesionActual {
  return {
    usuarioId: USUARIO_ID,
    email: "supervisor@example.com",
    nombreCompleto: "Supervisor",
    usuario: {
      tenantId: TENANT_A,
      tipoUsuario: "interno",
      sellerId: null,
      driverId: null,
      rol: "supervisor",
      estado: "activo",
      ...overrides,
    },
  };
}

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    { marca: "cliente-service-role" } as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
  vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion());
});

// Los TRES orígenes nuevos del delta de cancelación (§3.3 del doc). El guard
// debe rechazarlos SIEMPRE, independiente de tipo_pedido — la ruta genérica
// no sabe si el pedido es Flex o same-day, así que fuerza pasar por la acción
// dedicada en los dos casos (same-day también).
const ORIGENES_NUEVOS: EstadoPedido[] = ["pendiente_asignacion", "asignado", "en_ruta"];

describe("actionCambiarEstadoPedido — guard same_day para 'cancelado' (encargo, punto 4)", () => {
  it.each(ORIGENES_NUEVOS)(
    "bloquea %s → cancelado incluso saltándose la UI, con un pedido Flex vivo — nunca toca actualizarEstadoPedido",
    async (estadoEsperado) => {
      const resultado = await actionCambiarEstadoPedido(
        formulario({
          pedidoId: PEDIDO_1,
          estadoEsperado,
          estadoNuevo: "cancelado",
          motivo: "Intento de saltarse el guard llamando la Server Action directo",
        }),
      );

      expect(resultado).toEqual({
        error:
          "Para cancelar este pedido usa el botón \"Cancelar pedido\": valida que sea same-day y revisa el estado del dinero antes de confirmar.",
      });
      expect(actualizarEstadoPedido).not.toHaveBeenCalled();
    },
  );

  it.each(ORIGENES_NUEVOS)(
    "bloquea %s → cancelado también para un pedido same_day (el guard no distingue fuente a propósito)",
    async (estadoEsperado) => {
      // El guard de esta ruta genérica no conoce tipo_pedido (no lo lee de BD
      // antes de decidir) — bloquea siempre para forzar la acción dedicada,
      // que sí valida same_day + preflight de dinero. Se prueba explícito para
      // que quede documentado: NO es un descuido, es la decisión de diseño.
      const resultado = await actionCambiarEstadoPedido(
        formulario({
          pedidoId: PEDIDO_1,
          estadoEsperado,
          estadoNuevo: "cancelado",
          motivo: "Un pedido same-day también debe pasar por la acción dedicada",
        }),
      );

      expect(resultado).toMatchObject({ error: expect.stringContaining("Cancelar pedido") });
      expect(actualizarEstadoPedido).not.toHaveBeenCalled();
    },
  );
});

describe("actionCambiarEstadoPedido — la válvula fallido→cancelado NO debe romperse (regresión)", () => {
  it("fallido → cancelado SIGUE funcionando (válvula existente para un Flex atascado, §3.2)", async () => {
    vi.mocked(actualizarEstadoPedido).mockResolvedValue({ id: PEDIDO_1, estado: "cancelado" } as never);

    const resultado = await actionCambiarEstadoPedido(
      formulario({
        pedidoId: PEDIDO_1,
        estadoEsperado: "fallido",
        estadoNuevo: "cancelado",
        motivo: "Sin reintento posible, Flex atascado hace 3 semanas",
      }),
    );

    expect(resultado).toEqual({ exito: true });
    expect(actualizarEstadoPedido).toHaveBeenCalledTimes(1);
    const [, entrada] = vi.mocked(actualizarEstadoPedido).mock.calls[0];
    expect(entrada).toMatchObject({
      pedidoId: PEDIDO_1,
      estadoNuevo: "cancelado",
      estadoEsperado: "fallido",
      ejecutor: "interno",
    });
  });

  it("fallido_manual → cancelado también sigue permitido por esta ruta (simetría, §3.3)", async () => {
    vi.mocked(actualizarEstadoPedido).mockResolvedValue({ id: PEDIDO_1, estado: "cancelado" } as never);

    const resultado = await actionCambiarEstadoPedido(
      formulario({
        pedidoId: PEDIDO_1,
        estadoEsperado: "fallido_manual",
        estadoNuevo: "cancelado",
        motivo: "Cierre definitivo desde fallo manual, sin barrera nueva",
      }),
    );

    expect(resultado).toEqual({ exito: true });
    expect(actualizarEstadoPedido).toHaveBeenCalledTimes(1);
  });
});

describe("actionCambiarEstadoPedido — RBAC", () => {
  it("un rol sin ajustar_operacion_diaria es rechazado antes de cualquier lógica de guard", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ rol: "coordinador" }));

    const resultado = await actionCambiarEstadoPedido(
      formulario({
        pedidoId: PEDIDO_1,
        estadoEsperado: "fallido",
        estadoNuevo: "cancelado",
        motivo: "Coordinador sin capacidad intentando cerrar",
      }),
    );

    expect(resultado).toEqual({ error: "No tienes permiso para cambiar estados manualmente." });
    expect(actualizarEstadoPedido).not.toHaveBeenCalled();
  });
});

describe("actionCambiarEstadoPedido — transiciones no relacionadas con cancelado no pasan por el guard", () => {
  it("asignado → en_ruta (corrección manual normal) no se bloquea", async () => {
    vi.mocked(actualizarEstadoPedido).mockResolvedValue({ id: PEDIDO_1, estado: "en_ruta" } as never);

    const resultado = await actionCambiarEstadoPedido(
      formulario({
        pedidoId: PEDIDO_1,
        estadoEsperado: "asignado",
        estadoNuevo: "en_ruta",
        motivo: "El conductor salió y no marcó en la app a tiempo",
      }),
    );

    expect(resultado).toEqual({ exito: true });
    expect(actualizarEstadoPedido).toHaveBeenCalledTimes(1);
  });
});
