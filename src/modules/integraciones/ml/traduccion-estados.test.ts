/**
 * Pruebas de traduccion-estados.ts
 *
 * Verifica que todos los estados conocidos de ML se traduzcan correctamente,
 * y que valores desconocidos devuelvan `null` sin lanzar.
 */
import { describe, expect, it } from "vitest";

import {
  ESTADOS_ML_CON_TRANSICION,
  estadoMlEsConocido,
  traducirEstadoMl,
} from "./traduccion-estados";

describe("traducirEstadoMl — estados con transición conocida", () => {
  it("'shipped' → 'en_ruta'", () => {
    expect(traducirEstadoMl("shipped")).toBe("en_ruta");
  });

  it("'delivered' → 'entregado'", () => {
    expect(traducirEstadoMl("delivered")).toBe("entregado");
  });

  it("'not_delivered' → 'fallido'", () => {
    expect(traducirEstadoMl("not_delivered")).toBe("fallido");
  });

  it("'cancelled' → 'cancelado'", () => {
    expect(traducirEstadoMl("cancelled")).toBe("cancelado");
  });
});

describe("traducirEstadoMl — estados conocidos sin transición (null)", () => {
  it("'to_be_agreed' → null (sin transición en nuestro modelo)", () => {
    expect(traducirEstadoMl("to_be_agreed")).toBeNull();
  });

  it("'ready_to_ship' → null (pre-despacho, fuera del ciclo Flex)", () => {
    expect(traducirEstadoMl("ready_to_ship")).toBeNull();
  });

  it("'handling' → null (preparación, fuera del ciclo)", () => {
    expect(traducirEstadoMl("handling")).toBeNull();
  });
});

describe("traducirEstadoMl — valores desconocidos", () => {
  it("estado completamente desconocido → null (sin lanzar)", () => {
    expect(traducirEstadoMl("estado_inventado_por_ml")).toBeNull();
  });

  it("string vacío → null (sin lanzar)", () => {
    expect(traducirEstadoMl("")).toBeNull();
  });

  it("capitalización diferente (mayúsculas) → misma traducción", () => {
    expect(traducirEstadoMl("SHIPPED")).toBe("en_ruta");
    expect(traducirEstadoMl("Delivered")).toBe("entregado");
  });

  it("con espacios extra → normaliza y traduce", () => {
    expect(traducirEstadoMl("  shipped  ")).toBe("en_ruta");
  });
});

describe("estadoMlEsConocido", () => {
  it("retorna true para estados con transición", () => {
    expect(estadoMlEsConocido("shipped")).toBe(true);
    expect(estadoMlEsConocido("delivered")).toBe(true);
    expect(estadoMlEsConocido("not_delivered")).toBe(true);
    expect(estadoMlEsConocido("cancelled")).toBe(true);
  });

  it("retorna true para estados SIN transición (conocidos pero ignorados)", () => {
    expect(estadoMlEsConocido("to_be_agreed")).toBe(true);
    expect(estadoMlEsConocido("ready_to_ship")).toBe(true);
    expect(estadoMlEsConocido("handling")).toBe(true);
  });

  it("retorna false para estados completamente desconocidos", () => {
    expect(estadoMlEsConocido("nuevo_estado_futuro")).toBe(false);
  });
});

describe("ESTADOS_ML_CON_TRANSICION", () => {
  it("incluye todos los estados que producen una transición en el sistema", () => {
    expect(ESTADOS_ML_CON_TRANSICION).toContain("shipped");
    expect(ESTADOS_ML_CON_TRANSICION).toContain("delivered");
    expect(ESTADOS_ML_CON_TRANSICION).toContain("not_delivered");
    expect(ESTADOS_ML_CON_TRANSICION).toContain("cancelled");
  });

  it("no incluye estados sin transición", () => {
    expect(ESTADOS_ML_CON_TRANSICION).not.toContain("to_be_agreed");
    expect(ESTADOS_ML_CON_TRANSICION).not.toContain("ready_to_ship");
    expect(ESTADOS_ML_CON_TRANSICION).not.toContain("handling");
  });
});
