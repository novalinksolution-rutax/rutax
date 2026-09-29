import { describe, expect, it } from "vitest";
import {
  evaluarPuestaEnMarcha,
  leerGatePuestaEnMarcha,
  resolverPasoPermitido,
  type DatosPuestaEnMarcha,
} from "./puesta-en-marcha";

function completos(): DatosPuestaEnMarcha {
  return {
    empresa: { nombreFantasia: "Despachos del Sur", telefono: "+56912345678", email: "a@b.cl" },
    bodegaPrincipal: { geoEstado: "resuelto" },
    config: { horaSalida: "16:00:00", horaCorte: "21:00:00", pasoGuardado: 4, completadaEn: null },
    tarifaGeneralActiva: true,
  };
}

describe("evaluarPuestaEnMarcha", () => {
  it("falla cerrado sin datos", () => {
    const e = evaluarPuestaEnMarcha(null);
    expect(e.leido).toBe(false);
    expect(e.completada).toBe(false);
    expect(e.todosLosPasosCompletos).toBe(false);
    expect(e.primerPasoIncompleto).toBe(1);
  });

  it("sin fila de configuración no hay marca ni paso 3", () => {
    const e = evaluarPuestaEnMarcha({ ...completos(), config: null });
    expect(e.completada).toBe(false);
    expect(e.pasos).toEqual([true, true, false, true]);
    expect(e.primerPasoIncompleto).toBe(3);
  });

  it("cuatro pasos con datos no equivalen a completada: falta la marca", () => {
    const e = evaluarPuestaEnMarcha(completos());
    expect(e.todosLosPasosCompletos).toBe(true);
    expect(e.completada).toBe(false);
    expect(e.primerPasoIncompleto).toBeNull();
  });

  it("la marca abre el producto aunque falten datos (courier existente)", () => {
    const d = completos();
    d.bodegaPrincipal = null;
    d.tarifaGeneralActiva = false;
    d.config!.completadaEn = "2026-01-01T00:00:00Z";
    const e = evaluarPuestaEnMarcha(d);
    expect(e.completada).toBe(true);
    expect(e.todosLosPasosCompletos).toBe(false);
  });

  it("paso 1 exige nombre, teléfono y correo", () => {
    for (const campo of ["nombreFantasia", "telefono", "email"] as const) {
      const d = completos();
      d.empresa[campo] = "  ";
      expect(evaluarPuestaEnMarcha(d).pasos[0]).toBe(false);
    }
  });

  it("paso 2 exige geo resuelto", () => {
    for (const geo of ["pendiente", "no_resuelto", null]) {
      const d = completos();
      d.bodegaPrincipal = { geoEstado: geo };
      expect(evaluarPuestaEnMarcha(d).pasos[1]).toBe(false);
    }
  });

  it("paso 3 exige corte posterior a la salida", () => {
    const d = completos();
    d.config!.horaCorte = "16:00:00";
    expect(evaluarPuestaEnMarcha(d).pasos[2]).toBe(false);
    d.config!.horaCorte = "basura";
    expect(evaluarPuestaEnMarcha(d).pasos[2]).toBe(false);
  });

  it("paso 4 sigue a la tarifa general", () => {
    const d = completos();
    d.tarifaGeneralActiva = false;
    const e = evaluarPuestaEnMarcha(d);
    expect(e.pasos[3]).toBe(false);
    expect(e.primerPasoIncompleto).toBe(4);
  });
});

describe("resolverPasoPermitido", () => {
  const e = evaluarPuestaEnMarcha({ ...completos(), config: null }); // primer incompleto = 3
  it("no deja saltar adelante", () => {
    expect(resolverPasoPermitido(e, "4")).toBe(3);
    expect(resolverPasoPermitido(e, "5")).toBe(3);
  });
  it("deja volver atrás", () => {
    expect(resolverPasoPermitido(e, "1")).toBe(1);
    expect(resolverPasoPermitido(e, "3")).toBe(3);
  });
  it("valor ilegible cae al primer incompleto", () => {
    expect(resolverPasoPermitido(e, undefined)).toBe(3);
    expect(resolverPasoPermitido(e, "x")).toBe(3);
    expect(resolverPasoPermitido(e, "0")).toBe(3);
  });
  it("con todo completo el destino natural es el cierre", () => {
    const todo = evaluarPuestaEnMarcha(completos());
    expect(resolverPasoPermitido(todo, undefined)).toBe(5);
    expect(resolverPasoPermitido(todo, "2")).toBe(2);
  });
});

function clienteGate(respuesta: { data: unknown; error: unknown } | "lanza") {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (respuesta === "lanza") throw new Error("red");
            return respuesta;
          },
        }),
      }),
    }),
  } as never;
}

describe("leerGatePuestaEnMarcha", () => {
  it("con marca: completada", async () => {
    const r = await leerGatePuestaEnMarcha(
      clienteGate({ data: { puesta_en_marcha_completada_en: "2026-09-01T00:00:00Z" }, error: null }),
      "t",
    );
    expect(r).toEqual({ estado: "completada", porAsistente: false });
  });
  it("sin fila: pendiente (fail-closed)", async () => {
    expect(await leerGatePuestaEnMarcha(clienteGate({ data: null, error: null }), "t")).toEqual({ estado: "pendiente", porAsistente: false });
  });
  it("fila sin marca: pendiente", async () => {
    const r = await leerGatePuestaEnMarcha(
      clienteGate({ data: { puesta_en_marcha_completada_en: null }, error: null }),
      "t",
    );
    expect(r.estado).toBe("pendiente");
  });
  it("la marca con autor es del asistente", async () => {
    const r = await leerGatePuestaEnMarcha(
      clienteGate({
        data: { puesta_en_marcha_completada_en: "2026-09-01T00:00:00Z", puesta_en_marcha_completada_por: "u1" },
        error: null,
      }),
      "t",
    );
    expect(r.porAsistente).toBe(true);
  });
  it("error de lectura o excepción: error, nunca completada", async () => {
    expect(await leerGatePuestaEnMarcha(clienteGate({ data: null, error: { message: "x" } }), "t")).toEqual({ estado: "error", porAsistente: false });
    expect(await leerGatePuestaEnMarcha(clienteGate("lanza"), "t")).toEqual({ estado: "error", porAsistente: false });
  });
});
