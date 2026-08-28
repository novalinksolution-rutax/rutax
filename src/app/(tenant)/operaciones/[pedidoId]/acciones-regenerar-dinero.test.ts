/**
 * Pruebas de `accionRegenerarLineasDinero`.
 *
 * Es una acción FINANCIERA: pide que el motor vuelva a escribir las líneas de
 * un pedido. Lo que hay que fijar no es que «funcione», sino las cuatro cosas
 * que la hacen segura, cada una por un motivo concreto:
 *
 *   1. Pide LAS DOS capacidades de dinero. El motor puede escribir cobro y
 *      liquidación; pedir una sola es una puerta lateral hacia la otra.
 *   2. Se niega SIN CONDUCTOR. El motor devuelve `null` en silencio en ese caso
 *      (`if (!elegibilidad.generaLiquidacion || !driverIdAsignado) return null`),
 *      así que sin esta guarda el botón dispara un job que no hace nada y no lo
 *      dice.
 *   3. La bitácora va ANTES del evento y CON AUTOR (RNF-04). Si el evento falla,
 *      la intención queda registrada igual.
 *   4. No inventa el conductor: el evento lleva el de la asignación ACTIVA.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/identidad/usuario-actual-servidor", () => ({
  exigirSesionActual: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));
vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn(),
}));
vi.mock("@/lib/inngest/cliente", () => ({
  inngest: { send: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/dinero/acciones", () => ({
  anularLineaCobroPedido: vi.fn(),
  anularLineaLiquidacionPedido: vi.fn(),
}));
vi.mock("@/modules/operacion/incidencias", () => ({ reclasificarIncidencia: vi.fn() }));

import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { inngest } from "@/lib/inngest/cliente";
import { accionRegenerarLineasDinero } from "./acciones-dinero";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PEDIDO = "22222222-2222-4222-8222-222222222222";
const USUARIO = "33333333-3333-4333-8333-333333333333";

/**
 * Las capacidades salen del ROL vía `MATRIZ_ROL_CAPACIDADES`, no de una lista
 * que uno pueda inventar. Así que la prueba de permisos usa roles REALES: es la
 * matriz de verdad la que queda fijada, no un doble de ella.
 */
function sesionComo(rol: string) {
  return {
    usuarioId: USUARIO,
    usuario: {
      tenantId: TENANT,
      tipoUsuario: "interno",
      sellerId: null,
      driverId: null,
      rol,
      estado: "activo",
    },
  };
}

interface Escenario {
  pedido?: Record<string, unknown> | null;
  asignacion?: Record<string, unknown> | null;
}

/** Falso de las dos lecturas: el pedido y su asignación activa. */
function clienteFalso(e: Escenario) {
  const tabla = (fila: Record<string, unknown> | null) => {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      maybeSingle: () => Promise.resolve({ data: fila, error: null }),
    };
    return c;
  };
  return {
    schema: () => ({ from: () => tabla(e.pedido ?? null) }),
    from: () => tabla(e.asignacion ?? null),
  };
}

const PEDIDO_ENTREGADO = {
  estado: "entregado",
  seller_id: "seller-1",
  tipo_pedido: "same_day",
  tarifa_aplicable_id: "tarifa-1",
  actualizado_en: "2026-08-15T18:00:00-04:00",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exigirSesionActual).mockResolvedValue(
    sesionComo("administracion") as unknown as Awaited<ReturnType<typeof exigirSesionActual>>,
  );
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    clienteFalso({
      pedido: PEDIDO_ENTREGADO,
      asignacion: { driver_id: "driver-1" },
    }) as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
});

describe("accionRegenerarLineasDinero", () => {
  it("camino feliz: registra en bitácora y publica el evento del motor", async () => {
    const r = await accionRegenerarLineasDinero(PEDIDO);

    expect(r.ok).toBe(true);
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "dinero/pedido.estado_financiero_relevante",
        data: expect.objectContaining({
          pedidoId: PEDIDO,
          tenantId: TENANT,
          driverIdAsignado: "driver-1",
          estadoNuevo: "entregado",
        }),
      }),
    );
  });

  it("🔴 la bitácora se escribe ANTES de publicar el evento, y con autor", async () => {
    // RNF-04: si el evento falla, la intención tiene que haber quedado igual.
    const orden: string[] = [];
    vi.mocked(registrarEnBitacora).mockImplementation(async () => {
      orden.push("bitacora");
    });
    vi.mocked(inngest.send).mockImplementation(async () => {
      orden.push("evento");
      return undefined as never;
    });

    await accionRegenerarLineasDinero(PEDIDO);

    expect(orden).toEqual(["bitacora", "evento"]);
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT,
        actorUsuarioId: USUARIO,
        actorTipo: "usuario",
        entidadTipo: "pedido",
        entidadId: PEDIDO,
      }),
    );
  });

  it("🔴 SIN CONDUCTOR se niega, en vez de disparar un job que no hace nada", async () => {
    // El motor devuelve `null` en silencio cuando no hay driver. Un botón que
    // dispara eso y no lo dice enseña a desconfiar de la app.
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteFalso({ pedido: PEDIDO_ENTREGADO, asignacion: null }) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );

    const r = await accionRegenerarLineasDinero(PEDIDO);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/conductor asignado/i);
    expect(inngest.send).not.toHaveBeenCalled();
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("🔴 solo los roles con LAS DOS mitades del dinero pueden pedirlo", async () => {
    // Se prueba contra la matriz real: `dueno` y `administracion` tienen
    // `emitir_facturas` **y** `gestionar_liquidaciones_conductores`; los roles
    // operativos no tienen ninguna de las dos.
    //
    // ⚠️ **Esto fija el RESULTADO, no la conjunción.** Comprobado por mutación:
    // hoy las dos capacidades las tienen exactamente los mismos roles, así que
    // exigir una sola pasa esta prueba igual. La conjunción se escribe igual
    // —pedir una sola sería una puerta lateral hacia la mitad que ese rol no ve
    // por su camino normal— y esta prueba es la que avisará el día que la matriz
    // las separe: ahí el resultado cambia y el gate hay que volver a mirarlo.
    const esperado: Record<string, boolean> = {
      dueno: true,
      administracion: true,
      supervisor: false,
      coordinador: false,
      conductor: false,
    };

    for (const [rol, puede] of Object.entries(esperado)) {
      vi.clearAllMocks();
      vi.mocked(exigirSesionActual).mockResolvedValue(
        sesionComo(rol) as unknown as Awaited<ReturnType<typeof exigirSesionActual>>,
      );
      vi.mocked(crearClienteServiceRole).mockReturnValue(
        clienteFalso({
          pedido: PEDIDO_ENTREGADO,
          asignacion: { driver_id: "driver-1" },
        }) as unknown as ReturnType<typeof crearClienteServiceRole>,
      );

      const r = await accionRegenerarLineasDinero(PEDIDO);

      expect(r.ok, `rol ${rol}`).toBe(puede);
      expect(vi.mocked(inngest.send).mock.calls.length, `rol ${rol}`).toBe(puede ? 1 : 0);
    }
  });

  it("un estado que no genera líneas se rechaza con su motivo", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteFalso({
        pedido: { ...PEDIDO_ENTREGADO, estado: "en_ruta" },
        asignacion: { driver_id: "driver-1" },
      }) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const r = await accionRegenerarLineasDinero(PEDIDO);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("en_ruta");
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("un pedido de otro tenant no existe para esta acción", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      clienteFalso({ pedido: null }) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const r = await accionRegenerarLineasDinero(PEDIDO);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/no encontrado/i);
    expect(inngest.send).not.toHaveBeenCalled();
  });
});
