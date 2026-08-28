import type { ReporteConsolidado } from "./consolidado";

/**
 * El CSV del reporte consolidado.
 * =============================================================================
 *
 * Vive en el módulo y no en la ruta de descarga **para poder probarlo**. La
 * restricción que sostiene este archivo —«ni un UUID en la salida»— no se puede
 * verificar leyendo una `route.ts` que exige sesión: acá se le pasa un reporte y
 * se barre el texto que produce.
 *
 * -----------------------------------------------------------------------------
 * SEPARADOR `;` Y BOM, PORQUE EL DESTINO ES EXCEL EN ESPAÑOL
 * -----------------------------------------------------------------------------
 * Excel en configuración regional chilena parte por `;`, no por coma, y sin BOM
 * abre el archivo en la codificación del sistema: «Ñuñoa» sale roto. Las dos
 * cosas son deliberadas y se heredan de la exportación del período.
 *
 * -----------------------------------------------------------------------------
 * ENTREGAS Y VISITAS EN EL MISMO ARCHIVO, SEPARADAS POR UNA COLUMNA
 * -----------------------------------------------------------------------------
 * Las visitas a bodega se le pagan al conductor y NO se le cobran al seller, así
 * que mezclarlas entre las entregas inflaría el conteo de entregas. Pero
 * dejarlas fuera sería peor: es plata que se transfiere y desaparecería del
 * respaldo. Van con `tipo_linea`, que se filtra en un segundo y no esconde nada.
 */

/**
 * Las columnas, como lista EXPLÍCITA.
 *
 * 🔴 No se derivan de las claves del objeto a propósito. La fila lleva
 * `sellerId` y `conductorId` para poder enlazar los documentos imprimibles, y
 * un `Object.keys()` los volcaría al archivo sin que nadie lo notara — que es
 * exactamente lo que el usuario pidió que no pasara. Escribir la lista a mano
 * significa que agregar un dato interno a la fila **no** lo publica.
 */
export const COLUMNAS_CSV = [
  "tipo_linea",
  "fecha",
  "codigo",
  "fuente",
  "regimen",
  "seller",
  "rut_seller",
  "comuna",
  "conductor",
  "rut_conductor",
  "cobro_base",
  "cobro_ajuste",
  "cobro_total",
  "pago_base",
  "pago_ajuste",
  "pago_total",
  "diferencia",
  "estado",
  "nota",
] as const;

/** Escapa un valor para CSV: comillas dobladas y campo entre comillas. */
function campo(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '""';
  return `"${String(valor).replace(/"/g, '""')}"`;
}

/**
 * El estado de la fila, en mayúsculas cuando hay que actuar.
 *
 * Grita a propósito: en una planilla de 300 filas, «Falta el pago» en minúscula
 * se pierde entre los montos.
 */
function estadoDe(discrepancia: string | null): string {
  if (discrepancia === "sin_pago") return "FALTA EL PAGO AL CONDUCTOR";
  if (discrepancia === "sin_cobro") return "FALTA EL COBRO AL SELLER";
  return "Completa";
}

/** El cuerpo del CSV, sin BOM. Las entregas primero, después las visitas. */
export function armarCsv(reporte: ReporteConsolidado): string {
  const lineas: string[] = [COLUMNAS_CSV.join(";")];

  for (const f of reporte.filas) {
    lineas.push(
      [
        campo("Entrega"),
        campo(f.fechaHecho),
        campo(f.codigo),
        campo(f.fuenteEtiqueta),
        campo(f.tipo),
        campo(f.sellerNombre),
        campo(f.sellerRut),
        campo(f.comuna),
        campo(f.conductorNombre ?? ""),
        campo(f.conductorRut ?? ""),
        campo(f.cobroBase ?? ""),
        campo(f.cobroAjuste ?? ""),
        campo(f.cobroFinal ?? ""),
        campo(f.pagoBase ?? ""),
        campo(f.pagoAjuste ?? ""),
        campo(f.pagoFinal ?? ""),
        campo(f.margen ?? ""),
        campo(estadoDe(f.discrepancia)),
        campo(
          f.ajustadoAMano
            ? `Ajustado a mano. ${f.motivoAjuste ?? ""}`.trim()
            : (f.motivoAjuste ?? ""),
        ),
      ].join(";"),
    );
  }

  for (const v of reporte.visitas) {
    lineas.push(
      [
        campo("Visita a bodega"),
        campo(v.fechaHecho),
        campo(""),
        campo(""),
        campo(""),
        campo(""),
        campo(""),
        campo(""),
        campo(v.conductorNombre),
        campo(""),
        campo(""),
        campo(""),
        campo(""),
        campo(""),
        campo(""),
        campo(v.montoFinal),
        campo(""),
        campo("Completa"),
        campo(v.concepto),
      ].join(";"),
    );
  }

  return lineas.join("\r\n");
}
