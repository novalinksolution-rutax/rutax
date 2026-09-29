/**
 * Llave de idempotencia de «Sincronizar ahora» de Shopify.
 *
 * Existe por un bug visto al probar contra una tienda real (2026-09-28): la
 * sincronización automática tras reconectar compartía llave con el botón, y un
 * clic unos segundos antes la hacía descartar como duplicada.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const send = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/inngest/cliente", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));

import { solicitarSincronizacionShopify } from "./sincronizacion";

const BASE = { conexionId: "c1", sellerId: "s1", tenantId: "t1", actorUsuarioId: "u1" };

beforeEach(() => {
  send.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T23:37:12Z"));
});
afterEach(() => vi.useRealTimers());

function idPublicado(llamada: number): string {
  return (send.mock.calls[llamada][0] as { id: string }).id;
}

describe("solicitarSincronizacionShopify", () => {
  it("dos clics en el mismo minuto comparten llave (Inngest descarta el segundo)", async () => {
    await solicitarSincronizacionShopify(BASE);
    vi.setSystemTime(new Date("2026-09-28T23:37:50Z"));
    await solicitarSincronizacionShopify(BASE);
    expect(idPublicado(0)).toBe(idPublicado(1));
  });

  it("tras cambiar la credencial la llave es otra, aunque el botón ya haya ocupado el minuto", async () => {
    await solicitarSincronizacionShopify(BASE);
    await solicitarSincronizacionShopify({ ...BASE, trasCambioDeCredencial: true });
    expect(idPublicado(0)).not.toBe(idPublicado(1));
  });

  it("el payload no lleva nada más que ids", async () => {
    await solicitarSincronizacionShopify({ ...BASE, trasCambioDeCredencial: true });
    const evento = send.mock.calls[0][0] as { name: string; data: Record<string, unknown> };
    expect(evento.name).toBe("shopify/sincronizacion.solicitada");
    expect(Object.keys(evento.data).sort()).toEqual(["actorUsuarioId", "conexionId", "sellerId", "tenantId"]);
  });
});
