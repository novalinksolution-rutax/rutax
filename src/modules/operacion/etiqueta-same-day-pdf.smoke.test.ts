import { describe, it, expect } from "vitest";
import { generarEtiquetaSameDayPdf } from "./etiqueta-same-day-pdf";

describe("smoke: generarEtiquetaSameDayPdf produce un PDF real", () => {
  it("termica", async () => {
    const buf = await generarEtiquetaSameDayPdf({
      codigoInterno: "RX-7K2M-9QP4",
      destinatarioNombre: "Juan Pérez",
      destinatarioDireccion: "Av. Providencia 123",
      destinatarioComuna: "Providencia",
      destinatarioTelefono: "+56 9 1234 5678",
      sellerNombre: "Tienda Demo",
      fechaCompromiso: "2026-07-05",
      instruccionesEntrega: "Dejar en conserjería",
      formato: "termica",
    });
    // %PDF header
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("carta", async () => {
    const buf = await generarEtiquetaSameDayPdf({
      codigoInterno: "RX-7K2M-9QP4",
      destinatarioNombre: "Juan Pérez",
      destinatarioDireccion: "Av. Providencia 123",
      destinatarioComuna: "Providencia",
      destinatarioTelefono: null,
      sellerNombre: "Tienda Demo",
      fechaCompromiso: null,
      instruccionesEntrega: null,
      formato: "carta",
    });
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });
});
