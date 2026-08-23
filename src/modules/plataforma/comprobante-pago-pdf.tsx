/**
 * Documento PDF del comprobante de pago de la suscripción del courier a Rutax
 * (backstage `plataforma`, pantalla "Mi plan").
 *
 * Usa @react-pdf/renderer, mismo patrón que `dinero/liquidacion-pdf.tsx` y
 * `operacion/etiqueta-same-day-pdf.tsx`. Se genera al vuelo desde la ruta
 * `GET api/courier/plataforma/comprobantes/[periodoId]` — no se persiste en
 * Storage (a diferencia de la liquidación/factura DTE), porque no es un
 * documento tributario ni necesita reenvío posterior.
 *
 * ADVERTENCIA DE COPY (no ambigua, ver CLAUDE.md): este documento declara
 * explícitamente que NO es un documento tributario — la factura la emite
 * Rutax por separado (proceso de facturación B2B a couriers, fuera de este
 * módulo). Nunca omitir esa leyenda.
 */

import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ComprobantePago } from "./superficie-courier";
import { traducirMetodoPago } from "@/lib/ui/traduccion-estados";

const estilos = StyleSheet.create({
  pagina: {
    fontFamily: "Helvetica",
    fontSize: 10,
    padding: 40,
    color: "#0B1114", // --rx-fg
  },
  encabezado: {
    marginBottom: 24,
    borderBottomWidth: 1,
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
    color: "#3E4D53", // --rx-fg-muted · el único gris de texto impreso
  },
  filaMetadata: {
    flexDirection: "row",
    gap: 32,
    marginBottom: 20,
    marginTop: 8,
  },
  bloqueMetadata: {
    flex: 1,
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
  bloqueMonto: {
    marginTop: 8,
    padding: "12 14",
    backgroundColor: "#F7FBFB", // --rx-print-subtotal-bg
    borderRadius: 4,
  },
  montoLabel: { fontSize: 9, color: "#3E4D53", marginBottom: 2 },
  montoValor: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  avisoLegal: {
    marginTop: 28,
    padding: "10 12",
    // El aviso va con el ámbar del sistema (`--rx-attention-*` en su versión
    // clara), no con un beige propio. Y sin `borderRadius`: en papel no aporta.
    backgroundColor: "#FFF6DE",
    borderLeftWidth: 3,
    borderLeftColor: "#8A5B00", // --rx-attention-fg
    fontSize: 9,
    color: "#8A5B00",
    lineHeight: 1.4,
  },
  pie: {
    marginTop: 24,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: "#DCE7E8", // --rx-line-subtle
    fontSize: 8,
    color: "#3E4D53", // era #9ca3af: 2,5:1 sobre blanco, se pierde con poco tóner
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function formatearFechaCorta(iso: string): string {
  if (!iso || iso.length < 10) return iso;
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function formatearCLP(monto: number): string {
  return `$${Math.round(monto).toLocaleString("es-CL")}`;
}

function DocumentoComprobante({ comprobante }: { comprobante: ComprobantePago }) {
  return (
    <Document title={`Comprobante de pago ${comprobante.periodoId}`} author="Rutax">
      <Page size="A4" style={estilos.pagina}>
        <View style={estilos.encabezado}>
          <Text style={estilos.titulo}>Comprobante de pago</Text>
          <Text style={estilos.subtitulo}>Suscripción Rutax — {comprobante.tenantNombre}</Text>
        </View>

        <View style={estilos.filaMetadata}>
          <View style={estilos.bloqueMetadata}>
            <Text style={estilos.etiqueta}>Plan</Text>
            <Text style={estilos.valor}>{comprobante.planNombre}</Text>
          </View>
          <View style={estilos.bloqueMetadata}>
            <Text style={estilos.etiqueta}>Período</Text>
            <Text style={estilos.valor}>
              {formatearFechaCorta(comprobante.periodoInicio)} – {formatearFechaCorta(comprobante.periodoFin)}
            </Text>
          </View>
          <View style={estilos.bloqueMetadata}>
            <Text style={estilos.etiqueta}>Fecha de pago</Text>
            <Text style={estilos.valor}>{formatearFechaCorta(comprobante.pagadoEn)}</Text>
          </View>
          <View style={estilos.bloqueMetadata}>
            <Text style={estilos.etiqueta}>Método</Text>
            <Text style={estilos.valor}>{traducirMetodoPago(comprobante.metodo)}</Text>
          </View>
        </View>

        <View style={estilos.bloqueMonto}>
          <Text style={estilos.montoLabel}>Monto pagado</Text>
          <Text style={estilos.montoValor}>{formatearCLP(comprobante.montoClp)}</Text>
        </View>

        {/* COPY: leyenda no ambigua — este documento NUNCA reemplaza la factura. */}
        <Text style={estilos.avisoLegal}>
          Este comprobante acredita un pago recibido por Rutax. No es un documento tributario (no es factura ni boleta).
          La factura por tu suscripción a Rutax la emitimos por separado.
        </Text>

        <View style={estilos.pie}>
          <Text>Comprobante generado el {formatearFechaCorta(new Date().toISOString())}</Text>
          <Text>Documento generado por Rutax</Text>
        </View>
      </Page>
    </Document>
  );
}

/** Genera el buffer PDF del comprobante de pago (no tributario) de un período. */
export async function generarPdfComprobantePago(comprobante: ComprobantePago): Promise<Buffer> {
  const buffer = await renderToBuffer(<DocumentoComprobante comprobante={comprobante} />);
  return Buffer.from(buffer);
}
