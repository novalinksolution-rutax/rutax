/**
 * Pruebas del parser de códigos de bulto. Puras, sin red ni BD.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  codigoVisibleDeBulto,
  derivarResolucionBulto,
  LARGO_MAX_CODIGO_NORMALIZADO,
  LARGO_MUESTRA_DESCONOCIDO,
  parsearCodigoBulto,
} from "./parser-codigo";

// Payload real capturado escaneando una etiqueta Flex con un lector genérico
// (docs/arquitectura/retiro-y-ruteo.md §3).
const PAYLOAD_FLEX_REAL =
  '{"id":"44760788897","sender_id":2114191787,"hash_code":"fwH77GO2qbT3SrRS/UKb14MN2s5JA3AhWG4Pen/l6WY=","security_digit":"0"}';

describe("parsearCodigoBulto — flex_qr", () => {
  it("reconoce el payload real de la etiqueta Flex", () => {
    const resultado = parsearCodigoBulto(PAYLOAD_FLEX_REAL);

    expect(resultado.formato).toBe("flex_qr");
    expect(resultado.codigoNormalizado).toBe("44760788897");
    expect(resultado.mlShipmentId).toBe("44760788897");
    expect(resultado.mlUserId).toBe("2114191787");
    expect(resultado.muestraCodigo).toBeNull();
    expect(resultado.credencial).toEqual({
      tipoPayload: "flex_hash",
      hashCode: "fwH77GO2qbT3SrRS/UKb14MN2s5JA3AhWG4Pen/l6WY=",
      securityDigit: "0",
    });
  });

  it("acepta sender_id numérico y lo normaliza a string (la forma real del payload)", () => {
    const resultado = parsearCodigoBulto('{"id":"1","sender_id":999}');
    expect(resultado.mlUserId).toBe("999");
  });

  it("acepta id numérico también (defensivo ante variantes del formato)", () => {
    const resultado = parsearCodigoBulto('{"id":123,"sender_id":"456"}');
    expect(resultado.formato).toBe("flex_qr");
    expect(resultado.mlShipmentId).toBe("123");
  });

  it("sin hash_code, no arma credencial (nada irrecuperable que preservar)", () => {
    const resultado = parsearCodigoBulto('{"id":"1"}');
    expect(resultado.formato).toBe("flex_qr");
    expect(resultado.credencial).toBeNull();
  });

  it("sender_id ausente → mlUserId null, sin reventar", () => {
    const resultado = parsearCodigoBulto('{"id":"1","hash_code":"abc"}');
    expect(resultado.mlUserId).toBeNull();
  });

  it("un id sospechosamente largo NO se clasifica flex_qr (cae a desconocido)", () => {
    const idLargo = "9".repeat(200);
    const resultado = parsearCodigoBulto(`{"id":"${idLargo}"}`);
    expect(resultado.formato).toBe("desconocido");
  });

  it("un array JSON válido no es un flex_qr", () => {
    expect(parsearCodigoBulto("[1,2,3]").formato).toBe("desconocido");
  });

  it("JSON con id vacío no es un flex_qr", () => {
    expect(parsearCodigoBulto('{"id":"   "}').formato).toBe("desconocido");
  });
});

describe("parsearCodigoBulto — rutax_interno", () => {
  it("reconoce el codigo_interno tal cual", () => {
    const resultado = parsearCodigoBulto("RX-7K2M-9PQR");
    expect(resultado.formato).toBe("rutax_interno");
    expect(resultado.codigoNormalizado).toBe("RX-7K2M-9PQR");
    expect(resultado.credencial).toBeNull(); // Rutax lo emitió: siempre lo regenera.
  });

  it("normaliza a mayúsculas y sin espacios", () => {
    const resultado = parsearCodigoBulto("  rx-7k2m-9pqr  ");
    expect(resultado.formato).toBe("rutax_interno");
    expect(resultado.codigoNormalizado).toBe("RX-7K2M-9PQR");
  });

  it("un código con letras prohibidas del alfabeto Crockford (I, L, O, U) no matchea", () => {
    // El patrón de esCodigoInternoValido ya excluye I/L/O/U; confirma que el
    // parser hereda esa validación en vez de reimplementarla.
    expect(parsearCodigoBulto("RX-IIII-OOOO").formato).not.toBe("rutax_interno");
  });
});

describe("parsearCodigoBulto — desconocido (la red de seguridad)", () => {
  it("nunca lanza, cualquiera sea el crudo", () => {
    expect(() => parsearCodigoBulto("")).not.toThrow();
    expect(() => parsearCodigoBulto("no es json ni RX")).not.toThrow();
    expect(() => parsearCodigoBulto("{ json a medias")).not.toThrow();
  });

  it("codigoNormalizado es sha256:<hex> del crudo — determinístico y acotado", () => {
    const crudo = "un código que Rutax no entiende";
    const resultado = parsearCodigoBulto(crudo);
    const hashEsperado = createHash("sha256").update(crudo, "utf8").digest("hex");

    expect(resultado.formato).toBe("desconocido");
    expect(resultado.codigoNormalizado).toBe(`sha256:${hashEsperado}`);
    expect(resultado.codigoNormalizado.length).toBeLessThanOrEqual(LARGO_MAX_CODIGO_NORMALIZADO);
  });

  it("el mismo crudo desconocido produce SIEMPRE el mismo codigo_normalizado (dedup del doble escaneo)", () => {
    const crudo = "garabato-de-otro-sistema-123";
    expect(parsearCodigoBulto(crudo).codigoNormalizado).toBe(parsearCodigoBulto(crudo).codigoNormalizado);
  });

  it("muestraCodigo son los primeros 24 caracteres DEL CRUDO, no del hash", () => {
    const crudo = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-de-mas-de-24";
    const resultado = parsearCodigoBulto(crudo);
    expect(resultado.muestraCodigo).toBe(crudo.slice(0, LARGO_MUESTRA_DESCONOCIDO));
    expect(resultado.muestraCodigo).toHaveLength(LARGO_MUESTRA_DESCONOCIDO);
  });

  it("guarda el crudo completo como credencial 'codigo_crudo' — es la única fuente que queda de él", () => {
    const crudo = "algo raro escaneado por error";
    const resultado = parsearCodigoBulto(crudo);
    expect(resultado.credencial).toEqual({ tipoPayload: "codigo_crudo", valor: crudo });
  });

  it("mlShipmentId y mlUserId son null (CHECK bultos_retiro_desconocido_sin_vinculo)", () => {
    const resultado = parsearCodigoBulto("cualquier cosa");
    expect(resultado.mlShipmentId).toBeNull();
    expect(resultado.mlUserId).toBeNull();
  });
});

describe("codigoVisibleDeBulto", () => {
  it("prioriza ml_shipment_id (Flex)", () => {
    expect(
      codigoVisibleDeBulto({ mlShipmentId: "123", muestraCodigo: "xx", codigoNormalizado: "sha256:aa" }),
    ).toBe("123");
  });

  it("cae a muestraCodigo cuando no hay shipment id (desconocido)", () => {
    expect(
      codigoVisibleDeBulto({ mlShipmentId: null, muestraCodigo: "garabato", codigoNormalizado: "sha256:aa" }),
    ).toBe("garabato");
  });

  it("cae a codigoNormalizado para rutax_interno (el propio codigo_interno)", () => {
    expect(
      codigoVisibleDeBulto({ mlShipmentId: null, muestraCodigo: null, codigoNormalizado: "RX-7K2M-9PQR" }),
    ).toBe("RX-7K2M-9PQR");
  });
});

describe("derivarResolucionBulto — la ÚNICA fuente de esta regla (nunca una columna aparte)", () => {
  it("desconocido -> ilegible, tenga o no pedido_id (el CHECK igual lo prohíbe)", () => {
    expect(derivarResolucionBulto("desconocido", null)).toBe("ilegible");
  });

  it("flex_qr o rutax_interno sin pedido_id -> no_procesado", () => {
    expect(derivarResolucionBulto("flex_qr", null)).toBe("no_procesado");
    expect(derivarResolucionBulto("rutax_interno", null)).toBe("no_procesado");
  });

  it("flex_qr o rutax_interno CON pedido_id -> resuelto", () => {
    expect(derivarResolucionBulto("flex_qr", "40000000-0000-0000-0000-000000000001")).toBe("resuelto");
    expect(derivarResolucionBulto("rutax_interno", "40000000-0000-0000-0000-000000000001")).toBe("resuelto");
  });
});
