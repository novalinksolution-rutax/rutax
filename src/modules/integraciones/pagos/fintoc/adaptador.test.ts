/**
 * Tests del FintocAdapter: mapeo Movement→MovimientoPago, normalización de RUT
 * en la frontera, y validación de firma de webhook (acepta válida, rechaza
 * manipulada / replay / formato inválido).
 *
 * Unitarios puros — el adaptador no toca BD ni red en estos tests (el mapeo y la
 * firma son funciones puras; las llamadas HTTP se prueban aparte). La firma se
 * construye con el MISMO esquema que la doc oficial de Fintoc
 * (https://docs.fintoc.com/docs/webhooks-validating): HMAC-SHA256 sobre
 * "<timestamp>.<raw_body>", header `t=<ts>,v1=<hex>`.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { FintocAdapter } from "./adaptador";
import { ErrorPagosProveedor } from "../errores";

/** Construye un header `Fintoc-Signature` válido para un cuerpo y secreto dados. */
function firmar(cuerpo: string, secreto: string, timestampSeg: number): string {
  const firma = createHmac("sha256", secreto)
    .update(`${timestampSeg}.${cuerpo}`, "utf8")
    .digest("hex");
  return `t=${timestampSeg},v1=${firma}`;
}

const adaptador = new FintocAdapter("sk_test_dummy");

// ---------------------------------------------------------------------------
// Mapeo Movement → MovimientoPago (vía normalizarEventoTransferencia, que usa el
// mismo mapeo interno y acepta tanto el objeto crudo como el envelope {data}).
// ---------------------------------------------------------------------------

describe("FintocAdapter — mapeo Movement→MovimientoPago", () => {
  it("mapea una transferencia entrante con sender_account (RUT presente)", () => {
    const movement = {
      id: "mov_abc123",
      description: "Transferencia recibida",
      amount: 150000,
      currency: "CLP",
      post_date: "2026-06-10T12:00:00Z",
      transaction_date: "2026-06-10T11:30:00Z",
      type: "transfer",
      sender_account: {
        holder_id: "74.593.127-8",
        holder_name: "Seller SpA",
        number: "00012345",
        institution: { id: "cl_banco_estado", name: "BancoEstado" },
      },
      comment: "pago periodo mayo",
      status: "confirmed",
    };

    const mov = adaptador.normalizarEventoTransferencia(movement);

    expect(mov.movimientoExternoId).toBe("mov_abc123");
    expect(mov.montoClp).toBe(150000);
    expect(mov.esEntrante).toBe(true);
    expect(mov.tipo).toBe("transferencia");
    expect(mov.fechaMovimiento).toBe("2026-06-10");
    // RUT normalizado: sin puntos ni guion.
    expect(mov.contraparteRutNormalizado).toBe("745931278");
    expect(mov.contraparteNombre).toBe("Seller SpA");
    expect(mov.glosa).toBe("pago periodo mayo");
    expect(mov.estado).toBe("confirmed");
    expect(mov.payloadCrudo).toMatchObject({ id: "mov_abc123" });
  });

  it("mapea un movimiento SIN sender_account → contraparteRutNormalizado=null", () => {
    const movement = {
      id: "mov_sin_remitente",
      amount: 99000,
      currency: "CLP",
      post_date: "2026-06-01T00:00:00Z",
      type: "transfer",
      sender_account: null,
      status: "confirmed",
    };

    const mov = adaptador.normalizarEventoTransferencia(movement);

    expect(mov.contraparteRutNormalizado).toBeNull();
    expect(mov.contraparteNombre).toBeNull();
    expect(mov.esEntrante).toBe(true);
    expect(mov.tipo).toBe("transferencia");
  });

  it("mapea type 'other' → 'otro' y respeta el signo del monto (saliente)", () => {
    const movement = {
      id: "mov_comision",
      amount: -1190,
      currency: "CLP",
      post_date: "2026-06-02T00:00:00Z",
      type: "other",
      status: "confirmed",
    };

    const mov = adaptador.normalizarEventoTransferencia(movement);

    expect(mov.tipo).toBe("otro");
    expect(mov.montoClp).toBe(-1190);
    expect(mov.esEntrante).toBe(false);
  });

  it("acepta el evento envuelto en envelope {data: Movement}", () => {
    const evento = {
      id: "evt_xyz",
      type: "transfer.inbound.succeeded",
      mode: "test",
      data: {
        id: "mov_envuelto",
        amount: 50000,
        type: "transfer",
        post_date: "2026-06-05T00:00:00Z",
        status: "confirmed",
        sender_account: { holder_id: "12345678K", holder_name: "Otro Seller" },
      },
    };

    const mov = adaptador.normalizarEventoTransferencia(evento);
    expect(mov.movimientoExternoId).toBe("mov_envuelto");
    expect(mov.contraparteRutNormalizado).toBe("12345678K");
  });

  it("lanza ErrorPagosProveedor si el payload no tiene un movimiento reconocible", () => {
    expect(() => adaptador.normalizarEventoTransferencia({ foo: "bar" })).toThrow(
      ErrorPagosProveedor,
    );
    expect(() => adaptador.normalizarEventoTransferencia(null)).toThrow(ErrorPagosProveedor);
  });
});

// ---------------------------------------------------------------------------
// Validación de firma de webhook
// ---------------------------------------------------------------------------

describe("FintocAdapter — validarFirmaWebhook", () => {
  const secreto = "whsec_prueba_123";
  const cuerpo = '{"id":"evt_DyzYBwdC07ao5MqG","type":"transfer.inbound.succeeded"}';

  it("acepta una firma válida dentro de la tolerancia", () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = firmar(cuerpo, secreto, ts);

    expect(
      adaptador.validarFirmaWebhook({
        cuerpoCrudo: cuerpo,
        firmaHeader: header,
        secretoWebhook: secreto,
      }),
    ).toBe(true);
  });

  it("rechaza una firma manipulada (v1 alterado)", () => {
    const ts = Math.floor(Date.now() / 1000);
    const valido = firmar(cuerpo, secreto, ts);
    // Voltear el último carácter hex de la firma → firma distinta, misma longitud.
    const manipulado = valido.slice(0, -1) + (valido.slice(-1) === "a" ? "b" : "a");

    expect(
      adaptador.validarFirmaWebhook({
        cuerpoCrudo: cuerpo,
        firmaHeader: manipulado,
        secretoWebhook: secreto,
      }),
    ).toBe(false);
  });

  it("rechaza si el cuerpo fue alterado tras firmar (raw body distinto)", () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = firmar(cuerpo, secreto, ts);

    expect(
      adaptador.validarFirmaWebhook({
        cuerpoCrudo: cuerpo + " ", // un byte distinto rompe la firma
        firmaHeader: header,
        secretoWebhook: secreto,
      }),
    ).toBe(false);
  });

  it("rechaza si el secreto es incorrecto", () => {
    const ts = Math.floor(Date.now() / 1000);
    const header = firmar(cuerpo, secreto, ts);

    expect(
      adaptador.validarFirmaWebhook({
        cuerpoCrudo: cuerpo,
        firmaHeader: header,
        secretoWebhook: "whsec_otro_secreto",
      }),
    ).toBe(false);
  });

  it("rechaza un timestamp fuera de la tolerancia (anti-replay)", () => {
    const tsViejo = Math.floor(Date.now() / 1000) - 3600; // 1 hora atrás
    const header = firmar(cuerpo, secreto, tsViejo);

    expect(
      adaptador.validarFirmaWebhook({
        cuerpoCrudo: cuerpo,
        firmaHeader: header,
        secretoWebhook: secreto,
      }),
    ).toBe(false);
  });

  it("rechaza un header con formato inválido (sin t o sin v1)", () => {
    for (const header of ["", "garbage", "v1=abc", "t=123", "t=abc,v1=def"]) {
      expect(
        adaptador.validarFirmaWebhook({
          cuerpoCrudo: cuerpo,
          firmaHeader: header,
          secretoWebhook: secreto,
        }),
      ).toBe(false);
    }
  });

  it("nunca incluye el secreto en el resultado (devuelve booleano, no lanza con secreto)", () => {
    // Contrato: validarFirmaWebhook devuelve boolean, no expone el secreto.
    const resultado = adaptador.validarFirmaWebhook({
      cuerpoCrudo: cuerpo,
      firmaHeader: "t=1,v1=deadbeef",
      secretoWebhook: secreto,
    });
    expect(typeof resultado).toBe("boolean");
  });
});
