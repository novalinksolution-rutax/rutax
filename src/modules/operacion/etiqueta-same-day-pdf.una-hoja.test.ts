/**
 * La etiqueta térmica es UNA hoja de 10×15 cm, siempre.
 *
 * Existe porque no lo era (encontrado el 29-09-2026): con teléfono y fecha, el
 * pie —y en casos largos el remitente y la fecha— saltaba a una segunda hoja.
 * En térmica eso imprime dos etiquetas por bulto, la segunda suelta y sin QR.
 * Nada lo detectaba: la prueba de humo solo mira que salga un PDF.
 *
 * Cuenta las páginas del PDF crudo (`/Type /Page`, sin la `s` de `/Pages`) y
 * comprueba el tamaño del MediaBox: `wrap={false}` también dejaría una hoja,
 * pero con el alto ajustado al contenido, que es otra forma de romperla.
 */

import { describe, it, expect } from "vitest";
import { generarEtiquetaSameDayPdf, type EtiquetaSameDayPdfProps } from "./etiqueta-same-day-pdf";

function paginas(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
}

function altosDePagina(pdf: Buffer): number[] {
  return [...pdf.toString("latin1").matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) =>
    Number(m[2]),
  );
}

const PEOR_CASO: EtiquetaSameDayPdfProps = {
  codigoInterno: "RX-9DXF-KWV0",
  destinatarioNombre: "María José Fuenzalida Undurraga",
  destinatarioDireccion: "Pasaje Los Cardenales del Valle Norte 12345, Depto 1204 Torre B",
  destinatarioComuna: "Pedro Aguirre Cerda",
  destinatarioTelefono: "+56922222222",
  sellerNombre: "Comercializadora Los Aromos Limitada",
  referenciaTienda: "Shopify #104233",
  fechaCompromiso: "2026-09-29",
  formato: "termica",
};

describe("etiqueta térmica: una sola hoja de 10×15", () => {
  it("el peor caso realista cabe en una hoja", async () => {
    const pdf = await generarEtiquetaSameDayPdf(PEOR_CASO);
    expect(paginas(pdf)).toBe(1);
  });

  it("la hoja mide 425,2 pt de alto (15 cm), no el alto del contenido", async () => {
    const pdf = await generarEtiquetaSameDayPdf(PEOR_CASO);
    for (const alto of altosDePagina(pdf)) expect(alto).toBeCloseTo(425.2, 0);
  });

  it("un pedido propio, sin referencia de tienda, también", async () => {
    const pdf = await generarEtiquetaSameDayPdf({ ...PEOR_CASO, referenciaTienda: null });
    expect(paginas(pdf)).toBe(1);
  });
});
