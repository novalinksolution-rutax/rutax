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
  /**
   * ⚠️ **Ya no se imprime.** Se conserva en la interfaz porque los llamadores lo
   * pasan y quitarlo obligaría a tocarlos sin necesidad, pero la etiqueta no lo
   * usa: viaja pegada al bulto y una instrucción de acceso impresa la lee
   * cualquiera que pase. El conductor la ve en la app.
   */
  instruccionesEntrega?: string | null;
  formato: FormatoEtiqueta;
}

// Tamaños de página en puntos (72pt = 1 pulgada).
// Térmica 10x15 cm ≈ 283.5 x 425.2 pt.
const TAMANO_TERMICA = { width: 283.5, height: 425.2 };

function formatearFecha(iso?: string | null): string | null {
  if (!iso || iso.length < 10) return null;
  const [anio, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

/**
 * Térmica 10×15 cm a 203 ppp. **Medio hostil**, y eso manda sobre el gusto.
 * =============================================================================
 * Los valores salen de los tokens `[data-rx-media="thermal"]` de
 * `rx-tokens.css:634-652`, que hasta hoy **no tenían un solo consumidor**: el
 * bloque estaba escrito y la etiqueta seguía con hex sueltos del ADN anterior.
 * Acá se transcriben porque `@react-pdf` tampoco lee CSS.
 *
 * LAS CUATRO REGLAS DURAS, Y QUÉ ROMPÍA CADA UNA
 * -----------------------------------------------------------------------------
 * 1. **Cero grises.** Había `#6b7280` en los rótulos y `#9ca3af` en el pie. Una
 *    impresora térmica no tiene grises: los simula con una trama de puntos que
 *    a 7 pt se convierte en una mancha. Todo va en negro puro.
 * 2. **Ningún texto bajo 15.** Los rótulos de campo estaban en **7** y el pie en
 *    **7**. Eso no se lee desde una camioneta, que es donde se lee una etiqueta.
 * 3. **Cero tramas de fondo.** La franja del encabezado era un rectángulo
 *    `#111827` sólido con texto blanco. En térmica un fondo lleno gasta cabezal,
 *    se corre con el calor y el texto invertido es lo primero que se pierde. La
 *    separación se hace con **reglas de 2 y 3 px**, no con manchas.
 * 4. **Ningún peso bajo 400.** Se cumplía; se conserva.
 *
 * Y una que no es de tinta sino de lectura: **la comuna va MÁS GRANDE que el
 * nombre** (24 contra 17). Quien reparte ordena por comuna en el piso de la
 * bodega y en la van; el nombre lo lee recién al tocar el timbre.
 */
const estilosTermica = StyleSheet.create({
  pagina: {
    fontFamily: "Helvetica",
    fontSize: 15, // --rx-thermal-min-text, el piso absoluto
    padding: 12,
    color: "#000000",
  },
  // Encabezado sin fondo: rótulo en negro sobre blanco y una regla de 3 px
  // debajo. Es la separación más fuerte de la etiqueta.
  franja: {
    fontFamily: "Helvetica-Bold",
    fontSize: 15,
    textAlign: "center",
    letterSpacing: 1,
    paddingBottom: 6,
    borderBottomWidth: 3, // --rx-thermal-rule-lead
    borderBottomColor: "#000000",
    marginBottom: 10,
  },
  bloqueQr: {
    alignItems: "center",
    marginBottom: 6,
  },
  qr: {
    width: 100, // --rx-thermal-qr · 2,6 cm
    height: 100,
    // Zona de silencio: sin ella el lector engancha el texto de al lado como si
    // fuera parte del símbolo y falla a media luz.
    padding: 4, // --rx-thermal-qr-quiet
  },
  // El código, PRIMERA aparición: grande y partido, para leerlo de lejos.
  codigo: {
    fontFamily: "Courier-Bold",
    fontSize: 40, // --rx-thermal-code
    letterSpacing: 1,
    textAlign: "center",
    marginTop: 4,
    lineHeight: 1.05,
  },
  // SEGUNDA aparición: sin guiones, para digitarlo sin equivocarse. Todo código
  // impreso aparece dos veces — una para el ojo y otra para el teclado.
  codigoDigitable: {
    fontFamily: "Courier",
    fontSize: 15,
    letterSpacing: 2,
    textAlign: "center",
    marginTop: 2,
  },
  separador: {
    borderBottomWidth: 2, // --rx-thermal-rule
    borderBottomColor: "#000000",
    marginVertical: 8,
  },
  etiquetaCampo: {
    fontSize: 15, // el piso también rige para los rótulos
    fontFamily: "Helvetica-Bold",
    color: "#000000",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 1,
  },
  // La comuna manda sobre el nombre: es por lo que se ordena.
  comuna: {
    fontSize: 24, // --rx-thermal-comuna
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  destinatario: {
    fontSize: 17, // --rx-thermal-name
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  valor: {
    fontSize: 15,
    marginBottom: 6,
  },
  pie: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 2,
    borderTopColor: "#000000",
    fontSize: 15,
    color: "#000000",
    textAlign: "center",
  },
});

/**
 * Las reglas duras de la térmica se comprueban sobre este objeto, no sobre el
 * PDF: un PDF binario no deja preguntarle a un color si es gris.
 * Ver `etiqueta-termica-reglas.test.ts`.
 */
export const ESTILOS_TERMICA_PARA_PRUEBAS = estilosTermica as unknown as Record<
  string,
  Record<string, unknown>
>;

const estilosCarta = StyleSheet.create({
  pagina: {
    fontFamily: "Helvetica",
    fontSize: 11,
    padding: 48,
    color: "#0B1114", // --rx-fg
  },
  franja: {
    // En carta la banda sí puede ser sólida —una láser imprime negro sin
    // correrse— pero va con el negro del sistema, no con un gris azulado suelto.
    backgroundColor: "#0B1114", // --rx-line-strong
    color: "#FFFFFF",
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
    borderBottomWidth: 2, // --rx-print-total-rule
    borderBottomColor: "#C6D6D8", // --rx-line
    marginVertical: 16,
  },
  etiquetaCampo: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#3E4D53", // --rx-fg-muted · el único gris de texto impreso
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
    borderTopWidth: 2,
    borderTopColor: "#DCE7E8", // --rx-line-subtle
    fontSize: 9,
    color: "#3E4D53", // era #9ca3af: 2,5:1 sobre blanco
    textAlign: "center",
  },
});

/**
 * Parte el código en dos líneas para la lectura a distancia.
 *
 * `RX-4821-9134` se lee mejor como dos bloques apilados que como una línea de
 * doce caracteres a cuerpo 40 — que además no cabría en 10 cm de ancho.
 */
function partirCodigo(codigo: string): string {
  const partes = codigo.split("-");
  if (partes.length < 3) return codigo;
  return `${partes[0]}-${partes[1]}
${partes.slice(2).join("-")}`;
}

/** La forma digitable: sin guiones, que es como se escribe en el buscador. */
function sinGuiones(codigo: string): string {
  return codigo.replace(/-/g, "");
}

function DocumentoEtiqueta({
  codigoInterno,
  destinatarioNombre,
  destinatarioDireccion,
  destinatarioComuna,
  destinatarioTelefono,
  sellerNombre,
  fechaCompromiso,
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
          {/* El código, DOS VECES. Arriba partido y grande, para leerlo desde
              lejos y para cantarlo por radio sin equivocarse de bloque; abajo
              corrido y sin guiones, que es como se digita en el buscador. Un
              solo formato obliga a elegir entre las dos lecturas, y las dos
              ocurren todos los días. */}
          {formato === "termica" ? (
            <>
              <Text style={estilosTermica.codigo}>{partirCodigo(codigoInterno)}</Text>
              <Text style={estilosTermica.codigoDigitable}>{sinGuiones(codigoInterno)}</Text>
            </>
          ) : (
            <Text style={estilos.codigo}>{codigoInterno}</Text>
          )}
        </View>

        <View style={estilos.separador} />

        {/* ⚠️ La COMUNA primero y más grande que el nombre. Antes iba dentro de
            la dirección, en cuerpo 10, después del nombre: quien clasifica en el
            piso de la bodega tenía que leer una línea entera para saber a qué
            montón va el bulto. El nombre se lee recién al tocar el timbre. */}
        {formato === "termica" ? (
          <>
            <Text style={estilosTermica.etiquetaCampo}>Comuna</Text>
            <Text style={estilosTermica.comuna}>{destinatarioComuna}</Text>

            <Text style={estilosTermica.etiquetaCampo}>Destinatario</Text>
            <Text style={estilosTermica.destinatario}>{destinatarioNombre}</Text>

            <Text style={estilosTermica.etiquetaCampo}>Dirección</Text>
            <Text style={estilosTermica.valor}>{destinatarioDireccion}</Text>
          </>
        ) : (
          <>
            <Text style={estilos.etiquetaCampo}>Destinatario</Text>
            <Text style={estilos.destinatario}>{destinatarioNombre}</Text>

            <Text style={estilos.etiquetaCampo}>Dirección</Text>
            <Text style={estilos.valor}>
              {destinatarioDireccion}, {destinatarioComuna}
            </Text>
          </>
        )}

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

        {/* ⚠️ ACÁ SE IMPRIMÍAN LAS INSTRUCCIONES DE ENTREGA, y se retiraron
            (decisión del usuario, 23-08-2026).
            La etiqueta **viaja pegada al bulto**: la lee el conserje, el vecino
            del pasillo y cualquiera que pase por el hall del edificio. «Timbre
            3B», «la llave está bajo el macetero» o «dejar en conserjería, no hay
            nadie hasta las 8» no son datos operativos en ese contexto — son una
            indicación de cómo entrar, impresa en la puerta.
            La instrucción **no se perdió**: sigue en el pedido y el conductor la
            ve en la app, que es donde solo la ve él. */}

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
