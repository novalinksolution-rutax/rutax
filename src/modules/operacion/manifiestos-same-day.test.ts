import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";

vi.mock("./pedidos", () => ({ actualizarEstadoPedido: vi.fn() }));

import { actualizarEstadoPedido } from "./pedidos";
import { alinearPedidosNuevosConManifiestoEnRuta } from "./manifiestos-same-day";
import { validarTransicion } from "./maquina-estados";

const TENANT = "11111111-1111-4111-8111-111111111111";
const MANIFIESTO = "22222222-2222-4222-8222-222222222222";
const DRIVER = "33333333-3333-4333-8333-333333333333";
const USUARIO = "44444444-4444-4444-8444-444444444444";

const actor = { tenantId: TENANT, driverId: DRIVER } as unknown as UsuarioActual;

/**
 * Falso de las dos lecturas: el estado del manifiesto y las asignaciones.
 * Registra los filtros de la segunda para poder afirmar que Flex queda fuera —
 * si el falso los ignorara, la prueba de la frontera dura no probaría nada.
 */
function clienteFalso(opciones: {
  estadoManifiesto: string | null;
  asignaciones?: { pedido_id: string }[];
}) {
  const filtros: Array<[string, string]> = [];
  const cliente = {
    from(tabla: string) {
      if (tabla === "manifiestos") {
        const r = {
          data: opciones.estadoManifiesto === null ? null : { estado: opciones.estadoManifiesto },
          error: null,
        };
        const c: Record<string, unknown> = {
          select: () => c,
          eq: () => c,
          maybeSingle: () => Promise.resolve(r),
        };
        return c;
      }
      if (tabla === "asignaciones_pedido") {
        const r = { data: opciones.asignaciones ?? [], error: null };
        const c: Record<string, unknown> = {
          select: () => c,
          eq: (col: string, val: string) => {
            filtros.push([col, val]);
            return c;
          },
          neq: (col: string, val: string) => {
            filtros.push([`neq:${col}`, val]);
            return c;
          },
          then: (res: (v: unknown) => unknown) => Promise.resolve(r).then(res),
        };
        return c;
      }
      throw new Error(`tabla inesperada: ${tabla}`);
    },
  } as unknown as SupabaseClient;
  return { cliente, filtros };
}

const llamar = (cliente: SupabaseClient) =>
  alinearPedidosNuevosConManifiestoEnRuta(cliente, {
    tenantId: TENANT,
    manifiestoId: MANIFIESTO,
    driverId: DRIVER,
    actor,
    actorUsuarioId: USUARIO,
  });

describe("alinearPedidosNuevosConManifiestoEnRuta", () => {
  beforeEach(() => vi.mocked(actualizarEstadoPedido).mockReset());

  it("🔴 con el manifiesto EN RUTA, pone la parada recién asignada en en_ruta", async () => {
    // El bug: se quedaba en `asignado` y `asignado → entregado` es inválida, así
    // que el conductor la veía y no podía entregarla.
    const { cliente } = clienteFalso({
      estadoManifiesto: "en_ruta",
      asignaciones: [{ pedido_id: "p1" }],
    });

    await expect(llamar(cliente)).resolves.toBe(true);

    expect(actualizarEstadoPedido).toHaveBeenCalledTimes(1);
    expect(vi.mocked(actualizarEstadoPedido).mock.calls[0][1]).toMatchObject({
      pedidoId: "p1",
      estadoNuevo: "en_ruta",
      estadoEsperado: "asignado",
      // No es el conductor quien dispara, y tampoco es una corrección manual:
      // es una consecuencia de la asignación. Ver la prueba de más abajo, que
      // ata este valor a la máquina de estados real.
      ejecutor: "sistema",
      actuadoPorUsuarioId: USUARIO,
    });
  });

  it("con el manifiesto CONFIRMADO no toca nada: la parada arranca con el resto", async () => {
    const { cliente } = clienteFalso({
      estadoManifiesto: "confirmado",
      asignaciones: [{ pedido_id: "p1" }],
    });

    await expect(llamar(cliente)).resolves.toBe(false);
    expect(actualizarEstadoPedido).not.toHaveBeenCalled();
  });

  it("con el manifiesto en BORRADOR tampoco", async () => {
    const { cliente } = clienteFalso({ estadoManifiesto: "borrador" });
    await expect(llamar(cliente)).resolves.toBe(false);
    expect(actualizarEstadoPedido).not.toHaveBeenCalled();
  });

  it("🔴 nunca toca pedidos Flex: su estado lo escribe Mercado Envíos", async () => {
    // La frontera dura del módulo. Se comprueba sobre el FILTRO enviado, no
    // sobre el resultado: el falso devuelve lo que le pidan, así que afirmar
    // sobre las filas no diría nada del predicado real.
    const { cliente, filtros } = clienteFalso({
      estadoManifiesto: "en_ruta",
      asignaciones: [{ pedido_id: "p1" }],
    });

    await llamar(cliente);

    expect(filtros).toContainEqual(["neq:pedidos.fuente", "ml_flex"]);
    expect(filtros).toContainEqual(["pedidos.estado", "asignado"]);
    expect(filtros).toContainEqual(["tenant_id", TENANT]);
  });

  it("un manifiesto que no existe no es un en_ruta: devuelve false sin tocar nada", async () => {
    const { cliente } = clienteFalso({ estadoManifiesto: null });
    await expect(llamar(cliente)).resolves.toBe(false);
    expect(actualizarEstadoPedido).not.toHaveBeenCalled();
  });

  it("🔴 el ejecutor que usa ES VÁLIDO en la máquina de estados real", async () => {
    // La red que faltaba. Esta prueba mockea `actualizarEstadoPedido`, así que
    // por sí sola aprobaría cualquier ejecutor —y aprobó `interno`, que la
    // máquina rechaza y que además exige un `motivo` que nadie manda. El
    // llamador envuelve todo en try/catch (debe: la asignación no puede
    // perderse), así que el pedido se quedaba en `asignado` en silencio.
    //
    // Se comprueba contra la máquina DE VERDAD, no contra el doble.
    const { cliente } = clienteFalso({
      estadoManifiesto: "en_ruta",
      asignaciones: [{ pedido_id: "p1" }],
    });
    await llamar(cliente);

    const usado = vi.mocked(actualizarEstadoPedido).mock.calls[0][1] as {
      ejecutor: Parameters<typeof validarTransicion>[2];
    };
    expect(validarTransicion("asignado", "en_ruta", usado.ejecutor)).toBe(true);
  });
});
