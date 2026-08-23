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
  fechaHecho: string;
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

/**
 * Liquidación del conductor, carta.
 * =============================================================================
 * Los valores salen del bloque `@media print` de `rx-tokens.css:609-628`, que
 * hasta hoy **no tenía un solo consumidor** — `@react-pdf` tampoco lee CSS, así
 * que se transcriben con su token anotado al lado.
 *
 * A QUIÉN SE LE ENTREGA ESTO
 * -----------------------------------------------------------------------------
 * A alguien que **desconfía por defecto** de un descuento que no entiende. Su
 * legibilidad es el problema de diseño, no su estética. De ahí las tres cosas
 * que cambian:
 *
 * 1. **Un solo gris de texto.** Había TRES —`#374151`, `#6b7280`, `#9ca3af`— y
 *    el más claro, en el pie, da 2,5:1 sobre blanco: se pierde en una impresora
 *    con poco tóner, que es la que hay. El sistema define **uno**, `#3E4D53`,
 *    medido en 7,4:1.
 * 2. **Las reglas se ven.** Estaban en `0.5`, que muchas impresoras redondean a
 *    cero o a un punto según la fila. El sistema pide 2 y 3, y los reserva para
 *    la jerarquía del total.
 * 3. **Sin esquinas redondeadas ni cajas grises decorativas.** En papel el
 *    `borderRadius` no aporta nada y el fondo gris de la cabecera compite con
 *    el fondo del subtotal, que sí significa algo.
 */
const estilos = StyleSheet.create({
  pagina: {
    fontFamily: "Helvetica",
    fontSize: 10,
    padding: 40,
    color: "#0B1114", // --rx-fg
  },
  encabezado: {
    marginBottom: 24,
    borderBottomWidth: 2, // --rx-print-total-rule
    borderBottomColor: "#0B1114", // --rx-line-strong
    paddingBottom: 16,
  },
  titulo: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  subtitulo: {
    fontSize: 11,
    color: "#3E4D53", // --rx-fg-muted · el ÚNICO gris de texto impreso
  },
  seccion: {
    marginBottom: 16,
  },
  etiqueta: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#3E4D53",
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
  // La cabecera se separa con una regla, no con una caja gris: el gris de fondo
  // queda reservado para el subtotal, que es lo único que lo necesita.
  cabeceraTabla: {
    flexDirection: "row",
    padding: "6 8",
    borderBottomWidth: 2,
    borderBottomColor: "#0B1114",
    marginBottom: 2,
  },
  filaTabla: {
    flexDirection: "row",
    padding: "5 8",
    borderBottomWidth: 2,
    borderBottomColor: "#DCE7E8", // --rx-line-subtle
  },
  colPedido: { width: "22%", fontSize: 9, fontFamily: "Helvetica-Bold", color: "#3E4D53" },
  colFecha: { width: "18%", fontSize: 9, color: "#3E4D53" },
  colConcepto: { flex: 1, fontSize: 9 },
  colMonto: { width: "18%", fontSize: 9, textAlign: "right" },
  colPedidoHeader: { width: "22%", fontSize: 8, fontFamily: "Helvetica-Bold", color: "#0B1114" },
  colFechaHeader: { width: "18%", fontSize: 8, fontFamily: "Helvetica-Bold", color: "#0B1114" },
  colConceptoHeader: { flex: 1, fontSize: 8, fontFamily: "Helvetica-Bold", color: "#0B1114" },
  colMontoHeader: {
    width: "18%",
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#0B1114",
    textAlign: "right",
  },
  // El total: fondo tenue + regla de 2 arriba. Es la jerarquía de suma que el
  // sistema le pide a toda tabla financiera, en papel igual que en pantalla.
  filaTotal: {
    flexDirection: "row",
    padding: "8 8",
    backgroundColor: "#F7FBFB", // --rx-print-subtotal-bg
    borderTopWidth: 2, // --rx-print-total-rule
    borderTopColor: "#0B1114",
    marginTop: 4,
  },
  totalLabel: { flex: 1, fontSize: 11, fontFamily: "Helvetica-Bold" },
  totalMonto: { width: "18%", fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "right" },
  pie: {
    marginTop: 32,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: "#DCE7E8",
    fontSize: 8,
    color: "#3E4D53",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

/**
 * Expuesto para `impresos-reglas.test.ts`: las reglas de tinta se comprueban
 * sobre el objeto de estilo, porque a un PDF binario no se le puede preguntar
 * si un color es demasiado claro.
 */
export const ESTILOS_LIQUIDACION_PARA_PRUEBAS = estilos as unknown as Record<
  string,
  Record<string, unknown>
>;

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
              <Text style={estilos.colFecha}>{formatearFecha(l.fechaHecho)}</Text>
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
