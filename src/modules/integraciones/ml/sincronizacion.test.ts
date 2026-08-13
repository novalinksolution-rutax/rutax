/**
 * Pruebas de la superficie del puerto para la sincronización manual.
 *
 * Lo que protege: que el botón «Sincronizar ahora» no quede muerto tras el
 * primer clic (una llave de idempotencia sin tiempo lo dejaría inerte para
 * siempre) y que el payload no arrastre nada que no deba salir del módulo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

import { inngest } from "@/lib/inngest/cliente";
import { solicitarSincronizacionMl } from "./sincronizacion";

const ENTRADA = {
  conexionId: "conn-1",
  sellerId: "seller-1",
  tenantId: "tenant-1",
  actorUsuarioId: "11111111-1111-1111-1111-111111111111",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("solicitarSincronizacionMl", () => {
  it("publica el evento con el contrato exacto", async () => {
    vi.setSystemTime(new Date("2026-08-13T14:20:30.000Z"));
    await solicitarSincronizacionMl(ENTRADA);

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ml/sincronizacion.solicitada",
        data: {
          conexionId: "conn-1",
          sellerId: "seller-1",
          tenantId: "tenant-1",
          actorUsuarioId: "11111111-1111-1111-1111-111111111111",
        },
      }),
    );
  });

  it("dos clics dentro del mismo minuto comparten llave (no duplican el barrido)", async () => {
    vi.setSystemTime(new Date("2026-08-13T14:20:05.000Z"));
    await solicitarSincronizacionMl(ENTRADA);
    vi.setSystemTime(new Date("2026-08-13T14:20:55.000Z"));
    await solicitarSincronizacionMl(ENTRADA);

    const llaves = vi.mocked(inngest.send).mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(new Set(llaves).size).toBe(1);
  });

  it("un minuto después la llave cambia: el botón NO queda muerto tras el primer uso", async () => {
    vi.setSystemTime(new Date("2026-08-13T14:20:05.000Z"));
    await solicitarSincronizacionMl(ENTRADA);
    vi.setSystemTime(new Date("2026-08-13T14:21:05.000Z"));
    await solicitarSincronizacionMl(ENTRADA);

    const llaves = vi.mocked(inngest.send).mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(new Set(llaves).size).toBe(2);
  });

  it("conexiones distintas no comparten llave", async () => {
    vi.setSystemTime(new Date("2026-08-13T14:20:05.000Z"));
    await solicitarSincronizacionMl(ENTRADA);
    await solicitarSincronizacionMl({ ...ENTRADA, conexionId: "conn-2" });

    const llaves = vi.mocked(inngest.send).mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(new Set(llaves).size).toBe(2);
  });

  it("el payload no lleva tokens ni referencias a secretos", async () => {
    await solicitarSincronizacionMl(ENTRADA);
    const serializado = JSON.stringify(vi.mocked(inngest.send).mock.calls[0][0]);
    expect(serializado).not.toMatch(/token|secreto|Bearer|access/i);
  });
});
