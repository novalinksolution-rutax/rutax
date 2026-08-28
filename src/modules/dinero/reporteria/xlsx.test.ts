import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { armarLibro } from "./xlsx";
import type { FilaReporte, ReporteConsolidado } from "./consolidado";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const fila: FilaReporte = {
  codigo: "RX-8HCZ-0PPB",
  fuente: "rutax_manual",
  fuenteEtiqueta: "Same-day",
  tipo: "same_day",
  fechaHecho: "2026-08-27",
  // Poblados a propósito: la prueba debe demostrar que NO salen, no que faltaban.
  sellerId: "3f6b2c1a-9d4e-4f8b-9a2c-1e5d7b3a6c9f",
  sellerNombre: "NovalinkShop",
  sellerRut: "78060175-2",
  destinatario: "Camila Rojas",
  comuna: "Ñuñoa",
  conductorId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  conductorNombre: "Jorge Conductor",
  conductorRut: "27137700-2",
  cobroBase: 3000,
  cobroAjuste: 0,
  cobroFinal: 3000,
  pagoBase: 2300,
  pagoAjuste: 0,
  pagoFinal: 2300,
  margen: 700,
  ajustadoAMano: false,
  motivoAjuste: null,
  discrepancia: null,
};

const reporte = (extra: Partial<ReporteConsolidado> = {}): ReporteConsolidado => ({
  filas: [fila],
  visitas: [],
  porSeller: [{ sellerId: "s1", sellerNombre: "NovalinkShop", entregas: 1, totalCobro: 3000 }],
  porConductor: [
    {
      conductorId: "d1",
      conductorNombre: "Jorge Conductor",
      entregas: 1,
      visitas: 0,
      totalEntregas: 2300,
      totalVisitas: 0,
      totalAPagar: 2300,
    },
  ],
  porFuente: [
    { fuente: "rutax_manual", etiqueta: "Same-day", entregas: 1, totalCobro: 3000, totalPago: 2300 },
  ],
  totalCobro: 3000,
  totalPago: 2300,
  conDiscrepancia: 0,
  ...extra,
});

async function abrir(r: ReporteConsolidado) {
  const buffer = await armarLibro({
    reporte: r,
    courierNombre: "Novalink SpA",
    desde: "2026-08-01",
    hasta: "2026-08-31",
  });
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as ArrayBuffer);
  return libro;
}

/** Todo el texto del libro, para barrerlo de una. */
function textoDe(libro: ExcelJS.Workbook): string {
  const trozos: string[] = [];
  libro.eachSheet((hoja) => {
    hoja.eachRow((fila) => {
      fila.eachCell({ includeEmpty: false }, (c) => trozos.push(String(c.value ?? "")));
    });
  });
  return trozos.join("\n");
}

describe("armarLibro", () => {
  it("produce un XLSX que se puede volver a abrir", async () => {
    const libro = await abrir(reporte());
    expect(libro.worksheets.map((h) => h.name)).toEqual(["Detalle", "Resumen"]);
  });

  it("🔴 los montos son NÚMEROS con formato de moneda, no texto", async () => {
    // Es el detalle que decide si la planilla sirve o si hay que teclearla de
    // nuevo: lo primero que hace quien la abre es sumar una columna.
    const libro = await abrir(reporte());
    const hoja = libro.getWorksheet("Detalle")!;
    const seCobra = hoja.getCell(6, 13); // fila 5 = encabezado, 13 = «Se cobra»
    expect(typeof seCobra.value).toBe("number");
    expect(seCobra.value).toBe(3000);
    expect(seCobra.numFmt).toBe('"$"#,##0');
  });

  it("🔴 NI UN UUID en ninguna celda de ninguna hoja", async () => {
    const libro = await abrir(reporte());
    expect(textoDe(libro)).not.toMatch(UUID);
    expect(textoDe(libro)).toContain("RX-8HCZ-0PPB");
  });

  it("🔴 el logotipo va en UNA imagen, no en imagen más texto", async () => {
    // Separados, Excel alinea cada uno por su cuenta y el conjunto se lee como
    // dos cosas puestas cerca. La palabra viene rasterizada dentro de la imagen
    // porque dibujarla en el servidor exigiría tener Chivo instalada ahí:
    // funciona en desarrollo y falla en producción sin avisar.
    const libro = await abrir(reporte());
    const hoja = libro.getWorksheet("Detalle")!;
    expect(hoja.getImages()).toHaveLength(1);
    // Y no queda una celda suelta con la palabra al lado.
    const celdasDeLaBanda: string[] = [];
    for (let f = 1; f <= 3; f++) {
      for (let c = 1; c <= 4; c++) celdasDeLaBanda.push(String(hoja.getCell(f, c).value ?? ""));
    }
    expect(celdasDeLaBanda).not.toContain("Rutax");
  });

  it("🔴 avisa que no es un documento tributario", async () => {
    // Una planilla con emisor, RUT, detalle y total se lee como una factura
    // aunque nadie la llame así, y sin DTE eso es un problema con el SII.
    const libro = await abrir(reporte());
    expect(textoDe(libro)).toContain("No es una factura ni una boleta");
  });

  it("congela el encabezado y pone autofiltro", async () => {
    // Con 300 filas y 19 columnas, sin esto no se sabe qué se está mirando.
    const libro = await abrir(reporte());
    const hoja = libro.getWorksheet("Detalle")!;
    expect(hoja.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
    expect(hoja.autoFilter).toBeTruthy();
  });

  it("🔴 una fila sin pago se denuncia y se pinta entera", async () => {
    // En una planilla de 300 filas, un texto en la columna 18 no lo ve nadie.
    const libro = await abrir(
      reporte({
        filas: [{ ...fila, pagoFinal: null, margen: null, discrepancia: "sin_pago" }],
        conDiscrepancia: 1,
      }),
    );
    const hoja = libro.getWorksheet("Detalle")!;
    expect(String(hoja.getCell(6, 18).value)).toBe("FALTA EL PAGO AL CONDUCTOR");
    const relleno = hoja.getCell(6, 1).fill as ExcelJS.FillPattern;
    expect(relleno?.fgColor?.argb).toBe("FFFDECEC");
  });

  it("las visitas entran con su propio tipo de línea", async () => {
    const libro = await abrir(
      reporte({
        visitas: [
          {
            conductorId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
            fechaHecho: "2026-08-27",
            conductorNombre: "Jorge Conductor",
            concepto: "Retiro en bodega · 11 bultos",
            montoFinal: 1500,
          },
        ],
      }),
    );
    const hoja = libro.getWorksheet("Detalle")!;
    expect(String(hoja.getCell(7, 1).value)).toBe("Visita a bodega");
    expect(hoja.getCell(7, 16).value).toBe(1500);
    expect(textoDe(libro)).not.toMatch(UUID);
  });

  it("el Resumen trae los tres cortes", async () => {
    const libro = await abrir(reporte());
    const t = textoDe(libro);
    expect(t).toContain("Lo que se le factura a cada seller");
    expect(t).toContain("Lo que se le transfiere a cada conductor");
    expect(t).toContain("Por fuente de los pedidos");
  });

  it("un rango sin entregas produce un libro válido, no una excepción", async () => {
    const libro = await abrir(
      reporte({ filas: [], porSeller: [], porConductor: [], porFuente: [], totalCobro: 0, totalPago: 0 }),
    );
    expect(libro.getWorksheet("Detalle")).toBeTruthy();
  });
});
