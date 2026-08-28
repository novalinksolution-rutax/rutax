import { describe, expect, it } from "vitest";

import { armarCsv, COLUMNAS_CSV } from "./csv";
import type { FilaReporte, ReporteConsolidado } from "./consolidado";

/** Cualquier UUID, en cualquier parte del texto. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const fila: FilaReporte = {
  codigo: "RX-8HCZ-0PPB",
  fuente: "rutax_manual",
  fuenteEtiqueta: "Same-day",
  tipo: "same_day",
  fechaHecho: "2026-08-27",
  // 🔴 Los ids van poblados a propósito: la prueba tiene que demostrar que NO
  // salen, no que no estaban.
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
  porSeller: [],
  porConductor: [],
  porFuente: [],
  totalCobro: 3000,
  totalPago: 2300,
  conDiscrepancia: 0,
  ...extra,
});

describe("armarCsv", () => {
  it("🔴 NI UN UUID sale al archivo, aunque la fila los lleve", () => {
    // Es la restricción explícita del usuario: «no quiero un metadato en el
    // reporte». La fila carga `sellerId` y `conductorId` porque con ellos se
    // abren los documentos imprimibles; el archivo no puede verlos.
    const csv = armarCsv(reporte());
    expect(csv).not.toMatch(UUID);
    expect(csv).toContain("RX-8HCZ-0PPB");
  });

  it("🔴 las columnas son una lista explícita, sin ninguna de id", () => {
    // Si algún día alguien deriva las columnas de `Object.keys(fila)`, los ids
    // se publican solos. Esta prueba es lo que lo impide.
    for (const c of COLUMNAS_CSV) {
      expect(c).not.toMatch(/(^|_)id$/);
    }
    expect(COLUMNAS_CSV).not.toContain("pedido_id");
  });

  it("lleva el RUT de las dos partes: es con lo que se emite y se transfiere", () => {
    const csv = armarCsv(reporte());
    expect(csv).toContain("78060175-2");
    expect(csv).toContain("27137700-2");
  });

  it("🔴 una fila sin pago se DENUNCIA en mayúsculas, no se omite", () => {
    const csv = armarCsv(
      reporte({ filas: [{ ...fila, pagoFinal: null, margen: null, discrepancia: "sin_pago" }] }),
    );
    expect(csv).toContain("FALTA EL PAGO AL CONDUCTOR");
    // Y la fila sigue estando: esconderla sería perder el hallazgo.
    expect(csv).toContain("RX-8HCZ-0PPB");
  });

  it("las visitas van en el archivo, marcadas en su propia columna", () => {
    // Dejarlas fuera perdería plata que sí se transfiere; mezclarlas sin marca
    // inflaría el conteo de entregas.
    const csv = armarCsv(
      reporte({
        visitas: [
          {
            conductorId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
            fechaHecho: "2026-08-27",
            conductorNombre: "Jorge Conductor",
            concepto: "Visita a bodega",
            montoFinal: 1500,
          },
        ],
      }),
    );
    expect(csv).toContain('"Visita a bodega"');
    expect(csv).toContain('"1500"');
    // Y su id tampoco se filtra.
    expect(csv).not.toMatch(UUID);
  });

  it("separa con `;` y cada fila tiene tantos campos como columnas", () => {
    // Excel en Chile parte por `;`. Y una fila con más o menos campos que el
    // encabezado desalinea la planilla entera sin dar error — ya mordió antes.
    const csv = armarCsv(
      reporte({
        visitas: [
          {
            conductorId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
            fechaHecho: "2026-08-27",
            conductorNombre: "Jorge Conductor",
            concepto: "Visita",
            montoFinal: 1500,
          },
        ],
      }),
    );
    for (const linea of csv.split("\r\n")) {
      expect(linea.split(";")).toHaveLength(COLUMNAS_CSV.length);
    }
  });

  it("escapa las comillas en vez de romper el archivo", () => {
    const csv = armarCsv(
      reporte({ filas: [{ ...fila, motivoAjuste: 'El seller dijo "no estaba"' }] }),
    );
    expect(csv).toContain('""no estaba""');
  });
});
