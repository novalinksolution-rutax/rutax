import { describe, it, expect } from "vitest";
import { sanearFechaCivil, parsearRangoFecha, ventanaFechaSantiago } from "./fecha";

describe("sanearFechaCivil", () => {
  it("acepta una fecha civil válida", () => {
    expect(sanearFechaCivil("2026-08-16")).toBe("2026-08-16");
  });

  it("rechaza formato o valores inválidos (día/mes fuera de rango)", () => {
    expect(sanearFechaCivil("2026-02-30")).toBe(""); // febrero no tiene 30
    expect(sanearFechaCivil("2026-13-01")).toBe(""); // mes 13
    expect(sanearFechaCivil("2026-8-1")).toBe(""); // sin padding
    expect(sanearFechaCivil("todos")).toBe("");
    expect(sanearFechaCivil(undefined)).toBe("");
  });

  it("acepta el 29 de febrero solo en año bisiesto", () => {
    expect(sanearFechaCivil("2024-02-29")).toBe("2024-02-29");
    expect(sanearFechaCivil("2026-02-29")).toBe("");
  });
});

describe("parsearRangoFecha", () => {
  it("el día exacto gana sobre el rango y lo limpia", () => {
    const r = parsearRangoFecha({ exacto: "2026-08-16", desde: "2026-08-01", hasta: "2026-08-31" });
    expect(r).toEqual({ exacto: "2026-08-16", desde: "", hasta: "", hayFecha: true });
  });

  it("sin exacto, arma el rango", () => {
    const r = parsearRangoFecha({ desde: "2026-08-01", hasta: "2026-08-31" });
    expect(r).toEqual({ exacto: "", desde: "2026-08-01", hasta: "2026-08-31", hayFecha: true });
  });

  it("sin nada válido, no hay fecha", () => {
    expect(parsearRangoFecha({})).toEqual({ exacto: "", desde: "", hasta: "", hayFecha: false });
    expect(parsearRangoFecha({ exacto: "basura" })).toEqual({
      exacto: "",
      desde: "",
      hasta: "",
      hayFecha: false,
    });
  });
});

describe("ventanaFechaSantiago", () => {
  // Chile: INVIERNO = UTC−4 (agosto), VERANO/DST = UTC−3 (enero). La ventana de
  // un día civil debe reflejar ese offset — el bug clásico es clavar `Z` o un
  // offset fijo y correr el día 3–4 h. Estos instantes lo fijan concretamente.
  it("día exacto de invierno (UTC−4): [00:00, 00:00 del día siguiente)", () => {
    const w = ventanaFechaSantiago(parsearRangoFecha({ exacto: "2026-08-16" }));
    expect(w.gte).toBe("2026-08-16T04:00:00.000Z");
    expect(w.lt).toBe("2026-08-17T04:00:00.000Z");
  });

  it("día exacto de verano/DST (UTC−3)", () => {
    const w = ventanaFechaSantiago(parsearRangoFecha({ exacto: "2026-01-15" }));
    expect(w.gte).toBe("2026-01-15T03:00:00.000Z");
    expect(w.lt).toBe("2026-01-16T03:00:00.000Z");
  });

  it("rango: gte = inicio del 'desde', lt = inicio del día siguiente al 'hasta'", () => {
    const w = ventanaFechaSantiago(parsearRangoFecha({ desde: "2026-08-01", hasta: "2026-08-31" }));
    expect(w.gte).toBe("2026-08-01T04:00:00.000Z");
    expect(w.lt).toBe("2026-09-01T04:00:00.000Z");
  });

  it("sin fecha, ventana vacía", () => {
    expect(ventanaFechaSantiago(parsearRangoFecha({}))).toEqual({});
  });
});
