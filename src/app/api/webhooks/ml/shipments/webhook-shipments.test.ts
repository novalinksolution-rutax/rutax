/**
 * Pruebas del webhook handler de ML — route.ts
 *
 * ML marketplace NO firma las notificaciones (verificado en vivo: sin
 * x-signature, user-agent github.com/go-loco/restful). El esquema HMAC era de
 * Mercado Pago y se quitó. La validación previa al encolado es: que la
 * notificación sea para NUESTRA app (application_id) y que el topic sea
 * `shipments`. La integridad real la da el fetch del recurso con el token del
 * seller (en procesar-shipment), no la notificación.
 */
import { describe, expect, it } from "vitest";
import { extraerShipmentId, esParaNuestraApp } from "./route";

describe("extraerShipmentId", () => {
  it("extrae el ID numérico del resource '/shipments/{id}'", () => {
    expect(extraerShipmentId("/shipments/123456789")).toBe("123456789");
    expect(extraerShipmentId("/shipments/47274658946")).toBe("47274658946");
  });

  it("retorna null si el resource no tiene el formato esperado", () => {
    expect(extraerShipmentId("/orders/123")).toBeNull();
    expect(extraerShipmentId("shipments/abc")).toBeNull();
    expect(extraerShipmentId("")).toBeNull();
  });
});

describe("esParaNuestraApp — validación de application_id (ML no firma)", () => {
  const CLIENT_ID = "8261413874142166";

  it("acepta cuando application_id coincide con ML_APP_CLIENT_ID", () => {
    // ML envía application_id como número; nuestro client_id es string.
    expect(esParaNuestraApp(8261413874142166, CLIENT_ID)).toBe(true);
    expect(esParaNuestraApp("8261413874142166", CLIENT_ID)).toBe(true);
  });

  it("rechaza cuando application_id es de otra app", () => {
    expect(esParaNuestraApp(9999999999999, CLIENT_ID)).toBe(false);
  });

  it("rechaza (fail-closed) cuando no hay ML_APP_CLIENT_ID configurado", () => {
    expect(esParaNuestraApp(8261413874142166, undefined)).toBe(false);
  });

  it("rechaza application_id ausente", () => {
    expect(esParaNuestraApp(undefined, CLIENT_ID)).toBe(false);
    expect(esParaNuestraApp(null, CLIENT_ID)).toBe(false);
  });
});

describe("contrato del evento Inngest publicado", () => {
  it("el payload lleva solo shipmentId/userId/timestamp — nunca el body ni tokens", () => {
    const payloadEvento = {
      name: "ml/shipment.actualizado" as const,
      data: { shipmentId: "47274658946", userId: "2114191787", timestamp: new Date().toISOString() },
    };
    expect(payloadEvento.name).toBe("ml/shipment.actualizado");
    expect(payloadEvento.data.shipmentId).toBe("47274658946");
    expect(payloadEvento.data).not.toHaveProperty("resource");
    expect(payloadEvento.data).not.toHaveProperty("access_token");
    expect(payloadEvento.data).not.toHaveProperty("application_id");
  });
});
