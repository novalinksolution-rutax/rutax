/**
 * Tipos del adaptador DTE — Documentos Tributarios Electrónicos.
 * =====================================================================
 *
 * Espejo en TS de la interfaz que define el documento de arquitectura §5.1
 * (docs/arquitectura/fase-c-dinero.md). El courier es SIEMPRE el emisor
 * legal bajo su propio RUT; la plataforma orquesta la emisión vía un
 * proveedor certificado (skill chile-dte).
 *
 * PRINCIPIO CLAVE (skill chile-dte):
 * - El courier emite bajo SU propio RUT — nunca "como" la plataforma.
 * - La factura (tipo 33) es del courier al seller.
 * - Notas de crédito (tipo 61) para ajustes.
 * - Certificados y folios son datos sensibles: cifrados, nunca en logs.
 *
 * Verificación de detalles volátiles:
 * - Tipo 33 = Factura Electrónica (SII Chile, vigente).
 * - Tipo 61 = Nota de Crédito Electrónica (SII Chile, vigente).
 * - IVA: 19% según Ley 825 de IVA, tasa vigente confirmada.
 * Fuente: sii.cl — "Catálogo de Documentos Tributarios Electrónicos".
 * Antes de ir a producción: reconfirmar contra tabla vigente de
 * tipos de documento en sii.cl (los tipos no cambian frecuentemente,
 * pero el catálogo es la fuente de verdad).
 */

/** Proveedores DTE soportados. Candidato líder: SimpleFactura (Chilesystems). */
export type ProveedorDte = 'simplefactura' | 'openfactura';

/**
 * Tipo de documento SII.
 * - 33: Factura Electrónica — del courier al seller por servicios de entrega.
 * - 61: Nota de Crédito Electrónica — para ajustes sobre una factura emitida.
 */
export type TipoDocumentoDte = 33 | 61;

/**
 * Línea de detalle del documento.
 * `precioUnitarioNetoCLP` es el valor NETO (sin IVA) — el proveedor DTE
 * calcula el IVA al armar el XML según la tabla de tasas del SII.
 * `descuentoCLP` es opcional; si se incluye, se resta al neto de la línea.
 */
export interface LineaDetalleDte {
  nombre: string;
  cantidad: number;
  precioUnitarioNetoCLP: number;
  descuentoCLP?: number;
}

/**
 * Entrada para emitir una factura electrónica (tipo 33) o nota de crédito
 * (tipo 61). El folio debe ser RESERVADO transaccionalmente antes de llamar
 * al proveedor (protocolo §5.4 del documento de arquitectura).
 */
export interface EmitirFacturaEntrada {
  rutEmisor: string;
  razonSocialEmisor: string;
  rutReceptor: string;
  razonSocialReceptor: string;
  emailReceptor: string;
  /** Fecha en formato ISO date (YYYY-MM-DD), zona horaria America/Santiago. */
  fechaEmision: string;
  /** Folio ya reservado del CAF antes de llamar al proveedor. */
  folio: number;
  lineas: LineaDetalleDte[];
  /** Solo para notas de crédito (tipo 61): folio del documento referenciado. */
  folioDocumentoReferencia?: number;
  /** Solo para notas de crédito (tipo 61): tipo del documento referenciado. */
  tipoDocumentoReferencia?: TipoDocumentoDte;
}

/**
 * Resultado de la emisión. Las URLs de XML y PDF son nulas mientras el
 * proveedor procesa el documento con el SII; se actualizan con el job de
 * polling (C5).
 */
export interface EmitirFacturaResultado {
  /** ID asignado por el proveedor DTE (opaco; se persiste en `documentos_dte`). */
  idExternoProveedor: string;
  folio: number;
  tipoDocumento: TipoDocumentoDte;
  montoNetoCLP: number;
  montoIvaCLP: number;
  montoTotalCLP: number;
  /** URL del XML firmado — null mientras el proveedor no lo haya generado. */
  xmlUrl: string | null;
  /** URL del PDF — null mientras el proveedor no lo haya generado. */
  pdfUrl: string | null;
  estadoSii: 'pendiente' | 'aceptado' | 'rechazado' | 'aceptado_con_discrepancias';
}

/**
 * Resultado de consultar el estado de un DTE ya emitido en el SII.
 * Consumido por el job de polling C5.
 */
export interface ConsultarEstadoDteResultado {
  idExternoProveedor: string;
  estadoSii: 'pendiente' | 'aceptado' | 'rechazado' | 'aceptado_con_discrepancias';
  /** Descripción textual del SII (p.ej. razón de rechazo). Null si no aplica. */
  descripcionSii: string | null;
}
