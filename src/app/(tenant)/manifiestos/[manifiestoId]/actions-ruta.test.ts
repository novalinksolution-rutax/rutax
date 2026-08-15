/**
 * Pruebas de las Server Actions de la ruta del manifiesto (etapa 7):
 * `accionCalcularRuta` y `accionGuardarOrdenManual`.
 *
 * Foco:
 *   - RBAC: solo `puedeAsignarYReasignarPedidos` puede ejecutarlas.
 *   - `requiereRecarga: true` cuando el RPC devuelve `ErrorSecuenciaDesincronizada`
 *     (P0001) — la pantalla debe ofrecer RECARGAR, no reintentar: reintentar con
 *     la misma lista falla exactamente igual.
 *   - `ErrorSinBodegaOrigen` se deja pasar tal cual, SIN `requiereRecarga`.
 *   - `tenantId`/`actorUsuarioId` salen SIEMPRE de la sesión, nunca de los
 *     argumentos.
 *   - El resumen de `accionGuardarOrdenManual` nunca trae `distanciaTotalM` ni
 *     `nombreOrigen` (el reordenamiento manual no vuelve a llamar al motor).
 *
 * Molde: `preparacion/asignar/actions.test.ts` (mocks de
 * `exigirSesionActual` / `crearClienteServiceRole` / `next/cache`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  exigirSesionActual: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/operacion/ruta-manifiesto", async (importActual) => {
  const actual = await importActual<typeof import("@/modules/operacion/ruta-manifiesto")>();
  return {
    ...actual,
    calcularYAplicarRutaManifiesto: vi.fn(),
  };
});

vi.mock("@/modules/operacion/secuencia-paradas-rpc", async (importActual) => {
  const actual =
    await importActual<typeof import("@/modules/operacion/secuencia-paradas-rpc")>();
  return {
    ...actual,
    aplicarSecuenciaParadasRpc: vi.fn(),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  calcularYAplicarRutaManifiesto,
  ErrorSinBodegaOrigen,
} from "@/modules/operacion/ruta-manifiesto";
import {
  aplicarSecuenciaParadasRpc,
  ErrorSecuenciaDesincronizada,
} from "@/modules/operacion/secuencia-paradas-rpc";
import { revalidatePath } from "next/cache";
import { accionCalcularRuta, accionGuardarOrdenManual } from "./actions-ruta";
import type { SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import type { Rol } from "@/modules/identidad/roles";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const USUARIO_ID = "20000000-0000-0000-0000-000000000001";
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
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    { marca: "cliente-service-role" } as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
  vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion());
});

// =============================================================================
// RBAC — accionCalcularRuta
// =============================================================================

describe("accionCalcularRuta — RBAC", () => {
  it("rechaza a un rol SIN asignar_y_reasignar_pedidos (administracion), sin llamar al motor", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ rol: "administracion" }));

    const resultado = await accionCalcularRuta(MANIFIESTO_1);

    expect(resultado).toEqual({
      ok: false,
      mensaje: "No tienes permiso para calcular la ruta.",
    });
    expect(calcularYAplicarRutaManifiesto).not.toHaveBeenCalled();
  });

  it("permite a los tres roles con la capacidad (dueno, supervisor, coordinador)", async () => {
    vi.mocked(calcularYAplicarRutaManifiesto).mockResolvedValue({
      totalParadas: 2,
      totalSinSecuencia: 0,
      distanciaTotalM: 1234,
      nombreOrigen: "Bodega Central",
    });

    const roles: Rol[] = ["dueno", "supervisor", "coordinador"];
    for (const rol of roles) {
      vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ rol }));
      const resultado = await accionCalcularRuta(MANIFIESTO_1);
      expect(resultado.ok).toBe(true);
    }
    expect(calcularYAplicarRutaManifiesto).toHaveBeenCalledTimes(roles.length);
  });
});

// =============================================================================
// RBAC — accionGuardarOrdenManual
// =============================================================================

describe("accionGuardarOrdenManual — RBAC", () => {
  it("rechaza a un rol SIN asignar_y_reasignar_pedidos, sin llamar al RPC", async () => {
    vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ rol: "administracion" }));

    const resultado = await accionGuardarOrdenManual(MANIFIESTO_1, [PEDIDO_1]);

    expect(resultado).toEqual({
      ok: false,
      mensaje: "No tienes permiso para reordenar la ruta.",
    });
    expect(aplicarSecuenciaParadasRpc).not.toHaveBeenCalled();
  });

  it("permite a los tres roles con la capacidad", async () => {
    vi.mocked(aplicarSecuenciaParadasRpc).mockResolvedValue({
      totalParadas: 2,
      totalSinSecuencia: 0,
      totalPreviasLimpiadas: 2,
    });

    const roles: Rol[] = ["dueno", "supervisor", "coordinador"];
    for (const rol of roles) {
      vi.mocked(exigirSesionActual).mockResolvedValue(crearSesion({ rol }));
      const resultado = await accionGuardarOrdenManual(MANIFIESTO_1, [PEDIDO_1]);
      expect(resultado.ok).toBe(true);
    }
    expect(aplicarSecuenciaParadasRpc).toHaveBeenCalledTimes(roles.length);
  });
});

// =============================================================================
// tenantId / actorUsuarioId salen SIEMPRE de la sesión
// =============================================================================

describe("accionCalcularRuta — el tenant y el actor salen de la sesión", () => {
  it("sin tenantId en la sesión, no llama al motor", async () => {
    const sesion = crearSesion();
    vi.mocked(exigirSesionActual).mockResolvedValue({
      ...sesion,
      usuario: { ...sesion.usuario, tenantId: null },
    });

    const resultado = await accionCalcularRuta(MANIFIESTO_1);

    expect(resultado).toEqual({ ok: false, mensaje: "Sin sesión." });
    expect(calcularYAplicarRutaManifiesto).not.toHaveBeenCalled();
  });

  it("pasa tenantId y actorUsuarioId de la SESIÓN al motor, y el cliente service_role", async () => {
    vi.mocked(calcularYAplicarRutaManifiesto).mockResolvedValue({
      totalParadas: 1,
      totalSinSecuencia: 0,
      distanciaTotalM: 500,
      nombreOrigen: "Bodega Central",
    });

    await accionCalcularRuta(MANIFIESTO_1);

    expect(calcularYAplicarRutaManifiesto).toHaveBeenCalledWith(
      { marca: "cliente-service-role" },
      { tenantId: TENANT_A, manifiestoId: MANIFIESTO_1, actorUsuarioId: USUARIO_ID },
    );
  });

  it("sin manifiestoId, no llama al motor", async () => {
    const resultado = await accionCalcularRuta("");
    expect(resultado).toEqual({ ok: false, mensaje: "Falta el manifiesto." });
    expect(calcularYAplicarRutaManifiesto).not.toHaveBeenCalled();
  });
});

// =============================================================================
// requiereRecarga — la traducción de ErrorSecuenciaDesincronizada (P0001)
// =============================================================================

describe("accionGuardarOrdenManual — requiereRecarga", () => {
  it("ErrorSecuenciaDesincronizada (P0001) se traduce a requiereRecarga: true, y el mensaje pide recargar", async () => {
    vi.mocked(aplicarSecuenciaParadasRpc).mockRejectedValue(
      new ErrorSecuenciaDesincronizada(
        "La lista de paradas cambió mientras ordenabas la ruta. Vuelve a cargar el manifiesto y ordénalo otra vez.",
      ),
    );

    const resultado = await accionGuardarOrdenManual(MANIFIESTO_1, [PEDIDO_1, PEDIDO_2]);

    expect(resultado).toEqual({
      ok: false,
      mensaje:
        "La lista de paradas cambió mientras ordenabas la ruta. Vuelve a cargar el manifiesto y ordénalo otra vez.",
      requiereRecarga: true,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("un Error genérico del RPC NO trae requiereRecarga (la pantalla debe ofrecer reintentar, no recargar)", async () => {
    vi.mocked(aplicarSecuenciaParadasRpc).mockRejectedValue(
      new Error("Este manifiesto ya está cerrado (completado o cancelado) y su ruta no se puede modificar."),
    );

    const resultado = await accionGuardarOrdenManual(MANIFIESTO_1, [PEDIDO_1]);

    expect(resultado.ok).toBe(false);
    expect(resultado.requiereRecarga).toBeUndefined();
  });

  it("ErrorSecuenciaDesincronizada también puede salir de accionCalcularRuta (el motor persiste vía el mismo RPC)", async () => {
    vi.mocked(calcularYAplicarRutaManifiesto).mockRejectedValue(
      new ErrorSecuenciaDesincronizada("La lista cambió."),
    );

    const resultado = await accionCalcularRuta(MANIFIESTO_1);

    expect(resultado).toEqual({
      ok: false,
      mensaje: "La lista cambió.",
      requiereRecarga: true,
    });
  });
});

// =============================================================================
// ErrorSinBodegaOrigen — se deja pasar tal cual, sin requiereRecarga
// =============================================================================

describe("accionCalcularRuta — ErrorSinBodegaOrigen", () => {
  it("se traduce a ok:false con su propio mensaje, sin requiereRecarga", async () => {
    vi.mocked(calcularYAplicarRutaManifiesto).mockRejectedValue(new ErrorSinBodegaOrigen());

    const resultado = await accionCalcularRuta(MANIFIESTO_1);

    expect(resultado.ok).toBe(false);
    expect(resultado.requiereRecarga).toBeUndefined();
    expect(resultado.mensaje).toMatch(/bodega/i);
  });
});

// =============================================================================
// El punto de término NO pasa por aquí — nunca aparece en la respuesta
// =============================================================================

describe("las respuestas de las dos acciones nunca traen nada del punto de término", () => {
  it("accionCalcularRuta: el resumen solo trae las claves documentadas", async () => {
    vi.mocked(calcularYAplicarRutaManifiesto).mockResolvedValue({
      totalParadas: 3,
      totalSinSecuencia: 1,
      distanciaTotalM: 4200,
      nombreOrigen: "Bodega Central",
    });

    const resultado = await accionCalcularRuta(MANIFIESTO_1);

    expect(resultado.ok).toBe(true);
    expect(Object.keys(resultado.resumen ?? {}).sort()).toEqual(
      ["distanciaTotalM", "nombreOrigen", "totalParadas", "totalSinSecuencia"].sort(),
    );
  });

  it("accionGuardarOrdenManual: el resumen NUNCA trae distanciaTotalM ni nombreOrigen (no vuelve a llamar al motor)", async () => {
    vi.mocked(aplicarSecuenciaParadasRpc).mockResolvedValue({
      totalParadas: 3,
      totalSinSecuencia: 1,
      totalPreviasLimpiadas: 3,
    });

    const resultado = await accionGuardarOrdenManual(MANIFIESTO_1, [PEDIDO_1, PEDIDO_2]);

    expect(resultado.ok).toBe(true);
    expect(resultado.resumen).toEqual({ totalParadas: 3, totalSinSecuencia: 1 });
    expect(resultado.resumen).not.toHaveProperty("distanciaTotalM");
    expect(resultado.resumen).not.toHaveProperty("nombreOrigen");
  });
});

// =============================================================================
// Camino feliz — revalida las rutas correctas
// =============================================================================

describe("accionGuardarOrdenManual — camino feliz", () => {
  it("manda la lista recibida, en el orden recibido, con origen 'manual', y revalida la ruta del manifiesto", async () => {
    vi.mocked(aplicarSecuenciaParadasRpc).mockResolvedValue({
      totalParadas: 2,
      totalSinSecuencia: 0,
      totalPreviasLimpiadas: 2,
    });

    const resultado = await accionGuardarOrdenManual(MANIFIESTO_1, [PEDIDO_2, PEDIDO_1]);

    expect(aplicarSecuenciaParadasRpc).toHaveBeenCalledWith(
      { marca: "cliente-service-role" },
      {
        tenantId: TENANT_A,
        manifiestoId: MANIFIESTO_1,
        pedidoIdsEnOrden: [PEDIDO_2, PEDIDO_1],
        origen: "manual",
        actorUsuarioId: USUARIO_ID,
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/manifiestos/${MANIFIESTO_1}`);
    expect(resultado.ok).toBe(true);
  });

  it("una lista que no es arreglo se rechaza antes de llamar al RPC", async () => {
    const resultado = await accionGuardarOrdenManual(
      MANIFIESTO_1,
      "no-es-un-arreglo" as unknown as string[],
    );
    expect(resultado).toEqual({ ok: false, mensaje: "La lista de paradas no es válida." });
    expect(aplicarSecuenciaParadasRpc).not.toHaveBeenCalled();
  });
});
