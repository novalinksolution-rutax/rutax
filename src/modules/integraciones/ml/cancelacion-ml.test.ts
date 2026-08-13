/**
 * Pruebas del detector compartido de cancelaciones.
 *
 * Lo que se protege aquí: que el criterio de «esto es una cancelación» sea UNO
 * (se apoya en la tabla de traducción oficial, no en comparar contra la cadena
 * `"cancelled"` a mano), que el evento salga con llave determinística, y que
 * `integraciones` se limite a AVISAR — el payload no lleva nada que insinúe que
 * este módulo aplicó algo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

import { inngest } from "@/lib/inngest/cliente";
import { esCancelacionMl, publicarCancelacionEnMl } from "./cancelacion-ml";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("esCancelacionMl", () => {
  it("`cancelled` es cancelación", () => {
    expect(esCancelacionMl("cancelled")).toBe(true);
    expect(esCancelacionMl("CANCELLED")).toBe(true);
    expect(esCancelacionMl(" cancelled ")).toBe(true);
  });

  it("los estados vivos NO lo son", () => {
    for (const estado of ["ready_to_ship", "shipped", "handling", "pending", "to_be_agreed"]) {
      expect(esCancelacionMl(estado)).toBe(false);
    }
  });

  it("los otros terminales tampoco: `delivered` y `not_delivered` siguen su camino normal", () => {
    expect(esCancelacionMl("delivered")).toBe(false);
    expect(esCancelacionMl("not_delivered")).toBe(false);
    expect(esCancelacionMl("not_delivered", "returning_to_sender")).toBe(false);
  });

  it("un estado que ML invente mañana no se confunde con una cancelación", () => {
    expect(esCancelacionMl("estado_nuevo_de_ml")).toBe(false);
  });

  it("sin estado no hay cancelación (nunca se cancela por ausencia de dato)", () => {
    expect(esCancelacionMl(null)).toBe(false);
    expect(esCancelacionMl(undefined)).toBe(false);
    expect(esCancelacionMl("")).toBe(false);
  });
});

describe("publicarCancelacionEnMl", () => {
  const datos = {
    pedidoId: "pedido-1",
    tenantId: "tenant-1",
    sellerId: "seller-1",
    mlShipmentId: "44012345678",
    estadoAnterior: "asignado",
    substatusMl: "buyer_cancelled",
  };

  it("publica el contrato exacto con llave determinística por pedido", async () => {
    const ok = await publicarCancelacionEnMl(datos);

    expect(ok).toBe(true);
    expect(inngest.send).toHaveBeenCalledWith({
      name: "operacion/pedido.cancelado-en-ml",
      id: "pedido-cancelado-ml-pedido-1",
      data: {
        pedidoId: "pedido-1",
        tenantId: "tenant-1",
        sellerId: "seller-1",
        mlShipmentId: "44012345678",
        estadoAnterior: "asignado",
        substatusMl: "buyer_cancelled",
      },
    });
  });

  it("dos descubrimientos del mismo pedido (webhook y cron) usan la MISMA llave", async () => {
    await publicarCancelacionEnMl(datos);
    await publicarCancelacionEnMl({ ...datos, estadoAnterior: "en_ruta" });

    const llaves = vi.mocked(inngest.send).mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(new Set(llaves).size).toBe(1);
  });

  it("no lanza si Inngest falla: devuelve false y avisa para que el barrido reintente", async () => {
    vi.mocked(inngest.send).mockRejectedValueOnce(new Error("Inngest caído"));
    const logger = { warn: vi.fn() };

    await expect(publicarCancelacionEnMl(datos, logger)).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("reintentará"));
  });

  it("el payload no lleva token, ni nombre, ni dirección del destinatario", async () => {
    await publicarCancelacionEnMl(datos);
    const serializado = JSON.stringify(vi.mocked(inngest.send).mock.calls[0][0]);
    expect(serializado).not.toMatch(/token|Bearer|direccion|destinatario/i);
  });
});
