/**
 * Adaptador concreto de SimpleFactura (Chilesystems / SimpleAPI) para el
 * puerto DTE.
 * =====================================================================
 *
 * ESTADO ACTUAL: STUB para el MVP.
 *
 * El adaptador real requiere:
 * 1. Firma digital del XML con el certificado .pfx del courier (operación
 *    criptográfica que exige el archivo CAF real del SII).
 * 2. Credenciales de producción de SimpleFactura (API key por RUT emisor).
 * 3. Endpoint de producción verificado: documentacion.simpleapi.cl
 *    (confirmar antes de implementar — los endpoints son volátiles).
 *
 * El stub permite que el job C3 sea completamente testeable en Vitest sin
 * necesitar un CAF real ni credenciales de producción.
 *
 * // TODO: reemplazar con llamada real a la API de SimpleFactura
 *
 * VERIFICACIÓN PENDIENTE ANTES DE IMPLEMENTAR EL ADAPTADOR REAL:
 * - Endpoint de emisión: documentacion.simpleapi.cl → "Emisión de DTE"
 *   (verificar URL exacta, versión de API, headers de autenticación).
 * - Formato de credenciales: API key por RUT, header `Authorization: Bearer`
 *   o similar — confirmar contra documentación vigente.
 * - Límites de tasa: confirmar requests/minuto en plan seleccionado.
 * - Sandbox disponible: simpleapi.cl/sandbox — confirmar URL vigente.
 * - Formato del campo `folio`: si SimpleFactura gestiona folios (ver
 *   NOTAS-FOLIOS.md), confirmar si el campo es requerido en emisión directa
 *   o si el proveedor lo asigna internamente.
 * Fuentes: documentacion.simpleapi.cl, simpleapi.cl (junio 2026).
 *
 * REGLAS DE DEPENDENCIAS (§7.2 del documento de arquitectura):
 * - Este adaptador SOLO importa de `../tipos` y `../errores`.
 * - NO importa de `src/modules/dinero`, `src/modules/operacion` ni de
 *   ningún módulo de negocio — el adaptador es una hoja en el grafo.
 */

import type { PuertoDte } from '../puerto';
import { ErrorDteProveedor, ErrorFolioAgotado } from '../errores';
import type {
  ConsultarEstadoDteResultado,
  EmitirFacturaEntrada,
  EmitirFacturaResultado,
  LineaDetalleDte,
  TipoDocumentoDte,
} from '../tipos';

// ---------------------------------------------------------------------------
// Función pura de cálculo de montos — exportada para facilitar tests
// ---------------------------------------------------------------------------

/**
 * Calcula los montos neto, IVA y total a partir de las líneas de detalle.
 *
 * Reglas de cálculo (vigentes para documentos con IVA en Chile):
 * - `neto` = suma de (precioUnitarioNetoCLP * cantidad - descuentoCLP) por línea.
 * - `iva` = Math.round(neto * 0.19) — redondear, no truncar (NUMERIC(12,0) en BD).
 * - `total` = neto + iva.
 *
 * Verificación de tasa IVA:
 * La tasa del 19% es la tasa general del IVA en Chile según Ley 825.
 * Fuente: sii.cl — "Impuesto al Valor Agregado (IVA)" (confirmada junio 2026).
 * Antes de ir a producción: reconfirmar que no haya habido cambio legislativo.
 *
 * Esta función es PURA (sin side effects, sin I/O) para facilitar tests
 * unitarios en Vitest sin necesidad de mocks.
 */
export function calcularMontos(lineas: LineaDetalleDte[]): {
  neto: number;
  iva: number;
  total: number;
} {
  const neto = lineas.reduce((acum, linea) => {
    const subtotal = linea.precioUnitarioNetoCLP * linea.cantidad;
    const descuento = linea.descuentoCLP ?? 0;
    return acum + (subtotal - descuento);
  }, 0);

  // IVA redondeado a entero — sin decimales (NUMERIC(12,0) en `documentos_dte`).
  const iva = Math.round(neto * 0.19);
  const total = neto + iva;

  return { neto, iva, total };
}

// ---------------------------------------------------------------------------
// Adaptador concreto
// ---------------------------------------------------------------------------

/**
 * Implementación stub de `PuertoDte` para SimpleFactura.
 *
 * Las credenciales se reciben en el constructor pero NUNCA se loguean,
 * no se incluyen en errores ni se exponen en ningún resultado.
 * Son responsabilidad de `obtenerPuertoDte` descifrarlas y de este
 * adaptador usarlas solo en el momento de la llamada HTTP real.
 */
export class SimplefacturaAdapter implements PuertoDte {
  /**
   * Las credenciales descifradas del proveedor DTE (JSON con API key, etc.).
   * `null` si el tenant aún no tiene credenciales configuradas (solo para
   * el stub; el adaptador real debe lanzar si son null).
   */
  private readonly credenciales: string | null;

  constructor(credenciales: string | null) {
    this.credenciales = credenciales;
  }

  /**
   * Emite una factura electrónica. STUB: valida el folio y retorna un
   * resultado simulado sin llamar a la API real.
   *
   * // TODO: reemplazar con llamada real a la API de SimpleFactura
   * Pasos del adaptador real:
   * 1. Parsear `this.credenciales` → API key del proveedor.
   * 2. Construir el payload XML/JSON según la spec de SimpleFactura.
   * 3. POST a `https://api.simpleapi.cl/v1/dte/emitir` (verificar endpoint).
   * 4. Manejar respuestas 4xx/5xx → lanzar `ErrorDteProveedor`.
   * 5. Lanzar `ErrorFolioAgotado` si el proveedor responde "sin folios".
   */
  async emitirFactura(
    tenantId: string,
    entrada: EmitirFacturaEntrada,
  ): Promise<EmitirFacturaResultado> {
    // Validación: el folio debe haber sido reservado (> 0).
    // Un folio = 0 indica que el job no completó el paso de reserva.
    if (!entrada.folio || entrada.folio <= 0) {
      // Esta condición es un bug del job C3, no un error del proveedor.
      // Se lanza `ErrorFolioAgotado` para que el job no reintente y alerte.
      throw new ErrorFolioAgotado(tenantId);
    }

    const { neto, iva, total } = calcularMontos(entrada.lineas);

    // Tipo de documento: misma derivación que el adaptador real (Openfactura).
    // Si la entrada trae referencia a otro documento, es una nota de crédito
    // (tipo 61); si no, factura (tipo 33). Los campos `codigoReferencia` y
    // `razonReferencia` (decisión B5b) se aceptan sin efecto en el stub: no
    // hay API real que reciba `CodRef`/`RazonRef`, pero el resultado simulado
    // sí refleja el tipo correcto para que el job C3 persista coherente.
    const tipoDocumento: TipoDocumentoDte =
      entrada.tipoDocumentoReferencia !== undefined ||
      entrada.folioDocumentoReferencia !== undefined
        ? 61
        : 33;

    // STUB: retorna resultado simulado.
    // En producción, este bloque se reemplaza por la llamada HTTP real.
    return {
      idExternoProveedor: `STUB-${entrada.folio}`,
      folio: entrada.folio,
      tipoDocumento,
      montoNetoCLP: neto,
      montoIvaCLP: iva,
      montoTotalCLP: total,
      xmlUrl: null,
      pdfUrl: null,
      estadoSii: 'pendiente',
    };
  }

  /**
   * Consulta el estado del DTE en el SII. STUB: devuelve siempre 'pendiente'.
   *
   * // TODO: reemplazar con llamada real a la API de SimpleFactura
   * Pasos del adaptador real:
   * 1. GET a `https://api.simpleapi.cl/v1/dte/{idExternoProveedor}/estado`.
   * 2. Mapear el estado del proveedor al enum `estadoSii` de esta plataforma.
   * 3. Manejar 4xx/5xx → lanzar `ErrorDteProveedor`.
   */
  async consultarEstadoDte(
    _tenantId: string,
    idExternoProveedor: string,
  ): Promise<ConsultarEstadoDteResultado> {
    // STUB
    return {
      idExternoProveedor,
      estadoSii: 'pendiente',
      descripcionSii: null,
    };
  }

  /**
   * Descarga el XML firmado del DTE. STUB: lanza error (no disponible en stub).
   *
   * // TODO: reemplazar con llamada real a la API de SimpleFactura
   */
  async descargarXmlDte(
    _tenantId: string,
    idExternoProveedor: string,
  ): Promise<string> {
    throw new ErrorDteProveedor(
      501,
      `descarga de XML no disponible en el adaptador stub (id: ${idExternoProveedor})`,
    );
  }

  /**
   * Descarga el PDF del DTE. STUB: lanza error (no disponible en stub).
   *
   * // TODO: reemplazar con llamada real a la API de SimpleFactura
   */
  async descargarPdfDte(
    _tenantId: string,
    idExternoProveedor: string,
  ): Promise<string> {
    throw new ErrorDteProveedor(
      501,
      `descarga de PDF no disponible en el adaptador stub (id: ${idExternoProveedor})`,
    );
  }
}
