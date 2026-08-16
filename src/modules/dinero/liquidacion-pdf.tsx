/**
 * Documento PDF de liquidación de conductor (C4).
 *
 * Usa @react-pdf/renderer para generar el buffer del PDF.
 * Se llama únicamente desde el job generar-liquidacion-conductor (server-side).
 * No contiene datos sensibles del seller ni del destinatario (solo el conductor,
 * las fechas y los montos de sus entregas).
 */

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

interface LineaLiquidacionPdf {
  /**
   * NULL en las lineas de retiro en bodega, que no cuelgan de ningun pedido.
   *
   * Antes decia `string` y ese tipo mentia: el `.slice(0, 8)` de mas abajo
   * lanzaba con un pedido nulo, la excepcion caia dentro del `try` del job
   * (generar-liquidacion-conductor.ts) que solo hace `logger.error`, y la
   * liquidacion quedaba en `borrador` PARA SIEMPRE — sin totales y sin
   * documento. Es el papel con el que el conductor discute su plata.
   */
  pedidoId: string | null;
  fechaEntrega: string;
  concepto: string;
  montoFinalClp: number;
}

interface Props {
  liquidacionId: string;
  tenantNombre: string;
  conductorNombre: string;
  fechaInicio: string;
  fechaFin: string;
  lineas: LineaLiquidacionPdf[];
  totalEntregas: number;
  montoTotalClp: number;
  emitidaEn: string;
}

const estilos = StyleSheet.create({
  pagina: {
    fontFamily: "Helvetica",
    fontSize: 10,
    padding: 40,
    color: "#1a1a1a",
  },
  encabezado: {
    marginBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingBottom: 16,
  },
  titulo: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  subtitulo: {
    fontSize: 11,
    color: "#6b7280",
  },
  seccion: {
    marginBottom: 16,
  },
  etiqueta: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  valor: {
    fontSize: 10,
  },
  filaMetadata: {
    flexDirection: "row",
    gap: 32,
    marginBottom: 16,
  },
  bloqueMetadata: {
    flex: 1,
  },
  cabeceraTabla: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    padding: "6 8",
    borderRadius: 4,
    marginBottom: 2,
  },
  filaTabla: {
    flexDirection: "row",
    padding: "5 8",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
  },
  colPedido: { width: "22%", fontSize: 9, fontFamily: "Helvetica-Bold", color: "#6b7280" },
  colFecha: { width: "18%", fontSize: 9, color: "#6b7280" },
  colConcepto: { flex: 1, fontSize: 9 },
  colMonto: { width: "18%", fontSize: 9, textAlign: "right" },
  colPedidoHeader: { width: "22%", fontSize: 8, fontFamily: "Helvetica-Bold", color: "#374151" },
  colFechaHeader: { width: "18%", fontSize: 8, fontFamily: "Helvetica-Bold", color: "#374151" },
  colConceptoHeader: { flex: 1, fontSize: 8, fontFamily: "Helvetica-Bold", color: "#374151" },
  colMontoHeader: { width: "18%", fontSize: 8, fontFamily: "Helvetica-Bold", color: "#374151", textAlign: "right" },
  filaTotal: {
    flexDirection: "row",
    padding: "8 8",
    backgroundColor: "#f9fafb",
    borderRadius: 4,
    marginTop: 4,
  },
  totalLabel: { flex: 1, fontSize: 11, fontFamily: "Helvetica-Bold" },
  totalMonto: { width: "18%", fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "right" },
  pie: {
    marginTop: 32,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: "#e5e7eb",
    fontSize: 8,
    color: "#9ca3af",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function formatearFecha(iso: string): string {
  if (!iso || iso.length < 10) return iso;
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function formatearCLP(monto: number): string {
  return `$${Math.round(monto).toLocaleString("es-CL")}`;
}

function DocumentoLiquidacion({
  liquidacionId,
  tenantNombre,
  conductorNombre,
  fechaInicio,
  fechaFin,
  lineas,
  totalEntregas,
  montoTotalClp,
  emitidaEn,
}: Props) {
  return (
    <Document title={`Liquidación ${liquidacionId}`} author={tenantNombre}>
      <Page size="A4" style={estilos.pagina}>
        {/* Encabezado */}
        <View style={estilos.encabezado}>
          <Text style={estilos.titulo}>Liquidación de entregas</Text>
          <Text style={estilos.subtitulo}>{tenantNombre}</Text>
        </View>

        {/* Metadata */}
        <View style={estilos.filaMetadata}>
          <View style={estilos.bloqueMetadata}>
            <Text style={estilos.etiqueta}>Conductor</Text>
            <Text style={estilos.valor}>{conductorNombre}</Text>
          </View>
          <View style={estilos.bloqueMetadata}>
            <Text style={estilos.etiqueta}>Período</Text>
            <Text style={estilos.valor}>
              {formatearFecha(fechaInicio)} – {formatearFecha(fechaFin)}
            </Text>
          </View>
          <View style={estilos.bloqueMetadata}>
            <Text style={estilos.etiqueta}>Entregas</Text>
            <Text style={estilos.valor}>{totalEntregas}</Text>
          </View>
          <View style={estilos.bloqueMetadata}>
            <Text style={estilos.etiqueta}>Total</Text>
            <Text style={{ ...estilos.valor, fontFamily: "Helvetica-Bold" }}>
              {formatearCLP(montoTotalClp)}
            </Text>
          </View>
        </View>

        {/* Tabla de líneas */}
        <View style={estilos.seccion}>
          <View style={estilos.cabeceraTabla}>
            <Text style={estilos.colPedidoHeader}>Pedido</Text>
            <Text style={estilos.colFechaHeader}>Fecha</Text>
            <Text style={estilos.colConceptoHeader}>Concepto</Text>
            <Text style={estilos.colMontoHeader}>Monto</Text>
          </View>

          {lineas.map((l, i) => (
            <View key={i} style={estilos.filaTabla}>
              <Text style={estilos.colPedido}>
                {l.pedidoId ? `#${l.pedidoId.slice(0, 8)}` : 'Retiro'}
              </Text>
              <Text style={estilos.colFecha}>{formatearFecha(l.fechaEntrega)}</Text>
              <Text style={estilos.colConcepto}>{l.concepto}</Text>
              <Text style={estilos.colMonto}>{formatearCLP(l.montoFinalClp)}</Text>
            </View>
          ))}

          <View style={estilos.filaTotal}>
            <Text style={estilos.totalLabel}>Total a pagar</Text>
            <Text style={estilos.totalMonto}>{formatearCLP(montoTotalClp)}</Text>
          </View>
        </View>

        {/* Pie */}
        <View style={estilos.pie}>
          <Text>Emitida el {formatearFecha(emitidaEn)} · ID {liquidacionId.slice(0, 8)}</Text>
          <Text>Documento generado por Rutax</Text>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Genera el buffer PDF de una liquidación de conductor.
 * Retorna null si los datos son insuficientes (mejor que un crash del job).
 */
export async function generarPdfLiquidacion(props: Props): Promise<Buffer> {
  const buffer = await renderToBuffer(<DocumentoLiquidacion {...props} />);
  return Buffer.from(buffer);
}
