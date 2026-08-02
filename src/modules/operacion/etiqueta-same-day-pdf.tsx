/**
 * Etiqueta imprimible con QR interno para pedidos same-day.
 *
 * Calcado del patrón de `src/modules/dinero/liquidacion-pdf.tsx`: usa
 * `@react-pdf/renderer`, `renderToBuffer`, generación on-the-fly (no se
 * persiste en Storage — reimpresión ilimitada, siempre auditada por el
 * llamador).
 *
 * El QR codifica el `codigo_interno` CRUDO (p. ej. `RX-7K2M-9QP4`), no una URL
 * ni un payload firmado — es un identificador operativo interno, no un enlace
 * público.
 *
 * Contenido deliberadamente EXCLUIDO (no es información para el destinatario
 * ni para terceros que puedan ver la etiqueta en tránsito):
 * - Monto/precio del envío.
 * - Datos de cuenta ML.
 * - UUID interno / tracking_token (ese es el identificador del enlace público
 *   de tracking, no debe imprimirse en la etiqueta física).
 * - Aviso de corte_riesgo (información operativa interna, no para la etiqueta).
 */

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import QRCode from "qrcode";

export type FormatoEtiqueta = "termica" | "carta";

export interface EtiquetaSameDayPdfProps {
  codigoInterno: string;
  destinatarioNombre: string;
  destinatarioDireccion: string;
  destinatarioComuna: string;
  destinatarioTelefono?: string | null;
  sellerNombre: string;
  /** Fecha compromiso 'YYYY-MM-DD'. */
  fechaCompromiso?: string | null;
  instruccionesEntrega?: string | null;
  formato: FormatoEtiqueta;
}

// Tamaños de página en puntos (72pt = 1 pulgada).
// Térmica 10x15 cm ≈ 283.5 x 425.2 pt.
const TAMANO_TERMICA = { width: 283.5, height: 425.2 };

const MAX_INSTRUCCIONES = 140;

function formatearFecha(iso?: string | null): string | null {
  if (!iso || iso.length < 10) return null;
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function truncar(texto: string, maxLen: number): string {
  if (texto.length <= maxLen) return texto;
  return `${texto.slice(0, maxLen - 1).trimEnd()}…`;
}

const estilosTermica = StyleSheet.create({
  pagina: {
    fontFamily: "Helvetica",
    fontSize: 9,
    padding: 14,
    color: "#111827",
  },
  franja: {
    backgroundColor: "#111827",
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    textAlign: "center",
    padding: "5 0",
    borderRadius: 3,
    marginBottom: 10,
    letterSpacing: 1,
  },
  bloqueQr: {
    alignItems: "center",
    marginBottom: 8,
  },
  qr: {
    width: 140,
    height: 140,
  },
  codigo: {
    fontFamily: "Helvetica-Bold",
    fontSize: 15,
    letterSpacing: 1,
    marginTop: 6,
    textAlign: "center",
  },
  separador: {
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
    marginVertical: 8,
  },
  etiquetaCampo: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  destinatario: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  valor: {
    fontSize: 10,
    marginBottom: 8,
  },
  pie: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: "#d1d5db",
    fontSize: 7,
    color: "#9ca3af",
    textAlign: "center",
  },
});

const estilosCarta = StyleSheet.create({
  pagina: {
    fontFamily: "Helvetica",
    fontSize: 11,
    padding: 48,
    color: "#111827",
  },
  franja: {
    backgroundColor: "#111827",
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    textAlign: "center",
    padding: "8 0",
    borderRadius: 4,
    marginBottom: 24,
    letterSpacing: 1.5,
  },
  bloqueQr: {
    alignItems: "center",
    marginBottom: 20,
  },
  qr: {
    width: 180,
    height: 180,
  },
  codigo: {
    fontFamily: "Helvetica-Bold",
    fontSize: 20,
    letterSpacing: 1.5,
    marginTop: 10,
    textAlign: "center",
  },
  separador: {
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
    marginVertical: 16,
  },
  etiquetaCampo: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  destinatario: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 10,
  },
  valor: {
    fontSize: 13,
    marginBottom: 14,
  },
  pie: {
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: "#d1d5db",
    fontSize: 9,
    color: "#9ca3af",
    textAlign: "center",
  },
});

function DocumentoEtiqueta({
  codigoInterno,
  destinatarioNombre,
  destinatarioDireccion,
  destinatarioComuna,
  destinatarioTelefono,
  sellerNombre,
  fechaCompromiso,
  instruccionesEntrega,
  formato,
  qrDataUrl,
}: EtiquetaSameDayPdfProps & { qrDataUrl: string }) {
  const estilos = formato === "termica" ? estilosTermica : estilosCarta;
  const fechaFormateada = formatearFecha(fechaCompromiso);

  return (
    <Document title={`Etiqueta ${codigoInterno}`} author="Rutax">
      <Page
        size={formato === "termica" ? TAMANO_TERMICA : "A4"}
        style={estilos.pagina}
      >
        <Text style={estilos.franja}>SAME-DAY · RUTAX</Text>

        <View style={estilos.bloqueQr}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- `Image` de @react-pdf/renderer, no <img> del DOM; no admite `alt`. */}
          <Image src={qrDataUrl} style={estilos.qr} />
          <Text style={estilos.codigo}>{codigoInterno}</Text>
        </View>

        <View style={estilos.separador} />

        <Text style={estilos.etiquetaCampo}>Destinatario</Text>
        <Text style={estilos.destinatario}>{destinatarioNombre}</Text>

        <Text style={estilos.etiquetaCampo}>Dirección</Text>
        <Text style={estilos.valor}>
          {destinatarioDireccion}, {destinatarioComuna}
        </Text>

        {destinatarioTelefono ? (
          <>
            <Text style={estilos.etiquetaCampo}>Teléfono</Text>
            <Text style={estilos.valor}>{destinatarioTelefono}</Text>
          </>
        ) : null}

        <Text style={estilos.etiquetaCampo}>Remitente</Text>
        <Text style={estilos.valor}>{sellerNombre}</Text>

        {fechaFormateada ? (
          <>
            <Text style={estilos.etiquetaCampo}>Fecha compromiso</Text>
            <Text style={estilos.valor}>{fechaFormateada}</Text>
          </>
        ) : null}

        {instruccionesEntrega ? (
          <>
            <Text style={estilos.etiquetaCampo}>Instrucciones</Text>
            <Text style={estilos.valor}>
              {truncar(instruccionesEntrega, MAX_INSTRUCCIONES)}
            </Text>
          </>
        ) : null}

        <View style={estilos.pie}>
          <Text>Etiqueta operativa interna · Rutax</Text>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Genera el buffer PDF de una etiqueta same-day, con QR incrustado que
 * codifica el `codigoInterno` crudo.
 */
export async function generarEtiquetaSameDayPdf(
  props: EtiquetaSameDayPdfProps,
): Promise<Buffer> {
  const qrDataUrl = await QRCode.toDataURL(props.codigoInterno, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });

  const buffer = await renderToBuffer(
    <DocumentoEtiqueta {...props} qrDataUrl={qrDataUrl} />,
  );
  return Buffer.from(buffer);
}
