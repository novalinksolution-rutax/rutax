import ExcelJS from "exceljs";

import { ahoraEnSantiago } from "@/lib/fecha-santiago";
import type { ReporteConsolidado } from "./consolidado";
import {
  MARCA_RUTAX_PNG_BASE64,
  MARCA_ALTO,
  MARCA_ANCHO,
  TINTA,
  TEAL,
  TEAL_OSCURO,
  PAPEL,
} from "./logo";

/**
 * El reporte consolidado en Excel, con la marca de Rutax.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ XLSX ADEMÁS DEL CSV, Y NO EN VEZ DE
 * -----------------------------------------------------------------------------
 * El CSV es el formato para MÁQUINAS: se importa a un contable, se pega en otra
 * planilla, no se rompe nunca. El XLSX es para PERSONAS: quien factura lo abre,
 * lo filtra, lo imprime y a veces se lo manda al seller. Son dos usos distintos
 * y el mismo archivo no sirve para los dos — un CSV con formato deja de ser CSV,
 * y un XLSX es un mal formato de intercambio. Se conservan los dos.
 *
 * -----------------------------------------------------------------------------
 * LO QUE HACE QUE ESTO SE PUEDA USAR DE VERDAD
 * -----------------------------------------------------------------------------
 * No es la marca: es el formato numérico, el panel congelado y el autofiltro.
 * Un archivo bonito con los montos como texto obliga a rehacerlo entero antes de
 * poder sumar una columna, que es lo primero que va a hacer quien lo abra.
 *
 * Los montos van como NÚMEROS con formato de moneda, nunca como cadenas. Ese es
 * el detalle que decide si la planilla sirve o si hay que volver a teclearla.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ NI UN UUID, IGUAL QUE EN EL CSV
 * -----------------------------------------------------------------------------
 * Mismo criterio y misma razón: quien paga tiene que poder cruzar cada fila con
 * algo que su contraparte reconozca. Las columnas se escriben a mano, no se
 * derivan del objeto, para que agregar un dato interno a la fila no lo publique.
 */

/** Los dos únicos colores que no vienen de la marca: la alerta. */
const ALERTA = "FFFDECEC";
const ALERTA_TEXTO = "FFB42318";

/** La tipografía de la marca. Excel sustituye sola si el equipo no la tiene. */
const FUENTE = "Archivo";

/** `$ 1.234` como NÚMERO. Si esto fuera texto, no se podría sumar la columna. */
const FORMATO_CLP = '"$"#,##0';

interface Columna {
  titulo: string;
  ancho: number;
  /** `true` si la columna lleva formato de moneda. */
  moneda?: boolean;
}

const COLUMNAS: Columna[] = [
  { titulo: "Tipo", ancho: 16 },
  { titulo: "Fecha", ancho: 12 },
  { titulo: "Código", ancho: 20 },
  { titulo: "Fuente", ancho: 20 },
  { titulo: "Régimen", ancho: 12 },
  { titulo: "Seller", ancho: 26 },
  { titulo: "RUT seller", ancho: 14 },
  { titulo: "Comuna", ancho: 18 },
  { titulo: "Conductor", ancho: 24 },
  { titulo: "RUT conductor", ancho: 15 },
  { titulo: "Cobro base", ancho: 13, moneda: true },
  { titulo: "Ajuste cobro", ancho: 13, moneda: true },
  { titulo: "Se cobra", ancho: 13, moneda: true },
  { titulo: "Pago base", ancho: 13, moneda: true },
  { titulo: "Ajuste pago", ancho: 13, moneda: true },
  { titulo: "Se paga", ancho: 13, moneda: true },
  { titulo: "Diferencia", ancho: 13, moneda: true },
  { titulo: "Estado", ancho: 30 },
  { titulo: "Nota", ancho: 40 },
];

/** Filas que ocupa la banda de marca, y su alto. */
const FILAS_BANDA = 3;
const ALTO_FILA_BANDA = 18;

/**
 * Fila del encabezado de la tabla. Va después de la banda y de la barra teal —
 * derivada, no escrita a mano: si la banda cambia de alto, esto la sigue.
 */
const FILA_ENCABEZADO = FILAS_BANDA + 2;

export interface DatosLibro {
  reporte: ReporteConsolidado;
  courierNombre: string;
  desde: string;
  hasta: string;
}

function bandaDeMarca(hoja: ExcelJS.Worksheet, libro: ExcelJS.Workbook, d: DatosLibro): void {
  // Tres filas, no cuatro: la banda es una firma, no una portada. Lo que la
  // persona vino a mirar son los datos.
  hoja.mergeCells(1, 1, 3, 3);
  hoja.mergeCells(1, 4, 1, COLUMNAS.length);
  hoja.mergeCells(2, 4, 2, COLUMNAS.length);
  hoja.mergeCells(3, 4, 3, COLUMNAS.length);

  for (let f = 1; f <= FILAS_BANDA; f++) {
    hoja.getRow(f).height = ALTO_FILA_BANDA;
    for (let c = 1; c <= COLUMNAS.length; c++) {
      hoja.getCell(f, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAPEL } };
    }
  }

  // 🔴 El logotipo COMPLETO —símbolo y palabra— en una sola imagen, y no la
  // imagen por un lado y el texto por otro: separados, Excel los alinea cada uno
  // por su cuenta y el conjunto se lee como dos cosas puestas cerca.
  //
  // Se centra a mano en la banda porque una imagen en Excel **flota**: no la
  // alinea la celda, así que su posición se calcula contra el alto real de las
  // filas. Si cambia `ALTO_FILA_BANDA`, esto se recalcula solo.
  const alto = 22;
  const ancho = (MARCA_ANCHO / MARCA_ALTO) * alto;
  const altoBanda = FILAS_BANDA * ALTO_FILA_BANDA;
  const id = libro.addImage({ base64: MARCA_RUTAX_PNG_BASE64, extension: "png" });
  hoja.addImage(id, {
    tl: { col: 0.22, row: (altoBanda - alto) / 2 / ALTO_FILA_BANDA },
    ext: { width: ancho, height: alto },
  });

  const titulo = hoja.getCell(1, 4);
  titulo.value = "Reportería de despacho";
  titulo.font = { name: FUENTE, size: 13, bold: true, color: { argb: TINTA } };
  titulo.alignment = { vertical: "middle", horizontal: "right" };

  const sub = hoja.getCell(2, 4);
  sub.value = `${d.courierNombre}  ·  ${d.desde} al ${d.hasta}`;
  sub.font = { name: FUENTE, size: 10, bold: true, color: { argb: TEAL_OSCURO } };
  sub.alignment = { vertical: "middle", horizontal: "right" };

  // ⚠️ El mismo aviso que llevan los respaldos imprimibles, y por el mismo
  // motivo: una planilla con emisor, RUT, detalle y total se lee como una
  // factura aunque nadie la llame así, y sin DTE eso es un problema con el SII.
  const aviso = hoja.getCell(3, 4);
  aviso.value =
    "Documento de respaldo interno. No es una factura ni una boleta, y no sirve para respaldar crédito fiscal.";
  aviso.font = { name: FUENTE, size: 8, italic: true, color: { argb: TINTA } };
  aviso.alignment = { vertical: "middle", horizontal: "right" };

  // La barra teal cierra la banda: separa la marca de los datos sin gastar una
  // fila en blanco.
  hoja.getRow(FILAS_BANDA + 1).height = 4;
  for (let c = 1; c <= COLUMNAS.length; c++) {
    hoja.getCell(FILAS_BANDA + 1, c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: TEAL },
    };
  }
}

function encabezadoDeTabla(hoja: ExcelJS.Worksheet): void {
  const fila = hoja.getRow(FILA_ENCABEZADO);
  COLUMNAS.forEach((col, i) => {
    const celda = fila.getCell(i + 1);
    celda.value = col.titulo;
    celda.font = { name: FUENTE, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINTA } };
    celda.alignment = { vertical: "middle", horizontal: col.moneda ? "right" : "left" };
  });
  fila.height = 22;
  hoja.columns = COLUMNAS.map((c) => ({ width: c.ancho }));

  // Congelar el encabezado y las tres primeras columnas: con 300 filas y 19
  // columnas, sin esto no se sabe qué se está mirando al desplazarse.
  hoja.views = [{ state: "frozen", xSplit: 3, ySplit: FILA_ENCABEZADO }];
}

export async function armarLibro(d: DatosLibro): Promise<ExcelJS.Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Rutax";
  // Cuándo se generó el archivo, que es lo que significa este campo — no el fin
  // del rango. Y por el helper: pegarle «-04:00» a mano miente medio año, que es
  // cuando Santiago está en -03:00.
  libro.created = ahoraEnSantiago().instante;

  // --- Hoja 1: el detalle ---------------------------------------------------
  const hoja = libro.addWorksheet("Detalle", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  bandaDeMarca(hoja, libro, d);
  encabezadoDeTabla(hoja);

  const filas: (string | number | null)[][] = [];

  for (const f of d.reporte.filas) {
    const estado =
      f.discrepancia === "sin_pago"
        ? "FALTA EL PAGO AL CONDUCTOR"
        : f.discrepancia === "sin_cobro"
          ? "FALTA EL COBRO AL SELLER"
          : "Completa";
    filas.push([
      "Entrega",
      f.fechaHecho,
      f.codigo,
      f.fuenteEtiqueta,
      f.tipo,
      f.sellerNombre,
      f.sellerRut,
      f.comuna,
      f.conductorNombre ?? "",
      f.conductorRut ?? "",
      f.cobroBase,
      f.cobroAjuste,
      f.cobroFinal,
      f.pagoBase,
      f.pagoAjuste,
      f.pagoFinal,
      f.margen,
      estado,
      f.ajustadoAMano ? `Ajustado a mano. ${f.motivoAjuste ?? ""}`.trim() : (f.motivoAjuste ?? ""),
    ]);
  }

  for (const v of d.reporte.visitas) {
    filas.push([
      "Visita a bodega",
      v.fechaHecho,
      "",
      "",
      "",
      "",
      "",
      "",
      v.conductorNombre,
      "",
      null,
      null,
      null,
      null,
      null,
      v.montoFinal,
      null,
      "Completa",
      v.concepto,
    ]);
  }

  filas.forEach((valores, i) => {
    const fila = hoja.getRow(FILA_ENCABEZADO + 1 + i);
    valores.forEach((valor, c) => {
      const celda = fila.getCell(c + 1);
      celda.value = valor;
      celda.font = { name: FUENTE, size: 10 };
      if (COLUMNAS[c].moneda) celda.numFmt = FORMATO_CLP;
    });
    // La fila incompleta se pinta entera: en una planilla de 300 filas, un
    // texto en la columna 18 no lo ve nadie. Es el hallazgo más caro del
    // reporte y tiene que saltar a la vista.
    const estado = valores[17];
    if (typeof estado === "string" && estado.startsWith("FALTA")) {
      for (let c = 1; c <= COLUMNAS.length; c++) {
        fila.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALERTA } };
      }
      fila.getCell(18).font = { name: FUENTE, size: 10, bold: true, color: { argb: ALERTA_TEXTO } };
    }
  });

  if (filas.length > 0) {
    hoja.autoFilter = {
      from: { row: FILA_ENCABEZADO, column: 1 },
      to: { row: FILA_ENCABEZADO + filas.length, column: COLUMNAS.length },
    };
  }

  // --- Hoja 2: los totales, que es con lo que se transfiere ------------------
  const resumen = libro.addWorksheet("Resumen");
  resumen.columns = [{ width: 34 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 16 }];

  let f = 1;
  const seccion = (titulo: string, cabeceras: string[]) => {
    f += 1;
    const fila = resumen.getRow(f);
    fila.getCell(1).value = titulo;
    fila.getCell(1).font = { name: FUENTE, size: 12, bold: true, color: { argb: TINTA } };
    f += 1;
    const cab = resumen.getRow(f);
    cabeceras.forEach((h, i) => {
      const celda = cab.getCell(i + 1);
      celda.value = h;
      celda.font = { name: FUENTE, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINTA } };
    });
  };
  const linea = (valores: (string | number)[], monedaDesde: number) => {
    f += 1;
    const fila = resumen.getRow(f);
    valores.forEach((v, i) => {
      const celda = fila.getCell(i + 1);
      celda.value = v;
      celda.font = { name: FUENTE, size: 10 };
      if (i >= monedaDesde) celda.numFmt = FORMATO_CLP;
    });
  };

  seccion("Lo que se le factura a cada seller", ["Seller", "Entregas", "Total"]);
  for (const s of d.reporte.porSeller) linea([s.sellerNombre, s.entregas, s.totalCobro], 2);

  f += 1;
  seccion("Lo que se le transfiere a cada conductor", [
    "Conductor",
    "Entregas",
    "Visitas",
    "Por entregas",
    "Por visitas",
  ]);
  for (const c of d.reporte.porConductor) {
    linea([c.conductorNombre, c.entregas, c.visitas, c.totalEntregas, c.totalVisitas], 3);
  }

  f += 1;
  seccion("Por fuente de los pedidos", ["Fuente", "Entregas", "Se cobra", "Se paga"]);
  for (const x of d.reporte.porFuente) linea([x.etiqueta, x.entregas, x.totalCobro, x.totalPago], 2);

  f += 2;
  const total = resumen.getRow(f);
  total.getCell(1).value = "Filas incompletas";
  total.getCell(1).font = { name: FUENTE, size: 11, bold: true };
  total.getCell(2).value = d.reporte.conDiscrepancia;
  total.getCell(2).font = {
    name: FUENTE,
    size: 11,
    bold: true,
    color: { argb: d.reporte.conDiscrepancia > 0 ? ALERTA_TEXTO : TINTA },
  };
  f += 1;
  const nota = resumen.getRow(f);
  nota.getCell(1).value =
    d.reporte.conDiscrepancia > 0
      ? "Les falta el cobro o el pago. Revísalas antes de facturar."
      : "Todas las entregas tienen sus dos líneas.";
  nota.getCell(1).font = { name: FUENTE, size: 9, italic: true };

  return libro.xlsx.writeBuffer();
}
