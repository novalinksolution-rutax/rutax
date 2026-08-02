/**
 * Pruebas de POST /api/webhooks/fintoc-suscripcion-recurrente (F1-E — auto-cobro).
 *
 * Cubre:
 * 1. Rate limit excedido → 429.
 * 2. Header `Fintoc-Signature` ausente → 401.
 * 3. Secreto de organización no configurado → 401 (fail-closed).
 * 4. Firma inválida → 401 + alerta a observabilidad.
 * 5. Body malformado (tras firma válida) → 400.
 * 6. Evento `ignorado` → 200 no-op, sin tocar BD.
 * 7. `mandato_activado`/`mandato_fallido`: despacha a `activarMandatoRecurrente`/
 *    `marcarMandatoFallido`; `sin_suscripcion` → alerta pero igual 200.
 * 8. `cobro_exitoso`/`cobro_fallido`: despacha a `confirmarCobroRecurrente`;
 *    `sin_periodo`/`monto_discrepante` → alerta pero igual 200.
 * 9. IDEMPOTENCIA: una entrega DUPLICADA de `cobro_exitoso` (segunda vez
 *    `ya_pagado`) responde 200 igual, SIN alertar y sin ningún tratamiento
 *    especial — el webhook nunca debe reintentar sobre un resultado idempotente.
 * 10. Error inesperado en el despacho → 500, sin filtrar detalles al cliente.
 *
 * Mocks: rate-limit, firma, normalización, las funciones de dominio
 * (`confirmarCobroRecurrente`/`activarMandatoRecurrente`/`marcarMandatoFallido`)
 * y observabilidad — sin red real ni Supabase real. Molde de
 * `webhooks/fintoc-payout/route.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  consumirRateLimit: vi.fn(),
}));

vi.mock("@/lib/observabilidad", () => ({
  capturarMensaje: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/integraciones/pagos/firma-webhook-fintoc", () => ({
  verificarFirmaWebhookFintoc: vi.fn(),
}));

vi.mock("@/modules/integraciones/pagos/suscripcion-recurrente", () => ({
  normalizarEventoRecurrente: vi.fn(),
}));

vi.mock("@/modules/plataforma/cobro", () => ({
  confirmarCobroRecurrente: vi.fn(),
}));

vi.mock("@/modules/plataforma/mandato", () => ({
  activarMandatoRecurrente: vi.fn(),
  marcarMandatoFallido: vi.fn(),
}));

import { consumirRateLimit } from "@/lib/rate-limit";
import { capturarMensaje } from "@/lib/observabilidad";
import { verificarFirmaWebhookFintoc } from "@/modules/integraciones/pagos/firma-webhook-fintoc";
import { normalizarEventoRecurrente } from "@/modules/integraciones/pagos/suscripcion-recurrente";
import { confirmarCobroRecurrente } from "@/modules/plataforma/cobro";
import { activarMandatoRecurrente, marcarMandatoFallido } from "@/modules/plataforma/mandato";
import { POST } from "./route";
import type { NextRequest } from "next/server";

function crearRequest(cuerpo: string, headers: Record<string, string> = {}): NextRequest {
  const mapaHeaders = new Map(Object.entries(headers));
  return {
    text: () => Promise.resolve(cuerpo),
    headers: { get: (nombre: string) => mapaHeaders.get(nombre) ?? null },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(consumirRateLimit).mockResolvedValue({ permitido: true, restante: 59, reintentarEnSegundos: 0 });
  vi.mocked(verificarFirmaWebhookFintoc).mockReturnValue(true);
  process.env.FINTOC_SUSCRIPCION_RECURRENTE_WEBHOOK_SECRET = "org-secret-test";
});

afterEach(() => {
  delete process.env.FINTOC_SUSCRIPCION_RECURRENTE_WEBHOOK_SECRET;
});

// =============================================================================
// 1-5. Guardas comunes (rate limit, firma, secreto, body)
// =============================================================================

describe("POST fintoc-suscripcion-recurrente — guardas comunes", () => {
  it("429 si el rate limit está excedido", async () => {
    vi.mocked(consumirRateLimit).mockResolvedValue({ permitido: false, restante: 0, reintentarEnSegundos: 30 });

    const respuesta = await POST(crearRequest("{}", { "Fintoc-Signature": "t=1,v1=abc" }));

    expect(respuesta.status).toBe(429);
    expect(normalizarEventoRecurrente).not.toHaveBeenCalled();
  });

  it("401 si no viene el header Fintoc-Signature", async () => {
    const respuesta = await POST(crearRequest("{}"));

    expect(respuesta.status).toBe(401);
    const body = await respuesta.json();
    expect(body.error).toBe("firma_ausente");
    expect(verificarFirmaWebhookFintoc).not.toHaveBeenCalled();
  });

  it("401 fail-closed si el secreto de organización no está configurado", async () => {
    delete process.env.FINTOC_SUSCRIPCION_RECURRENTE_WEBHOOK_SECRET;

    const respuesta = await POST(crearRequest("{}", { "Fintoc-Signature": "t=1,v1=abc" }));

    expect(respuesta.status).toBe(401);
    const body = await respuesta.json();
    expect(body.error).toBe("webhook_no_configurado");
    expect(capturarMensaje).toHaveBeenCalledWith(
      expect.stringContaining("FINTOC_SUSCRIPCION_RECURRENTE_WEBHOOK_SECRET"),
      "error",
      expect.anything(),
    );
  });

  it("401 + alerta si la firma no calza", async () => {
    vi.mocked(verificarFirmaWebhookFintoc).mockReturnValue(false);

    const respuesta = await POST(crearRequest('{"type":"invoice.payment_succeeded"}', {
      "Fintoc-Signature": "t=1,v1=firma-mala",
    }));

    expect(respuesta.status).toBe(401);
    const body = await respuesta.json();
    expect(body.error).toBe("firma_invalida");
    expect(normalizarEventoRecurrente).not.toHaveBeenCalled();
  });

  it("400 si el body no parsea (tras firma válida)", async () => {
    const respuesta = await POST(crearRequest("{ no es json", { "Fintoc-Signature": "t=1,v1=abc" }));

    expect(respuesta.status).toBe(400);
    const body = await respuesta.json();
    expect(body.error).toBe("body_malformado");
  });
});

// =============================================================================
// 6. Evento ignorado
// =============================================================================

describe("POST fintoc-suscripcion-recurrente — evento ignorado", () => {
  it("200 no-op, sin tocar ninguna función de dominio", async () => {
    vi.mocked(normalizarEventoRecurrente).mockReturnValue({ tipo: "ignorado", razon: "tipo no relevante: x" });

    const respuesta = await POST(crearRequest('{"type":"x"}', { "Fintoc-Signature": "t=1,v1=abc" }));
    const body = await respuesta.json();

    expect(respuesta.status).toBe(200);
    expect(body.ignorado).toBe(true);
    expect(confirmarCobroRecurrente).not.toHaveBeenCalled();
    expect(activarMandatoRecurrente).not.toHaveBeenCalled();
    expect(marcarMandatoFallido).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 7. Mandato
// =============================================================================

describe("POST fintoc-suscripcion-recurrente — mandato_activado / mandato_fallido", () => {
  it("mandato_activado: despacha a activarMandatoRecurrente con los ids normalizados", async () => {
    vi.mocked(normalizarEventoRecurrente).mockReturnValue({
      tipo: "mandato_activado",
      mandatoExternoId: "sub_def_123",
      tenantId: "tenant-A",
      suscripcionId: "susc-1",
    });
    vi.mocked(activarMandatoRecurrente).mockResolvedValue("activado");

    const respuesta = await POST(crearRequest('{"type":"checkout_session.finished"}', {
      "Fintoc-Signature": "t=1,v1=abc",
    }));
    const body = await respuesta.json();

    expect(respuesta.status).toBe(200);
    expect(body.resultado).toBe("activado");
    expect(activarMandatoRecurrente).toHaveBeenCalledWith({
      mandatoExternoId: "sub_def_123",
      suscripcionId: "susc-1",
    });
    expect(capturarMensaje).not.toHaveBeenCalled();
  });

  it("mandato_activado sin suscripcionId correlacionable → 200 igual, pero alerta", async () => {
    vi.mocked(normalizarEventoRecurrente).mockReturnValue({
      tipo: "mandato_activado",
      mandatoExternoId: "sub_huerfano",
      tenantId: null,
      suscripcionId: null,
    });
    vi.mocked(activarMandatoRecurrente).mockResolvedValue("sin_suscripcion");

    const respuesta = await POST(crearRequest('{"type":"checkout_session.finished"}', {
      "Fintoc-Signature": "t=1,v1=abc",
    }));

    expect(respuesta.status).toBe(200);
    expect(capturarMensaje).toHaveBeenCalledWith(
      expect.stringContaining("mandato_activado sin suscripcionId"),
      "warning",
      expect.anything(),
    );
  });

  it("mandato_fallido: despacha a marcarMandatoFallido", async () => {
    vi.mocked(normalizarEventoRecurrente).mockReturnValue({
      tipo: "mandato_fallido",
      mandatoExternoId: "sub_1",
      tenantId: "tenant-A",
      suscripcionId: "susc-1",
    });
    vi.mocked(marcarMandatoFallido).mockResolvedValue("fallido_registrado");

    const respuesta = await POST(crearRequest('{"type":"subscription.canceled"}', {
      "Fintoc-Signature": "t=1,v1=abc",
    }));
    const body = await respuesta.json();

    expect(respuesta.status).toBe(200);
    expect(body.resultado).toBe("fallido_registrado");
    expect(marcarMandatoFallido).toHaveBeenCalledWith({ suscripcionId: "susc-1" });
  });
});

// =============================================================================
// 8-9. Cobro — despacho + IDEMPOTENCIA ante entrega duplicada
// =============================================================================

describe("POST fintoc-suscripcion-recurrente — cobro_exitoso / cobro_fallido", () => {
  function eventoCobroExitoso() {
    return {
      tipo: "cobro_exitoso" as const,
      cobroExternoId: "pi_123",
      periodoId: "periodo-1",
      tenantId: "tenant-A",
      montoClp: 49000,
    };
  }

  it("cobro_exitoso: despacha a confirmarCobroRecurrente, 200 con el resultado", async () => {
    vi.mocked(normalizarEventoRecurrente).mockReturnValue(eventoCobroExitoso());
    vi.mocked(confirmarCobroRecurrente).mockResolvedValue({ resultado: "confirmado", periodoId: "periodo-1" });

    const respuesta = await POST(crearRequest('{"type":"invoice.payment_succeeded"}', {
      "Fintoc-Signature": "t=1,v1=abc",
    }));
    const body = await respuesta.json();

    expect(respuesta.status).toBe(200);
    expect(body).toEqual({ ok: true, resultado: "confirmado", periodoId: "periodo-1" });
    expect(confirmarCobroRecurrente).toHaveBeenCalledWith(eventoCobroExitoso());
  });

  it("IDEMPOTENCIA: entrega DUPLICADA de cobro_exitoso (ya_pagado) → 200 igual, SIN alertar ni tratamiento especial", async () => {
    vi.mocked(normalizarEventoRecurrente).mockReturnValue(eventoCobroExitoso());
    vi.mocked(confirmarCobroRecurrente).mockResolvedValue({ resultado: "ya_pagado", periodoId: "periodo-1" });

    const respuesta = await POST(crearRequest('{"type":"invoice.payment_succeeded"}', {
      "Fintoc-Signature": "t=1,v1=abc",
    }));
    const body = await respuesta.json();

    expect(respuesta.status).toBe(200);
    expect(body).toEqual({ ok: true, resultado: "ya_pagado", periodoId: "periodo-1" });
    expect(capturarMensaje).not.toHaveBeenCalled();
  });

  it("cobro_exitoso sin período resoluble → 200 + alerta 'sin_periodo'", async () => {
    vi.mocked(normalizarEventoRecurrente).mockReturnValue(eventoCobroExitoso());
    vi.mocked(confirmarCobroRecurrente).mockResolvedValue({ resultado: "sin_periodo", periodoId: null });

    const respuesta = await POST(crearRequest('{"type":"invoice.payment_succeeded"}', {
      "Fintoc-Signature": "t=1,v1=abc",
    }));

    expect(respuesta.status).toBe(200);
    expect(capturarMensaje).toHaveBeenCalledWith(
      expect.stringContaining("no corresponde a ningún período conocido"),
      "warning",
      expect.anything(),
    );
  });

  it("cobro_exitoso con monto discrepante (H-4) → 200 + alerta, no se trata como error", async () => {
    vi.mocked(normalizarEventoRecurrente).mockReturnValue(eventoCobroExitoso());
    vi.mocked(confirmarCobroRecurrente).mockResolvedValue({ resultado: "monto_discrepante", periodoId: "periodo-1" });

    const respuesta = await POST(crearRequest('{"type":"invoice.payment_succeeded"}', {
      "Fintoc-Signature": "t=1,v1=abc",
    }));

    expect(respuesta.status).toBe(200);
    expect(capturarMensaje).toHaveBeenCalledWith(
      expect.stringContaining("monto discrepante"),
      "warning",
      expect.anything(),
    );
  });

  it("cobro_fallido: despacha a confirmarCobroRecurrente igual que cobro_exitoso", async () => {
    vi.mocked(normalizarEventoRecurrente).mockReturnValue({
      tipo: "cobro_fallido",
      cobroExternoId: "pi_123",
      periodoId: "periodo-1",
      tenantId: "tenant-A",
      motivoSaneado: "fondos insuficientes",
    });
    vi.mocked(confirmarCobroRecurrente).mockResolvedValue({ resultado: "fallido_registrado", periodoId: "periodo-1" });

    const respuesta = await POST(crearRequest('{"type":"invoice.payment_failed"}', {
      "Fintoc-Signature": "t=1,v1=abc",
    }));
    const body = await respuesta.json();

    expect(respuesta.status).toBe(200);
    expect(body.resultado).toBe("fallido_registrado");
  });
});

// =============================================================================
// 10. Error inesperado
// =============================================================================

describe("POST fintoc-suscripcion-recurrente — error inesperado", () => {
  it("500 si confirmarCobroRecurrente lanza, sin exponer detalles internos", async () => {
    vi.mocked(normalizarEventoRecurrente).mockReturnValue({
      tipo: "cobro_exitoso",
      cobroExternoId: "pi_123",
      periodoId: "periodo-1",
      tenantId: "tenant-A",
      montoClp: 49000,
    });
    vi.mocked(confirmarCobroRecurrente).mockRejectedValue(new Error("timeout de BD interno"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const respuesta = await POST(crearRequest('{"type":"invoice.payment_succeeded"}', {
      "Fintoc-Signature": "t=1,v1=abc",
    }));
    const body = await respuesta.json();

    expect(respuesta.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("timeout de BD interno");
  });
});
