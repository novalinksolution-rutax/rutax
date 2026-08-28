import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de `actionAsignarPedidosEnBloque` — la Server Action de la
 * asignación en bloque (etapa 6). Foco:
 *   - RBAC: solo `puedeAsignarYReasignarPedidos` puede ejecutarla.
 *   - `tenantId` y `actorUsuarioId` SIEMPRE salen de la SESIÓN, nunca de los
 *     argumentos — no hay forma de que el llamador los sobrescriba.
 *   - La fecha es SIEMPRE `fechaLocalEnSantiago(new Date())`, calculada aquí
 *     (nunca recibida del cliente).
 *   - Manejo de errores: el mensaje del RPC llega intacto en `mensaje`, y un
 *     throw no tipado (no-Error) cae a un mensaje genérico.
 *   - Revalida las rutas correctas SOLO en el camino feliz.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  exigirSesionActual: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/operacion/asignacion-rpc", () => ({
  asignarPedidosEnBloqueRpc: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/modules/operacion/manifiestos-same-day", () => ({
  alinearPedidosNuevosConManifiestoEnRuta: vi.fn(),
}));

import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { asignarPedidosEnBloqueRpc } from "@/modules/operacion/asignacion-rpc";
import { alinearPedidosNuevosConManifiestoEnRuta } from "@/modules/operacion/manifiestos-same-day";
import { revalidatePath } from "next/cache";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { actionAsignarPedidosEnBloque } from "./actions";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import type { ResultadoAsignacionEnBloque } from "@/modules/operacion/asignacion-rpc";
import type { Rol } from "@/modules/identidad/roles";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const USUARIO_ID = "20000000-0000-0000-0000-000000000001";
const CONDUCTOR_1 = "30000000-0000-0000-0000-000000000001";
const MANIFIESTO_1 = "40000000-0000-0000-0000-000000000001";
const PEDIDO_1 = "50000000-0000-0000-0000-000000000001";
const PEDIDO_2 = "50000000-0000-0000-0000-000000000002";

function crearSesion(overrides: Partial<UsuarioActual> = {}): SesionActual {
  return {
    usuarioId: USUARIO_ID,
    email: "coordinador@example.com",
    nombreCompleto: "Coordinador",
    usuario: {
      tenantId: TENANT_A,
      tipoUsuario: "interno",
      sellerId: null,
      driverId: null,
      rol: "coordinador",
      estado: "activo",
      ...overrides,
      areasHabilitadas: overrides.areasHabilitadas ?? [...AREAS_PRODUCTO],
    },
  };
}

function resultadoOk(overrides: Partial<ResultadoAsignacionEnBloque> = {}): ResultadoAsignacionEnBloque {
  return {
    manifiestoId: MANIFIESTO_1,
    manifiestoCreado: true,
    totalSolicitados: 2,
    totalAsignados: 2,
    totalReasignados: 0,
    totalOmitidos: 0,
    omitidos: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    { marca: "cliente-service-role" } as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
  vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion());
  vi.mocked(alinearPedidosNuevosConManifiestoEnRuta).mockResolvedValue(false);
  // Fija "ahora" para que `fechaLocalEnSantiago(new Date())` sea determinista
  // tanto dentro de la acción como en la expectativa de la prueba — sin esto,
  // una corrida justo al cruce de medianoche de Santiago sería intermitente.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T18:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("actionAsignarPedidosEnBloque — RBAC", () => {
  it("rechaza a un rol SIN asignar_y_reasignar_pedidos (administracion) sin llamar al RPC", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ rol: "administracion" }));

    const resultado = await actionAsignarPedidosEnBloque(CONDUCTOR_1, [PEDIDO_1]);

    expect(resultado).toEqual({ ok: false, mensaje: "No tienes permiso para asignar pedidos." });
    expect(asignarPedidosEnBloqueRpc).not.toHaveBeenCalled();
  });

  it("permite a los tres roles que SÍ tienen la capacidad (dueno, supervisor, coordinador)", async () => {
    vi.mocked(asignarPedidosEnBloqueRpc).mockResolvedValue(resultadoOk());

    const rolesConCapacidad: Rol[] = ["dueno", "supervisor", "coordinador"];
    for (const rol of rolesConCapacidad) {
      vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ rol }));
      const resultado = await actionAsignarPedidosEnBloque(CONDUCTOR_1, [PEDIDO_1]);
      expect(resultado.ok).toBe(true);
    }
    expect(asignarPedidosEnBloqueRpc).toHaveBeenCalledTimes(rolesConCapacidad.length);
  });
});

describe("actionAsignarPedidosEnBloque — validaciones antes de llamar al RPC", () => {
  it("sin tenantId en la sesión, no llama al RPC", async () => {
    const sesionSinTenant = crearSesion();
    vi.mocked(exigirSesionActual).mockResolvedValue({
      ...sesionSinTenant,
      usuario: { ...sesionSinTenant.usuario, tenantId: null },
    });

    const resultado = await actionAsignarPedidosEnBloque(CONDUCTOR_1, [PEDIDO_1]);

    expect(resultado).toEqual({ ok: false, mensaje: "No hay sesión activa." });
    expect(asignarPedidosEnBloqueRpc).not.toHaveBeenCalled();
  });

  it("sin conductorId, no llama al RPC", async () => {
    const resultado = await actionAsignarPedidosEnBloque("", [PEDIDO_1]);

    expect(resultado).toEqual({ ok: false, mensaje: "Debes elegir un conductor." });
    expect(asignarPedidosEnBloqueRpc).not.toHaveBeenCalled();
  });

  it("con pedidoIds vacío, no llama al RPC", async () => {
    const resultado = await actionAsignarPedidosEnBloque(CONDUCTOR_1, []);

    expect(resultado).toEqual({ ok: false, mensaje: "Debes seleccionar al menos un pedido." });
    expect(asignarPedidosEnBloqueRpc).not.toHaveBeenCalled();
  });
});

describe("actionAsignarPedidosEnBloque — camino feliz", () => {
  it("llama al RPC con tenantId/actorUsuarioId de la SESIÓN y la fecha de Santiago calculada aquí, y revalida las rutas", async () => {
    vi.mocked(asignarPedidosEnBloqueRpc).mockResolvedValue(resultadoOk());

    const resultado = await actionAsignarPedidosEnBloque(CONDUCTOR_1, [PEDIDO_1, PEDIDO_2]);

    expect(asignarPedidosEnBloqueRpc).toHaveBeenCalledTimes(1);
    const [clienteUsado, entrada] = vi.mocked(asignarPedidosEnBloqueRpc).mock.calls[0];
    expect(clienteUsado).toEqual({ marca: "cliente-service-role" });
    expect(entrada).toEqual({
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      fecha: fechaLocalEnSantiago(new Date()),
      pedidoIds: [PEDIDO_1, PEDIDO_2],
      actorUsuarioId: USUARIO_ID,
    });

    expect(revalidatePath).toHaveBeenCalledWith("/preparacion/asignar");
    expect(revalidatePath).toHaveBeenCalledWith("/preparacion");
    expect(revalidatePath).toHaveBeenCalledWith("/manifiestos");
    expect(revalidatePath).toHaveBeenCalledWith(`/manifiestos/${MANIFIESTO_1}`);

    expect(resultado).toEqual({
      ok: true,
      datos: { ...resultadoOk(), puestosEnRuta: false },
    });
  });

  // ---------------------------------------------------------------------------
  // Puesta al día con un manifiesto que ya va en la calle (2026-08-27)
  // ---------------------------------------------------------------------------

  it("🔴 pone al día las paradas nuevas con el manifiesto DEVUELTO por el RPC", async () => {
    // Sin esto quedaban en `asignado` con el manifiesto ya `en_ruta`, y
    // `asignado → entregado` es inválida: el conductor las veía en su lista y no
    // podía entregarlas. El manifiesto tiene que salir del RPC y no calcularse
    // aparte — el RPC puede haber reutilizado uno o haber creado otro.
    vi.mocked(asignarPedidosEnBloqueRpc).mockResolvedValue(resultadoOk());
    vi.mocked(alinearPedidosNuevosConManifiestoEnRuta).mockResolvedValue(true);

    const resultado = await actionAsignarPedidosEnBloque(CONDUCTOR_1, [PEDIDO_1]);

    const [, entrada] = vi.mocked(alinearPedidosNuevosConManifiestoEnRuta).mock.calls[0];
    expect(entrada).toMatchObject({
      manifiestoId: MANIFIESTO_1,
      driverId: CONDUCTOR_1,
    });
    expect(resultado).toMatchObject({ ok: true, datos: { puestosEnRuta: true } });
  });

  it("🔴 si la puesta al día falla, la asignación NO se pierde", async () => {
    // Corre fuera de la transacción del RPC: los pedidos ya quedaron asignados y
    // eso es lo que no puede deshacerse por un fallo del paso siguiente.
    vi.mocked(asignarPedidosEnBloqueRpc).mockResolvedValue(resultadoOk());
    vi.mocked(alinearPedidosNuevosConManifiestoEnRuta).mockRejectedValue(
      new Error("se cayó la lectura del manifiesto"),
    );

    const resultado = await actionAsignarPedidosEnBloque(CONDUCTOR_1, [PEDIDO_1]);

    expect(resultado).toMatchObject({ ok: true, datos: { puestosEnRuta: false } });
    expect(revalidatePath).toHaveBeenCalledWith("/preparacion/asignar");
  });
});

describe("actionAsignarPedidosEnBloque — manejo de errores", () => {
  it("un Error del RPC llega intacto en `mensaje`, y NO revalida nada", async () => {
    vi.mocked(asignarPedidosEnBloqueRpc).mockRejectedValue(
      new Error("El conductor no existe o no pertenece a tu equipo."),
    );

    const resultado = await actionAsignarPedidosEnBloque(CONDUCTOR_1, [PEDIDO_1]);

    expect(resultado).toEqual({
      ok: false,
      mensaje: "El conductor no existe o no pertenece a tu equipo.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("un throw no-Error cae al mensaje genérico", async () => {
    vi.mocked(asignarPedidosEnBloqueRpc).mockRejectedValue("boom");

    const resultado = await actionAsignarPedidosEnBloque(CONDUCTOR_1, [PEDIDO_1]);

    expect(resultado).toEqual({ ok: false, mensaje: "Error al asignar los pedidos." });
  });
});
