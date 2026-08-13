/**
 * Pruebas de los envoltorios de `operacion.cerrar_sesion_retiro` y
 * `operacion.resolver_bulto_retiro`. Verifican, sobre todo, que el RPC se
 * apunta al esquema `operacion` explícitamente (el gotcha documentado en
 * `operacion/zonas.ts:315`: sin `.schema('operacion')`, PostgREST busca
 * `public.<función>`, no la encuentra, y sin este test el error pasaría
 * inadvertido hasta producción).
 */
import { describe, expect, it, vi } from "vitest";
import { cerrarSesionRetiroRpc, resolverBultoRetiroRpc } from "./rpc";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const SESION_1 = "30000000-0000-0000-0000-000000000001";
const CONDUCTOR_1 = "20000000-0000-0000-0000-000000000001";
const BULTO_1 = "50000000-0000-0000-0000-000000000001";
const PEDIDO_1 = "40000000-0000-0000-0000-000000000001";
const SELLER_1 = "60000000-0000-0000-0000-000000000001";

function crearClienteRpc(respuesta: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(respuesta);
  const schema = vi.fn((esquema: string) => {
    if (esquema !== "operacion") throw new Error(`Esquema inesperado: ${esquema}`);
    return { rpc };
  });
  return { cliente: { schema } as never, schema, rpc };
}

describe("cerrarSesionRetiroRpc", () => {
  it("llama a operacion.cerrar_sesion_retiro con los p_ correctos y traduce la fila", async () => {
    const filaSql = {
      sesion_id: SESION_1,
      sesion_estado: "cerrada",
      total_bultos: 12,
      total_resueltos: 10,
      total_sin_resolver: 2,
      cerrada_ts: "2026-08-13T20:00:00.000Z",
      ya_estaba_cerrada: false,
      pedidos_marcados: 10,
    };
    const { cliente, schema, rpc } = crearClienteRpc({ data: [filaSql], error: null });

    const resultado = await cerrarSesionRetiroRpc(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
    });

    expect(schema).toHaveBeenCalledWith("operacion");
    expect(rpc).toHaveBeenCalledWith("cerrar_sesion_retiro", {
      p_tenant_id: TENANT_A,
      p_sesion_id: SESION_1,
      p_conductor_id: CONDUCTOR_1,
    });
    expect(resultado).toEqual({
      sesionId: SESION_1,
      estado: "cerrada",
      bultosTotal: 12,
      bultosResueltos: 10,
      bultosSinResolver: 2,
      cerradaEn: "2026-08-13T20:00:00.000Z",
      yaEstabaCerrada: false,
      pedidosMarcados: 10,
    });
  });

  it("acepta que el RPC devuelva un objeto suelto (no array) — defensivo", async () => {
    const filaSql = {
      sesion_id: SESION_1,
      sesion_estado: "cerrada",
      total_bultos: 0,
      total_resueltos: 0,
      total_sin_resolver: 0,
      cerrada_ts: "2026-08-13T20:00:00.000Z",
      ya_estaba_cerrada: true,
      pedidos_marcados: 0,
    };
    const { cliente } = crearClienteRpc({ data: filaSql, error: null });

    const resultado = await cerrarSesionRetiroRpc(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: CONDUCTOR_1,
    });
    expect(resultado.yaEstabaCerrada).toBe(true);
  });

  it("propaga el error de Postgres (p. ej. 42501 conductor no es el de la visita)", async () => {
    const { cliente } = crearClienteRpc({
      data: null,
      error: { message: "la sesión la abrió otro conductor" },
    });

    await expect(
      cerrarSesionRetiroRpc(cliente, { tenantId: TENANT_A, sesionId: SESION_1, conductorId: CONDUCTOR_1 }),
    ).rejects.toThrow(/la sesión la abrió otro conductor/);
  });

  it("lanza si el RPC no devuelve ninguna fila", async () => {
    const { cliente } = crearClienteRpc({ data: [], error: null });

    await expect(
      cerrarSesionRetiroRpc(cliente, { tenantId: TENANT_A, sesionId: SESION_1, conductorId: CONDUCTOR_1 }),
    ).rejects.toThrow(/no devolvió ninguna fila/);
  });
});

describe("resolverBultoRetiroRpc", () => {
  it("llama a operacion.resolver_bulto_retiro con los p_ correctos y traduce la fila", async () => {
    const filaSql = {
      bulto_resuelto_id: BULTO_1,
      pedido_resuelto_id: PEDIDO_1,
      seller_resuelto_id: SELLER_1,
      resuelto_ts: "2026-08-13T20:10:00.000Z",
      sesion_estaba_cerrada: true,
      pedido_marcado_retirado: true,
    };
    const { cliente, schema, rpc } = crearClienteRpc({ data: [filaSql], error: null });

    const resultado = await resolverBultoRetiroRpc(cliente, {
      tenantId: TENANT_A,
      bultoId: BULTO_1,
      pedidoId: PEDIDO_1,
    });

    expect(schema).toHaveBeenCalledWith("operacion");
    expect(rpc).toHaveBeenCalledWith("resolver_bulto_retiro", {
      p_tenant_id: TENANT_A,
      p_bulto_id: BULTO_1,
      p_pedido_id: PEDIDO_1,
    });
    expect(resultado).toEqual({
      bultoId: BULTO_1,
      pedidoId: PEDIDO_1,
      sellerId: SELLER_1,
      resueltoEn: "2026-08-13T20:10:00.000Z",
      sesionEstabaCerrada: true,
      pedidoMarcadoRetirado: true,
    });
  });

  it("propaga el error de Postgres (p. ej. 23514 bulto desconocido no se puede resolver)", async () => {
    const { cliente } = crearClienteRpc({
      data: null,
      error: { message: "un ilegible no puede quedar casado con un pedido" },
    });

    await expect(
      resolverBultoRetiroRpc(cliente, { tenantId: TENANT_A, bultoId: BULTO_1, pedidoId: PEDIDO_1 }),
    ).rejects.toThrow(/un ilegible no puede quedar casado/);
  });
});
