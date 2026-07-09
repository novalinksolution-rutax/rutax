/**
 * Tests del parsing del webhook de PAYOUT SALIENTE de Fintoc (`transfer.outbound.*`).
 *
 * Cubre, sin red ni BD ni credenciales reales:
 * 1. validarFirmaWebhookPayout — firma válida / inválida / expirada / tampering.
 * 2. mapearStatusFintocPayout / normalizarEventoWebhookPayoutFintoc — cada status
 *    (succeeded, failed, rejected, returned≡rejected, pending, return_pending,
 *    reject_failed→desconocido, status desconocido→desconocido) y shape inválido→null.
 * 3. sanitizarPayloadEventoPayout — subconjunto mínimo; `counterparty` EXCLUIDO.
 * 4. FintocPayoutAdapter.normalizarEventoWebhookPayout delega; stub/manual → null.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

import {
  validarFirmaWebhookPayout,
  mapearStatusFintocPayout,
  normalizarEventoWebhookPayoutFintoc,
  sanitizarPayloadEventoPayout,
} from "./fintoc-webhook";
import { FintocPayoutAdapter } from "./fintoc";
import { StubPayoutAdapter } from "./stub";
import { ManualPayoutAdapter } from "./manual";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Header de firma HMAC-SHA256 en el formato Fintoc: `t=<ts>,v1=<hex>` donde el
 * mensaje firmado es `<ts>.<cuerpo>`.
 */
function generarFirmaValida(cuerpo: string, secreto: string, tsSeg?: number): string {
  const ts = tsSeg ?? Math.floor(Date.now() / 1000);
  const hex = createHmac("sha256", secreto).update(`${ts}.${cuerpo}`, "utf8").digest("hex");
  return `t=${ts},v1=${hex}`;
}

/**
 * Envelope de un evento `transfer.outbound.*` de Fintoc. Incluye `counterparty`
 * a propósito (datos bancarios del conductor) para probar que se excluye del
 * saneo. `type` por defecto usa `succeeded`, pero el estado se deriva del
 * `status`, no del `type`.
 */
function eventoOutbound(
  overrides: {
    id?: string;
    type?: string;
    transferId?: string;
    status?: unknown;
    return_reason?: unknown;
    receipt_url?: unknown;
    currency?: unknown;
    amount?: unknown;
    conCounterparty?: boolean;
    dataObject?: boolean;
  } = {},
): Record<string, unknown> {
  const recurso: Record<string, unknown> = {
    id: overrides.transferId ?? "tr_123abc",
    object: "transfer",
    status: "status" in overrides ? overrides.status : "succeeded",
    currency: overrides.currency ?? "CLP",
    amount: overrides.amount ?? 50000,
    return_reason: overrides.return_reason ?? null,
    receipt_url: overrides.receipt_url ?? "https://fintoc.com/receipts/tr_123abc",
  };
  if (overrides.conCounterparty ?? true) {
    recurso.counterparty = {
      account_number: "1234567890",
      holder_id: "12345678-9",
      holder_name: "Conductor Demo",
      institution_id: "cl_banco_estado",
    };
  }
  const data = overrides.dataObject ? { object: recurso } : recurso;
  return {
    id: overrides.id ?? "evt_abc123",
    type: overrides.type ?? "transfer.outbound.succeeded",
    mode: "live",
    created_at: "2026-07-08T12:00:00Z",
    data,
  };
}

// ---------------------------------------------------------------------------
// 1. validarFirmaWebhookPayout
// ---------------------------------------------------------------------------

describe("validarFirmaWebhookPayout", () => {
  const secreto = "whsec_payout_org_muy_largo_y_seguro";
  const cuerpo = JSON.stringify(eventoOutbound());

  it("firma válida dentro de los 300 s → true", () => {
    const firma = generarFirmaValida(cuerpo, secreto);
    expect(validarFirmaWebhookPayout({ cuerpoCrudo: cuerpo, firma, secreto })).toBe(true);
  });

  it("secreto incorrecto → false", () => {
    const firma = generarFirmaValida(cuerpo, secreto);
    expect(
      validarFirmaWebhookPayout({ cuerpoCrudo: cuerpo, firma, secreto: "otro-secreto" }),
    ).toBe(false);
  });

  it("timestamp > 300 s en el pasado → false (anti-replay)", () => {
    const firma = generarFirmaValida(cuerpo, secreto, Math.floor(Date.now() / 1000) - 301);
    expect(validarFirmaWebhookPayout({ cuerpoCrudo: cuerpo, firma, secreto })).toBe(false);
  });

  it("timestamp > 300 s en el futuro → false (anti-replay)", () => {
    const firma = generarFirmaValida(cuerpo, secreto, Math.floor(Date.now() / 1000) + 301);
    expect(validarFirmaWebhookPayout({ cuerpoCrudo: cuerpo, firma, secreto })).toBe(false);
  });

  it("cuerpo alterado tras firmar (tampering) → false", () => {
    const firma = generarFirmaValida(cuerpo, secreto);
    const cuerpoAlterado = JSON.stringify(eventoOutbound({ amount: 999999999 }));
    expect(
      validarFirmaWebhookPayout({ cuerpoCrudo: cuerpoAlterado, firma, secreto }),
    ).toBe(false);
  });

  it("header basura → false sin lanzar", () => {
    expect(() =>
      validarFirmaWebhookPayout({ cuerpoCrudo: cuerpo, firma: "no-es-un-header", secreto }),
    ).not.toThrow();
    expect(
      validarFirmaWebhookPayout({ cuerpoCrudo: cuerpo, firma: "no-es-un-header", secreto }),
    ).toBe(false);
  });

  it("header vacío → false", () => {
    expect(validarFirmaWebhookPayout({ cuerpoCrudo: cuerpo, firma: "", secreto })).toBe(false);
  });

  it("v1 de longitud distinta → false sin excepción", () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(() =>
      validarFirmaWebhookPayout({ cuerpoCrudo: cuerpo, firma: `t=${ts},v1=abc`, secreto }),
    ).not.toThrow();
    expect(
      validarFirmaWebhookPayout({ cuerpoCrudo: cuerpo, firma: `t=${ts},v1=abc`, secreto }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. mapearStatusFintocPayout — conmuta por status (no por type)
// ---------------------------------------------------------------------------

describe("mapearStatusFintocPayout", () => {
  it("succeeded → confirmado", () => {
    expect(mapearStatusFintocPayout("succeeded")).toBe("confirmado");
  });

  it("failed → fallido", () => {
    expect(mapearStatusFintocPayout("failed")).toBe("fallido");
  });

  it("rejected → rechazado", () => {
    expect(mapearStatusFintocPayout("rejected")).toBe("rechazado");
  });

  it("returned → rechazado (MISMO que rejected: inconsistencia de la doc)", () => {
    expect(mapearStatusFintocPayout("returned")).toBe(mapearStatusFintocPayout("rejected"));
    expect(mapearStatusFintocPayout("returned")).toBe("rechazado");
  });

  it("pending → pendiente", () => {
    expect(mapearStatusFintocPayout("pending")).toBe("pendiente");
  });

  it("return_pending → pendiente", () => {
    expect(mapearStatusFintocPayout("return_pending")).toBe("pendiente");
  });

  it("reject_failed → desconocido (status no accionable)", () => {
    expect(mapearStatusFintocPayout("reject_failed")).toBe("desconocido");
  });

  it("status inventado / null / no-string → desconocido", () => {
    expect(mapearStatusFintocPayout("algo_nuevo")).toBe("desconocido");
    expect(mapearStatusFintocPayout(null)).toBe("desconocido");
    expect(mapearStatusFintocPayout(undefined)).toBe("desconocido");
    expect(mapearStatusFintocPayout(42)).toBe("desconocido");
  });
});

// ---------------------------------------------------------------------------
// 3. normalizarEventoWebhookPayoutFintoc
// ---------------------------------------------------------------------------

describe("normalizarEventoWebhookPayoutFintoc", () => {
  it("evento succeeded → estadoExterno confirmado con ids y comprobante", () => {
    const evt = normalizarEventoWebhookPayoutFintoc(eventoOutbound({ status: "succeeded" }));
    expect(evt).not.toBeNull();
    expect(evt!.eventoExternoId).toBe("evt_abc123");
    expect(evt!.transferExternoId).toBe("tr_123abc");
    expect(evt!.estadoExterno).toBe("confirmado");
    expect(evt!.comprobanteRef).toBe("https://fintoc.com/receipts/tr_123abc");
  });

  it("returned produce el MISMO estadoExterno que rejected (rechazado)", () => {
    const returned = normalizarEventoWebhookPayoutFintoc(
      eventoOutbound({ status: "returned", type: "transfer.outbound.returned" }),
    );
    const rejected = normalizarEventoWebhookPayoutFintoc(
      eventoOutbound({ status: "rejected", type: "transfer.outbound.rejected" }),
    );
    expect(returned!.estadoExterno).toBe("rechazado");
    expect(rejected!.estadoExterno).toBe("rechazado");
    expect(returned!.estadoExterno).toBe(rejected!.estadoExterno);
  });

  it("failed → fallido", () => {
    const evt = normalizarEventoWebhookPayoutFintoc(
      eventoOutbound({ status: "failed", type: "transfer.outbound.failed" }),
    );
    expect(evt!.estadoExterno).toBe("fallido");
  });

  it("pending y return_pending → pendiente", () => {
    expect(
      normalizarEventoWebhookPayoutFintoc(eventoOutbound({ status: "pending" }))!.estadoExterno,
    ).toBe("pendiente");
    expect(
      normalizarEventoWebhookPayoutFintoc(eventoOutbound({ status: "return_pending" }))!
        .estadoExterno,
    ).toBe("pendiente");
  });

  it("status desconocido → desconocido", () => {
    const evt = normalizarEventoWebhookPayoutFintoc(eventoOutbound({ status: "reject_failed" }));
    expect(evt!.estadoExterno).toBe("desconocido");
  });

  it("extrae y sanea el motivo desde return_reason", () => {
    const evt = normalizarEventoWebhookPayoutFintoc(
      eventoOutbound({ status: "returned", return_reason: "  AC01  " }),
    );
    expect(evt!.motivo).toBe("AC01");
  });

  it("return_reason ausente → motivo null", () => {
    const evt = normalizarEventoWebhookPayoutFintoc(eventoOutbound({ return_reason: null }));
    expect(evt!.motivo).toBeNull();
  });

  it("acepta el recurso bajo data.object (robustez de shape)", () => {
    const evt = normalizarEventoWebhookPayoutFintoc(eventoOutbound({ dataObject: true }));
    expect(evt).not.toBeNull();
    expect(evt!.transferExternoId).toBe("tr_123abc");
    expect(evt!.estadoExterno).toBe("confirmado");
  });

  it("evento que NO es transfer.outbound (inbound) → null", () => {
    const inbound = eventoOutbound({ type: "transfer.inbound.succeeded" });
    expect(normalizarEventoWebhookPayoutFintoc(inbound)).toBeNull();
  });

  it("sin id de evento → null (no hay barrera de idempotencia)", () => {
    const sinId = eventoOutbound();
    delete (sinId as Record<string, unknown>).id;
    expect(normalizarEventoWebhookPayoutFintoc(sinId)).toBeNull();
  });

  it("sin id de transfer → null", () => {
    const evt = eventoOutbound({ transferId: "" });
    expect(normalizarEventoWebhookPayoutFintoc(evt)).toBeNull();
  });

  it("payload no-objeto (string / null) → null", () => {
    expect(normalizarEventoWebhookPayoutFintoc("no soy json")).toBeNull();
    expect(normalizarEventoWebhookPayoutFintoc(null)).toBeNull();
    expect(normalizarEventoWebhookPayoutFintoc(undefined)).toBeNull();
  });

  it("el payloadSanitizado embebido NO contiene counterparty", () => {
    const evt = normalizarEventoWebhookPayoutFintoc(eventoOutbound({ conCounterparty: true }));
    expect(evt!.payloadSanitizado).not.toHaveProperty("counterparty");
    expect(JSON.stringify(evt!.payloadSanitizado)).not.toContain("holder_id");
  });
});

// ---------------------------------------------------------------------------
// 4. sanitizarPayloadEventoPayout — subconjunto mínimo, sin datos sensibles
// ---------------------------------------------------------------------------

describe("sanitizarPayloadEventoPayout", () => {
  it("produce SOLO las 7 llaves no sensibles esperadas", () => {
    const saneado = sanitizarPayloadEventoPayout(eventoOutbound());
    expect(saneado).not.toBeNull();
    expect(Object.keys(saneado!).sort()).toEqual(
      [
        "amount",
        "currency",
        "eventoExternoId",
        "receiptUrl",
        "returnReason",
        "status",
        "transferExternoId",
      ].sort(),
    );
  });

  it("EXCLUYE counterparty aunque venga en el crudo (datos bancarios del conductor)", () => {
    const crudo = eventoOutbound({ conCounterparty: true });
    // El crudo SÍ trae counterparty…
    expect(JSON.stringify(crudo)).toContain("holder_id");
    const saneado = sanitizarPayloadEventoPayout(crudo)!;
    // …pero el saneado NO lo propaga por ninguna vía.
    expect(saneado).not.toHaveProperty("counterparty");
    expect(JSON.stringify(saneado)).not.toContain("holder_id");
    expect(JSON.stringify(saneado)).not.toContain("account_number");
    expect(JSON.stringify(saneado)).not.toContain("Conductor Demo");
  });

  it("status es el valor CRUDO de Fintoc (no el estado ya mapeado)", () => {
    const saneado = sanitizarPayloadEventoPayout(eventoOutbound({ status: "returned" }))!;
    expect(saneado.status).toBe("returned"); // no "rechazado"
  });

  it("copia currency y amount tal cual; ids del evento y del transfer", () => {
    const saneado = sanitizarPayloadEventoPayout(
      eventoOutbound({ currency: "CLP", amount: 73210 }),
    )!;
    expect(saneado.currency).toBe("CLP");
    expect(saneado.amount).toBe(73210);
    expect(saneado.eventoExternoId).toBe("evt_abc123");
    expect(saneado.transferExternoId).toBe("tr_123abc");
  });

  it("shape inválido → null", () => {
    expect(sanitizarPayloadEventoPayout({ type: "transfer.inbound.succeeded" })).toBeNull();
    expect(sanitizarPayloadEventoPayout(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Integración con los adaptadores del puerto
// ---------------------------------------------------------------------------

describe("PuertoPayout.normalizarEventoWebhookPayout — por adaptador", () => {
  it("FintocPayoutAdapter delega en el normalizador de Fintoc", () => {
    const adaptador = new FintocPayoutAdapter({
      secretKeyOrg: "sk_test",
      accountIdOrigen: "acc-1",
      clavePrivadaFirmaPem: null,
    });
    const evt = adaptador.normalizarEventoWebhookPayout(eventoOutbound({ status: "succeeded" }));
    expect(evt).not.toBeNull();
    expect(evt!.estadoExterno).toBe("confirmado");
    expect(evt!.eventoExternoId).toBe("evt_abc123");
  });

  it("StubPayoutAdapter y ManualPayoutAdapter → null (no procesan webhooks)", () => {
    const evtCrudo = eventoOutbound();
    expect(new StubPayoutAdapter().normalizarEventoWebhookPayout(evtCrudo)).toBeNull();
    expect(new ManualPayoutAdapter().normalizarEventoWebhookPayout(evtCrudo)).toBeNull();
  });
});
