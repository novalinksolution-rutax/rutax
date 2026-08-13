/**
 * Pruebas del webhook de Mercado Libre (topic `shipments`).
 *
 * Foco: el borde. La notificación de ML no viene firmada (su marketplace no
 * ofrece firma; el `x-signature` es de Mercado Pago, otro producto), así que
 * este endpoint tiene tres defensas antes de encolar —`application_id`, topic y
 * cuenta conocida— y una regla dura: **responde 200 y el trabajo se va a
 * Inngest, nunca al request**. Si el endpoint tardara o fallara, la doc oficial
 * de ML es explícita: reintenta 1 h y después **desactiva el topic entero**.
 *
 * El requisito de la tarea que se prueba aquí: **un `user_id` ajeno no dispara
 * ninguna ingesta** — ni evento, ni consulta a ML.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/cliente", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/lib/rate-limit", () => ({
  consumirRateLimit: vi.fn().mockResolvedValue({ permitido: true, reintentarEnSegundos: 0 }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { inngest } from "@/lib/inngest/cliente";
import { consumirRateLimit } from "@/lib/rate-limit";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { POST, esParaNuestraApp, extraerShipmentId } from "./route";

const CLIENT_ID = "1234567890123456";

/** Doble de Supabase: `conexiones` son las filas que devuelve el lookup. */
function crearSupabaseFalso(conexiones: Array<{ id: string }>) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const cadena: any = {};
  cadena.select = vi.fn(() => cadena);
  cadena.eq = vi.fn(() => cadena);
  cadena.limit = vi.fn(async () => ({ data: conexiones, error: null }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    schema: vi.fn(() => ({ from: vi.fn(() => cadena) })),
  };
}

function peticion(body: unknown): Request {
  return new Request("https://rutax.test/api/webhooks/ml/shipments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const NOTIFICACION = {
  _id: "abc",
  resource: "/shipments/44012345678",
  user_id: 123456789,
  topic: "shipments",
  application_id: CLIENT_ID,
  sent: "2026-08-13T14:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ML_APP_CLIENT_ID = CLIENT_ID;
  vi.mocked(consumirRateLimit).mockResolvedValue({
    permitido: true,
    restante: 119,
    reintentarEnSegundos: 0,
  });
});

describe("helpers del borde", () => {
  it("extrae el shipment_id del `resource`", () => {
    expect(extraerShipmentId("/shipments/44012345678")).toBe("44012345678");
    expect(extraerShipmentId("/orders/123")).toBeNull();
  });

  it("sin ML_APP_CLIENT_ID configurado, falla cerrado", () => {
    expect(esParaNuestraApp(CLIENT_ID, undefined)).toBe(false);
    expect(esParaNuestraApp(CLIENT_ID, CLIENT_ID)).toBe(true);
    expect(esParaNuestraApp(Number(CLIENT_ID), CLIENT_ID)).toBe(true);
    expect(esParaNuestraApp("otra-app", CLIENT_ID)).toBe(false);
  });
});

describe("POST /api/webhooks/ml/shipments", () => {
  it("REQUISITO: un `user_id` AJENO responde 200 y NO encola nada", async () => {
    // Sin conexión conocida no hay ingesta posible ni deseable: cero evento,
    // cero consulta a ML. Y 200, para que ML no reintente ni desactive el topic.
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearSupabaseFalso([]) as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const respuesta = await POST(peticion({ ...NOTIFICACION, user_id: 999999999 }) as never);

    expect(respuesta.status).toBe(200);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("con una cuenta conocida encola el evento y responde 200", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearSupabaseFalso([{ id: "conn-1" }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );

    const respuesta = await POST(peticion(NOTIFICACION) as never);

    expect(respuesta.status).toBe(200);
    expect(inngest.send).toHaveBeenCalledWith({
      name: "ml/shipment.actualizado",
      data: {
        shipmentId: "44012345678",
        userId: "123456789",
        timestamp: "2026-08-13T14:00:00.000Z",
      },
    });
  });

  it("el evento encolado NO lleva el body crudo de ML ni nada sensible", async () => {
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      crearSupabaseFalso([{ id: "conn-1" }]) as unknown as ReturnType<
        typeof crearClienteServiceRole
      >,
    );

    await POST(peticion({ ...NOTIFICACION, secreto_interno: "no-debe-viajar" }) as never);

    const serializado = JSON.stringify(vi.mocked(inngest.send).mock.calls[0][0]);
    expect(serializado).not.toContain("no-debe-viajar");
    expect(serializado).not.toContain("application_id");
    expect(serializado).not.toMatch(/token|Bearer/i);
  });

  it("una notificación de otra app se ignora sin tocar la base", async () => {
    const supabase = crearSupabaseFalso([{ id: "conn-1" }]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      supabase as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const respuesta = await POST(
      peticion({ ...NOTIFICACION, application_id: "app-de-otro" }) as never,
    );

    expect(respuesta.status).toBe(200);
    expect(supabase.schema).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("un topic distinto de `shipments` se ignora (no suscribimos orders_v2)", async () => {
    const supabase = crearSupabaseFalso([{ id: "conn-1" }]);
    vi.mocked(crearClienteServiceRole).mockReturnValue(
      supabase as unknown as ReturnType<typeof crearClienteServiceRole>,
    );

    const respuesta = await POST(peticion({ ...NOTIFICACION, topic: "orders_v2" }) as never);

    expect(respuesta.status).toBe(200);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("un body malformado devuelve 400 sin encolar", async () => {
    const respuesta = await POST(peticion({ topic: "shipments" }) as never);
    expect(respuesta.status).toBe(400);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("al exceder el límite de tasa responde 429 con Retry-After y no encola", async () => {
    vi.mocked(consumirRateLimit).mockResolvedValue({
      permitido: false,
      restante: 0,
      reintentarEnSegundos: 42,
    });

    const respuesta = await POST(peticion(NOTIFICACION) as never);

    expect(respuesta.status).toBe(429);
    expect(respuesta.headers.get("Retry-After")).toBe("42");
    expect(inngest.send).not.toHaveBeenCalled();
  });
});
