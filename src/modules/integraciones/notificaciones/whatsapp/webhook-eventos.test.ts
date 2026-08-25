/**
 * Pruebas de la normalización del payload de Meta.
 *
 * Cubren en particular las dos trampas que tienen historia en este repo: el
 * estado que retrocede porque los acuses llegan desordenados, y la detección de
 * baja, donde equivocarse hacia el lado conservador significa seguir
 * escribiéndole a alguien que pidió que no.
 */

import { describe, it, expect } from "vitest";
import {
  normalizarEventosWebhookWhatsApp,
  estadoAvanza,
  esSolicitudDeBaja,
} from "./webhook-eventos";

function envolver(valor: unknown, field = "messages") {
  return { object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ value: valor, field }] }] };
}

describe("estadoAvanza — el acuse desordenado NO puede retroceder el estado", () => {
  it("avanza en el orden natural", () => {
    expect(estadoAvanza("encolado", "enviado")).toBe(true);
    expect(estadoAvanza("enviado", "entregado")).toBe(true);
    expect(estadoAvanza("entregado", "leido")).toBe(true);
  });

  it("NO retrocede de leído a entregado (el `delivered` que llega tarde)", () => {
    // Este es el bug del webhook de payout de Fintoc, repetido.
    expect(estadoAvanza("leido", "entregado")).toBe(false);
    expect(estadoAvanza("leido", "enviado")).toBe(false);
    expect(estadoAvanza("entregado", "enviado")).toBe(false);
  });

  it("un acuse repetido no cuenta como avance (Meta reintenta)", () => {
    expect(estadoAvanza("entregado", "entregado")).toBe(false);
  });

  it("fallido es terminal: nada lo revierte", () => {
    expect(estadoAvanza("fallido", "entregado")).toBe(false);
    expect(estadoAvanza("fallido", "leido")).toBe(false);
  });
});

describe("esSolicitudDeBaja", () => {
  it.each(["BAJA", "baja", "Stop", "STOP", "salir", "cancelar", "unsubscribe", "NO MOLESTAR"])(
    '"%s" es una baja',
    (texto) => {
      expect(esSolicitudDeBaja(texto)).toBe(true);
    },
  );

  it("acepta la baja con cortesía — la gente no escribe comandos", () => {
    expect(esSolicitudDeBaja("BAJA por favor")).toBe(true);
    expect(esSolicitudDeBaja("baja, gracias")).toBe(true);
  });

  it("tolera tildes y puntuación", () => {
    expect(esSolicitudDeBaja("¡Baja!")).toBe(true);
  });

  it("NO toma por baja un texto largo donde la palabra habla de otra cosa", () => {
    // El freno: en una frase larga "cancelar" casi siempre habla del PEDIDO.
    expect(
      esSolicitudDeBaja("hola, necesito cancelar el pedido 4521 porque el cliente no estaba"),
    ).toBe(false);
  });

  it("un mensaje normal no es baja", () => {
    expect(esSolicitudDeBaja("ya llegó el conductor?")).toBe(false);
    expect(esSolicitudDeBaja("")).toBe(false);
  });
});

describe("normalizarEventosWebhookWhatsApp — acuses", () => {
  it("extrae el estado y el wamid", () => {
    const eventos = normalizarEventosWebhookWhatsApp(
      envolver({ statuses: [{ id: "wamid.ABC", status: "delivered", timestamp: "1" }] }),
    );
    expect(eventos.acuses).toEqual([{ metaMessageId: "wamid.ABC", estado: "entregado", motivo: null }]);
  });

  it("traduce los cuatro estados de Meta", () => {
    const eventos = normalizarEventosWebhookWhatsApp(
      envolver({
        statuses: [
          { id: "w1", status: "sent" },
          { id: "w2", status: "delivered" },
          { id: "w3", status: "read" },
          { id: "w4", status: "failed" },
        ],
      }),
    );
    expect(eventos.acuses.map((a) => a.estado)).toEqual(["enviado", "entregado", "leido", "fallido"]);
  });

  it("saca el motivo del fallo de error_data.details, que es donde está lo útil", () => {
    const eventos = normalizarEventosWebhookWhatsApp(
      envolver({
        statuses: [
          {
            id: "wamid.X",
            status: "failed",
            errors: [
              {
                code: 131026,
                title: "Message undeliverable",
                error_data: { details: "Receiver is incapable of receiving this message" },
              },
            ],
          },
        ],
      }),
    );
    expect(eventos.acuses[0].motivo).toContain("131026");
    expect(eventos.acuses[0].motivo).toContain("Receiver is incapable");
  });

  it("ignora un estado que no conocemos en vez de romperse", () => {
    const eventos = normalizarEventosWebhookWhatsApp(
      envolver({ statuses: [{ id: "w1", status: "deleted" }] }),
    );
    expect(eventos.acuses).toHaveLength(0);
  });
});

describe("normalizarEventosWebhookWhatsApp — entrantes", () => {
  it("normaliza el remitente y detecta la baja", () => {
    const eventos = normalizarEventosWebhookWhatsApp(
      envolver({
        messages: [
          { id: "wamid.IN", from: "56947095571", type: "text", text: { body: "BAJA" } },
        ],
      }),
    );
    expect(eventos.entrantes).toHaveLength(1);
    expect(eventos.entrantes[0].telefonoE164).toBe("56947095571");
    expect(eventos.entrantes[0].pideBaja).toBe(true);
  });

  it("registra un mensaje que NO es de texto, pero sin contenido", () => {
    const eventos = normalizarEventosWebhookWhatsApp(
      envolver({ messages: [{ id: "wamid.AUDIO", from: "56947095571", type: "audio", audio: { id: "x" } }] }),
    );
    expect(eventos.entrantes[0].texto).toBeNull();
    expect(eventos.entrantes[0].pideBaja).toBe(false);
  });
});

describe("normalizarEventosWebhookWhatsApp — estado de plantillas", () => {
  it("traduce APPROVED y REJECTED", () => {
    const eventos = normalizarEventosWebhookWhatsApp(
      envolver(
        {
          event: "APPROVED",
          message_template_name: "notificacion_retiro_pedidos",
          message_template_language: "es_CL",
        },
        "message_template_status_update",
      ),
    );
    expect(eventos.plantillas).toEqual([
      { nombrePlantilla: "notificacion_retiro_pedidos", idioma: "es_CL", estadoMeta: "aprobada" },
    ]);
  });

  it("trata PAUSED y DISABLED como rechazo — el efecto práctico es el mismo", () => {
    for (const evento of ["PAUSED", "DISABLED"]) {
      const eventos = normalizarEventosWebhookWhatsApp(
        envolver({ event: evento, message_template_name: "x" }, "message_template_status_update"),
      );
      expect(eventos.plantillas[0].estadoMeta).toBe("rechazada");
    }
  });
});

describe("normalizarEventosWebhookWhatsApp — robustez", () => {
  it.each([
    ["null", null],
    ["string", "no soy un objeto"],
    ["objeto vacío", {}],
    ["otro producto", { object: "instagram", entry: [] }],
    ["entry no es arreglo", { object: "whatsapp_business_account", entry: "x" }],
    ["changes ausente", { object: "whatsapp_business_account", entry: [{ id: "x" }] }],
  ])("no lanza y devuelve vacío: %s", (_caso, payload) => {
    expect(() => normalizarEventosWebhookWhatsApp(payload)).not.toThrow();
    const eventos = normalizarEventosWebhookWhatsApp(payload);
    expect(eventos.acuses).toHaveLength(0);
    expect(eventos.entrantes).toHaveLength(0);
    expect(eventos.plantillas).toHaveLength(0);
  });
});
