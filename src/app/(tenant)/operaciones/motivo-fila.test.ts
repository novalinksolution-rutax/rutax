import { describe, expect, it } from "vitest";

import { lineaSecundaria, motivoDeFila, nombreCortoConductor } from "./motivo-fila";
import type { Pedido } from "@/modules/operacion/tipos";

type Campos = Pick<Pedido, "estado" | "motivoCancelacion" | "geoEstado" | "coberturaEstado">;

const sano: Campos = {
  estado: "asignado",
  motivoCancelacion: null,
  geoEstado: "resuelto",
  coberturaEstado: "tarifada",
};

describe("motivoDeFila", () => {
  it("no inventa motivo cuando no hay ninguno", () => {
    expect(motivoDeFila(sano)).toBeNull();
  });

  it("la cancelación gana sobre todo lo demás", () => {
    // Un pedido cancelado Y con la dirección sin ubicar: contestar «Fuera de
    // cobertura» sería contestar la pregunta de ayer.
    const m = motivoDeFila(
      {
        ...sano,
        estado: "cancelado",
        motivoCancelacion: "El seller anuló la venta",
        geoEstado: "fuera_cobertura",
      },
      "destinatario_ausente",
    );
    expect(m).toEqual({ origen: "cancelacion", texto: "El seller anuló la venta" });
  });

  it("un cancelado sin motivo escrito no deja la celda muda", () => {
    const m = motivoDeFila({ ...sano, estado: "cancelado", motivoCancelacion: "   " });
    expect(m?.origen).toBe("cancelacion");
    expect(m?.texto).toBe("Cancelado sin motivo registrado");
  });

  it("la incidencia viva gana sobre el problema de dirección", () => {
    const m = motivoDeFila({ ...sano, geoEstado: "no_resuelto" }, "destinatario_ausente");
    expect(m).toEqual({ origen: "incidencia", texto: "Destinatario ausente" });
  });

  it("sin incidencia, informa el problema de dirección", () => {
    expect(motivoDeFila({ ...sano, geoEstado: "fuera_cobertura" })?.origen).toBe("geo");
    expect(motivoDeFila({ ...sano, coberturaEstado: "sin_tarifa_zona" })?.origen).toBe("cobertura");
  });

  it("una incidencia ya resuelta no llega acá: se pasa null", () => {
    expect(motivoDeFila(sano, null)).toBeNull();
  });
});

describe("lineaSecundaria", () => {
  it("arma la línea del teléfono: código · comuna · conductor", () => {
    expect(
      lineaSecundaria({ codigo: "RX-7K2M-9PQR", comuna: "Ñuñoa", conductor: "R. Muñoz" }),
    ).toEqual(["RX-7K2M-9PQR", "Ñuñoa", "R. Muñoz"]);
  });

  it("el motivo desplaza a la comuna: por qué manda sobre dónde", () => {
    expect(
      lineaSecundaria({
        codigo: "RX-3H8P-5MKL",
        comuna: "Ñuñoa",
        motivo: { origen: "incidencia", texto: "Destinatario ausente" },
      }),
    ).toEqual(["RX-3H8P-5MKL", "Destinatario ausente"]);
  });

  it("sin conductor no deja un separador colgando", () => {
    expect(lineaSecundaria({ codigo: "RX-8L4N-2TRS", comuna: "Maipú", conductor: null })).toEqual([
      "RX-8L4N-2TRS",
      "Maipú",
    ]);
  });

  it("el seller NO entra, aunque sea una de las columnas que cae", () => {
    // Se sigue el dibujo del tablero, no la regla en prosa. Si alguien agrega el
    // seller acá, esta prueba se lo dice.
    const linea = lineaSecundaria({ codigo: "RX-1", comuna: "Macul", conductor: "C. Vera" });
    expect(linea).toHaveLength(3);
    expect(linea.join(" ")).not.toMatch(/seller/i);
  });

  it("aguanta un pedido sin código y sin comuna sin devolver basura", () => {
    expect(lineaSecundaria({ codigo: null, comuna: null })).toEqual([]);
  });
});

describe("nombreCortoConductor", () => {
  it("abrevia un nombre compuesto con dos apellidos", () => {
    // El caso real que hacía desaparecer al conductor tras el truncado.
    expect(nombreCortoConductor("Francisco Javier Castro López")).toBe("F. Castro");
  });

  it("deja en paz lo que ya es corto", () => {
    expect(nombreCortoConductor("Rodrigo Muñoz")).toBe("Rodrigo Muñoz");
    expect(nombreCortoConductor("Muñoz")).toBe("Muñoz");
  });

  it("con tres palabras toma el primer apellido", () => {
    expect(nombreCortoConductor("Cristián Vera Soto")).toBe("C. Vera");
  });

  it("no revienta con vacío ni con nulo", () => {
    expect(nombreCortoConductor(null)).toBeNull();
    expect(nombreCortoConductor("   ")).toBeNull();
  });

  it("NO se usa para el destinatario: la ficha y el escritorio dicen lo mismo", () => {
    // Guardia de intención: si alguien la aplica al destinatario, esta prueba
    // no lo detecta sola — pero el comentario de la función explica por qué no.
    expect(nombreCortoConductor("María Fuentes Aravena")).toBe("M. Fuentes");
  });
});
