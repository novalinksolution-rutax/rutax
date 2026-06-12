/**
 * Adaptador ESQUELETO de Openfactura (Haulmer) para el puerto DTE.
 * =====================================================================
 *
 * PROPÓSITO (B1-3 del plan de revisión): de-riesgar los supuestos del stub
 * `SimplefacturaAdapter` validando el contrato del puerto contra un proveedor
 * REAL y certificado por el SII, con sandbox gratuito. Este esqueleto NO es el
 * adaptador activo por defecto: el stub sigue siendo el default en
 * `puerto.ts`. Sirve para fijar los mappings request/response correctos antes
 * de que el frontend construya las pantallas de facturación encima de
 * supuestos del stub.
 *
 * NO se cablea en la fábrica `obtenerPuertoDte` hasta tener credenciales del
 * sandbox y validar el contrato en vivo (ver TODOs marcados abajo y
 * `docs/arquitectura/validacion-dte-openfactura.md`).
 *
 * ---------------------------------------------------------------------------
 * CONTRATO REAL VERIFICADO CONTRA DOCUMENTACIÓN OFICIAL (junio 2026)
 * ---------------------------------------------------------------------------
 * Fuentes:
 *  - https://docsapi-openfactura.haulmer.com/ (portal oficial de la API; SPA).
 *  - https://www.haulmer.dev/factura-electronica/api (ejemplo cURL del POST).
 *  - https://github.com/haulmer/openfactura-woocommerce (plugin oficial:
 *    hosts dev/prod, header `apikey`, estructura `dte.Encabezado`).
 *  - SDK comunitario OpenAPI-generado `tsukiro/openfactura-api-sdk`
 *    (operaciones, modelos `DTERequest`/`DTEResponse`, paths `/v2/dte/...`).
 *
 * Hosts (verificados):
 *  - Sandbox/dev: `https://dev-api.haulmer.com`  (CAF simulado; el timbre no
 *    se valida ante el SII — perfecto para validar contrato sin folios reales).
 *  - Producción:  `https://api.haulmer.com`
 *
 * Autenticación (verificada):
 *  - Header `apikey: <API_KEY>` (NO es `Authorization: Bearer`). La API key se
 *    genera por cuenta del titular del servicio en el espacio de trabajo de
 *    Openfactura. Como cada courier emite bajo su propio RUT (multiempresa),
 *    la API key viene en `this.credenciales` (descifrada por la fábrica) y es
 *    POR-TENANT — nunca compartida ni hardcodeada.
 *
 * Emisión (verificada):
 *  - `POST /v2/dte/document`
 *  - Body: `{ response: [...formatos], dte: { Encabezado, Detalle, ... } }`.
 *    `response` selecciona qué adjuntos devuelve INLINE la respuesta:
 *    `"XML" | "PDF" | "TIMBRE" | "LOGO" | "FOLIO" | "RESOLUCION"`.
 *  - Respuesta `DTEResponse`: `{ TOKEN, FOLIO, PDF, XML, TIMBRE, LOGO,
 *    RESOLUCION }`. PDF y XML llegan INLINE como base64 en la MISMA respuesta
 *    de emisión cuando se piden en `response` (no requieren GET aparte).
 *  - `TOKEN` es el identificador opaco del documento → se mapea a
 *    `idExternoProveedor` y se persiste para consultas posteriores.
 *
 * Consulta de documento (verificada como path; semántica de estado por
 * confirmar en vivo):
 *  - `GET /v2/dte/document/{rut}/{type}/{documentNumber}/{value}`
 *    "Entrega la información de un documento emitido o recibido".
 *    El SDK no documenta el shape del estado SII (modelo `InlineResponse200`
 *    vacío) → hay que confirmar contra sandbox real qué campo trae el estado
 *    de aceptación/rechazo del SII (TODO-ESTADO-SII abajo).
 *
 * Idempotencia (verificada en plugin oficial):
 *  - Header `Idempotency-Key` soportado en el POST de emisión. Lo usamos con
 *    `{rutEmisor}-{tipoDocumento}-{folio}` para que un reintento de red del
 *    job C3 no produzca un segundo documento.
 *
 * REGLAS DE DEPENDENCIAS (§7.2 del documento de arquitectura):
 *  - Este adaptador SOLO importa de `../tipos`, `../errores` y
 *    `../../resiliencia` (utilidad compartida de backoff/reintentos).
 *  - NO importa de `src/modules/dinero`, `operacion` ni de ningún módulo de
 *    negocio — el adaptador es una hoja en el grafo de dependencias.
 *
 * SEGURIDAD:
 *  - La API key (`this.credenciales`) NUNCA se loguea, no se incluye en
 *    errores ni se expone en ningún resultado. Solo se usa para construir el
 *    header `apikey` en el último momento.
 *  - El XML/PDF base64 NUNCA se serializa en logs — quien llama los persiste
 *    en Storage privado.
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
import {
  reintentarConBackoff,
  type ErrorReintentable,
} from '../../resiliencia';
import { calcularMontos } from './simplefactura';

// ---------------------------------------------------------------------------
// Hosts oficiales (verificados — ver cabecera del archivo).
// ---------------------------------------------------------------------------

/** Host del sandbox/dev de Openfactura (CAF simulado). */
export const OPENFACTURA_BASE_URL_DEV = 'https://dev-api.haulmer.com';
/** Host de producción de Openfactura. */
export const OPENFACTURA_BASE_URL_PROD = 'https://api.haulmer.com';

/**
 * Formatos que Openfactura puede devolver INLINE (base64) en la respuesta de
 * emisión, seleccionados vía el array `response` del request.
 */
const FORMATOS_RESPUESTA = ['FOLIO', 'PDF', 'XML', 'TIMBRE'] as const;

// ---------------------------------------------------------------------------
// Error HTTP del proveedor — clasifica reintentables (429/5xx) igual que ML.
// ---------------------------------------------------------------------------

/**
 * Error de transporte/HTTP contra Openfactura. Marca como `reintentable` los
 * 429 (límite de tasa) y 5xx (transitorios) para que `reintentarConBackoff`
 * los reintente; los 4xx restantes son definitivos y NO se reintentan.
 *
 * El `cuerpo` se asume YA saneado de secretos por el llamador — nunca incluye
 * la API key (que viaja solo en el header `apikey`, no en el body).
 */
class ErrorHttpOpenfactura extends Error implements Partial<ErrorReintentable> {
  readonly status: number;
  readonly reintentable?: true;
  readonly retryAfterMs?: number;
  /** Mensaje operativo saneado del cuerpo `{error:{...}}` (sin secretos). */
  readonly mensajeProveedor?: string;
  /** Código de negocio del proveedor (p. ej. `"OF-10"`), si vino. */
  readonly codigoProveedor?: string;

  constructor(
    mensaje: string,
    status: number,
    opts?: { retryAfterMs?: number; mensajeProveedor?: string; codigoProveedor?: string },
  ) {
    super(mensaje);
    this.name = 'ErrorHttpOpenfactura';
    this.status = status;
    if (opts?.mensajeProveedor) this.mensajeProveedor = opts.mensajeProveedor;
    if (opts?.codigoProveedor) this.codigoProveedor = opts.codigoProveedor;
    if (status === 429 || status >= 500) {
      this.reintentable = true;
      if (opts?.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    }
  }
}

/**
 * Extrae un mensaje operativo SANEADO del cuerpo de error de Openfactura, cuyo
 * shape fue verificado en vivo: `{ error: { message, code, details:[{field,
 * issue}] } }`. Solo toma texto de negocio (mensaje, código y el primer
 * field/issue) — nunca el cuerpo crudo completo ni headers, y la API key jamás
 * viaja en el body. Devuelve `null` si el cuerpo no tiene esa forma.
 */
function extraerErrorOpenfactura(
  cuerpo: unknown,
): { mensaje: string; codigo?: string } | null {
  if (!cuerpo || typeof cuerpo !== 'object' || !('error' in cuerpo)) return null;
  const err = (cuerpo as { error?: unknown }).error;
  if (!err || typeof err !== 'object') return null;
  const e = err as { message?: string; code?: string; details?: Array<{ field?: string; issue?: string }> };
  const detalle = Array.isArray(e.details) && e.details.length > 0 ? e.details[0] : undefined;
  const partes = [
    e.message,
    detalle?.field && detalle.field !== 'Error' ? `[${detalle.field}]` : undefined,
    detalle?.issue,
  ].filter(Boolean);
  if (partes.length === 0 && !e.code) return null;
  return { mensaje: partes.join(' ') || 'error sin descripción', codigo: e.code };
}

/**
 * ¿El error del proveedor indica folios/CAF agotados? Heurística sobre el
 * mensaje saneado, a falta de un código dedicado documentado por Openfactura.
 * El job C3 usa esto para NO reintentar y alertar (job C7) en vez de fallar duro.
 */
function pareceFolioAgotado(texto: string): boolean {
  return /folio|caf|timbr/i.test(texto) && /agotad|insuficien|sin\s|no\s+hay|disponib/i.test(texto);
}

// ---------------------------------------------------------------------------
// Forma (parcial) del request/response de Openfactura — verificada.
// ---------------------------------------------------------------------------

/** Payload de emisión `POST /v2/dte/document` (subconjunto que usamos). */
interface OpenfacturaDocumentRequest {
  response: readonly string[];
  dte: {
    Encabezado: {
      IdDoc: {
        TipoDTE: number;
        Folio: number;
        FchEmis: string;
      };
      Emisor: {
        RUTEmisor: string;
        RznSoc: string;
      };
      Receptor: {
        RUTRecep: string;
        RznSocRecep: string;
        // Openfactura usa `CorreoRecep` para el envío al receptor.
        CorreoRecep?: string;
      };
      Totales: {
        MntNeto: number;
        TasaIVA: string;
        IVA: number;
        MntTotal: number;
      };
    };
    Detalle: Array<{
      NroLinDet: number;
      NmbItem: string;
      QtyItem: number;
      PrcItem: number;
      MontoItem: number;
      DescuentoMonto?: number;
    }>;
    // Referencia: solo para notas de crédito (tipo 61).
    Referencia?: Array<{
      NroLinRef: number;
      TpoDocRef: string;
      FolioRef: number;
      // Código 1 = anula documento referenciado (uso típico de NC).
      CodRef?: number;
    }>;
  };
}

/** Respuesta de `POST /v2/dte/document` (modelo `DTEResponse` — verificado). */
interface OpenfacturaDocumentResponse {
  TOKEN: string;
  FOLIO: number;
  /** PDF en base64 (presente si se pidió "PDF" en `response`). */
  PDF?: string;
  /** XML firmado en base64 (presente si se pidió "XML" en `response`). */
  XML?: string;
  TIMBRE?: string;
  /**
   * Cuerpo de error de Openfactura — VERIFICADO EN VIVO contra el sandbox
   * (`scripts/validacion-dte-openfactura.mjs`, junio 2026):
   *   `{ error: { message, code, details: [{ field, issue }] } }`
   * `code` es un STRING tipo `"OF-02"` / `"OF-10"` (NO numérico, como asumía el
   * esqueleto original), y `details` es un array con el campo y el problema
   * concretos. Ninguno de estos campos lleva secretos (la API key viaja solo en
   * el header `apikey`), así que el cuerpo es seguro para construir el mensaje
   * operativo del error.
   *
   * Códigos observados: `OF-02` = faltan campos obligatorios; `OF-10` =
   * validación de campos (p. ej. actividad económica no registrada).
   */
  error?: {
    message?: string;
    code?: string;
    details?: Array<{ field?: string; issue?: string }>;
  };
}

// ---------------------------------------------------------------------------
// Adaptador concreto (ESQUELETO)
// ---------------------------------------------------------------------------

/**
 * Implementación esqueleto de `PuertoDte` para Openfactura (Haulmer).
 *
 * Las credenciales (API key del tenant) se reciben en el constructor pero
 * NUNCA se loguean, no se incluyen en errores ni se exponen en resultados.
 */
export class OpenfacturaAdapter implements PuertoDte {
  /** API key por-tenant (descifrada por `obtenerPuertoDte`). */
  private readonly apiKey: string | null;
  /** Host base — dev (sandbox) o prod, según `DTE_SANDBOX_MODE`. */
  private readonly baseUrl: string;

  /**
   * @param credenciales API key del tenant ya descifrada (o `null` si no
   *   configurada — el adaptador real DEBE lanzar si es null antes de llamar).
   * @param baseUrl host a usar; default = sandbox/dev. Inyectable para tests.
   */
  constructor(credenciales: string | null, baseUrl: string = OPENFACTURA_BASE_URL_DEV) {
    // TODO-CREDENCIALES: `credenciales` puede venir como JSON (p. ej.
    // `{"apiKey":"...","rutEmisor":"..."}`) o como la API key cruda. Definir el
    // formato exacto del secreto cifrado en el onboarding del courier y
    // parsearlo aquí. Por ahora se asume API key cruda en texto.
    this.apiKey = credenciales;
    this.baseUrl = baseUrl;
  }

  async emitirFactura(
    tenantId: string,
    entrada: EmitirFacturaEntrada,
  ): Promise<EmitirFacturaResultado> {
    // El folio debe haber sido reservado por el job C3 (> 0).
    if (!entrada.folio || entrada.folio <= 0) {
      throw new ErrorFolioAgotado(tenantId);
    }

    // TODO-CREDENCIALES: el adaptador real debe rechazar la emisión sin API key.
    this.exigirApiKey();

    const { neto, iva, total } = calcularMontos(entrada.lineas);
    const tipoDocumento: TipoDocumentoDte =
      entrada.tipoDocumentoReferencia !== undefined ||
      entrada.folioDocumentoReferencia !== undefined
        ? 61
        : 33;

    const payload = this.construirPayloadEmision(entrada, {
      neto,
      iva,
      total,
      tipoDocumento,
    });

    // Idempotency-Key estable: un reintento de red no debe emitir dos veces.
    const idempotencyKey = `${entrada.rutEmisor}-${tipoDocumento}-${entrada.folio}`;

    // VERIFICADO EN VIVO (sandbox, junio 2026): el POST con `response`
    // incluyendo "PDF"/"XML"/"TIMBRE" devuelve los tres INLINE en base64 en la
    // misma respuesta, junto a `TOKEN` (hex de 64) y `FOLIO` (auto-asignado).
    const respuesta = await this.peticion<OpenfacturaDocumentResponse>({
      metodo: 'POST',
      ruta: '/v2/dte/document',
      cuerpoJson: payload,
      idempotencyKey,
      tenantId,
    });

    return {
      idExternoProveedor: respuesta.TOKEN,
      folio: entrada.folio,
      tipoDocumento,
      montoNetoCLP: neto,
      montoIvaCLP: iva,
      montoTotalCLP: total,
      // GAP CLAVE vs. stub: aquí el PDF/XML llegan INLINE (base64), no como URL.
      // El puerto declara `xmlUrl`/`pdfUrl: string | null`. Por ahora NO los
      // serializamos como URL: quien persiste (job C3) debe subir el base64 a
      // Storage privado y guardar la signed URL. Hasta cablear ese flujo,
      // devolvemos null para no romper el contrato del puerto.
      // TODO-PUERTO: ver gap analysis del doc — el puerto necesita una forma de
      // recibir el contenido base64 (no solo URL) o el job debe llamar a
      // `descargarPdfDte`/`descargarXmlDte` por separado. Documentado, NO
      // aplicado aquí (restricción dura: no tocar el puerto).
      xmlUrl: null,
      pdfUrl: null,
      // GAP CLAVE vs. stub: el SII es ASÍNCRONO. La emisión devuelve el DTE
      // timbrado y "enviado", pero la aceptación/rechazo del SII llega después
      // → estado inicial 'pendiente', resuelto por el job de polling C5.
      estadoSii: 'pendiente',
    };
  }

  async consultarEstadoDte(
    tenantId: string,
    idExternoProveedor: string,
  ): Promise<ConsultarEstadoDteResultado> {
    this.exigirApiKey();

    // VERIFICADO EN VIVO (sandbox, junio 2026): el path es
    //   GET /v2/dte/document/{rut}/{tipo}/{folio}/{value}
    // (4 segmentos tras `document`; sin el último da 404 "Api no encontrada").
    // DOS BLOQUEOS QUE EL SANDBOX NO PUDO RESOLVER:
    //   (a) `{value}` es un CÓDIGO DE VERIFICACIÓN propietario, NO el monto
    //       total ni el neto ni el rut receptor ni el TOKEN (todos probados →
    //       OF-10 "X es Incorrecto"). No está documentado públicamente; se
    //       confirma con soporte de Haulmer o en producción.
    //   (b) El estado SII es asíncrono y con CAF SIMULADO el sandbox NO lo
    //       resuelve a aceptado/rechazado → el shape real de `mapearEstadoSii`
    //       sigue sin observarse en vivo. Requiere ambiente de certificación.
    // PROBLEMA DE CONTRATO ADICIONAL: el puerto entrega solo `idExternoProveedor`
    // (el TOKEN), no el {rut}/{tipo}/{folio} que el GET necesita → al cablear
    // hay que persistir rut/tipo/folio + el código de verificación.
    // Ver docs/arquitectura/validacion-dte-openfactura.md (sección "Validación
    // en vivo — resultados").
    void idExternoProveedor;
    void tenantId;

    throw new ErrorDteProveedor(
      501,
      'consultarEstadoDte (Openfactura): bloqueado por el {value} de verificación ' +
        '(propietario, no documentado) y el estado SII asíncrono no observable en ' +
        'sandbox (CAF simulado) — ver docs/arquitectura/validacion-dte-openfactura.md',
    );

    // FORMA OBJETIVO una vez validado en vivo (referencia, no ejecutable):
    //   const info = await this.peticion<...>({ metodo: 'GET', ruta: `/v2/dte/document/${rut}/${tipo}/${folio}/...` });
    //   return { idExternoProveedor, estadoSii: this.mapearEstadoSii(info.estado), descripcionSii: info.glosa ?? null };
  }

  async descargarXmlDte(
    tenantId: string,
    idExternoProveedor: string,
  ): Promise<string> {
    this.exigirApiKey();
    void tenantId;
    // En Openfactura el XML se obtiene INLINE en la emisión (response: ["XML"]).
    // Si se requiere re-descarga posterior, va por el mismo GET de info que
    // `consultarEstadoDte`, que aún necesita rut/tipo/folio (ver TODO arriba).
    throw new ErrorDteProveedor(
      501,
      `descargarXmlDte (Openfactura) pendiente de validar en vivo (id: ${idExternoProveedor})`,
    );
  }

  async descargarPdfDte(
    tenantId: string,
    idExternoProveedor: string,
  ): Promise<string> {
    this.exigirApiKey();
    void tenantId;
    // Igual que el XML: el PDF llega INLINE en la emisión. Re-descarga posterior
    // por el GET de info (pendiente de validar la clave de consulta en vivo).
    throw new ErrorDteProveedor(
      501,
      `descargarPdfDte (Openfactura) pendiente de validar en vivo (id: ${idExternoProveedor})`,
    );
  }

  // -------------------------------------------------------------------------
  // Helpers privados
  // -------------------------------------------------------------------------

  /**
   * Construye el payload de emisión según el contrato verificado de Openfactura.
   * `tipoDocumento` 33 = factura, 61 = nota de crédito (agrega `Referencia`).
   */
  private construirPayloadEmision(
    entrada: EmitirFacturaEntrada,
    montos: { neto: number; iva: number; total: number; tipoDocumento: TipoDocumentoDte },
  ): OpenfacturaDocumentRequest {
    const detalle = entrada.lineas.map((linea: LineaDetalleDte, indice: number) => ({
      NroLinDet: indice + 1,
      NmbItem: linea.nombre,
      QtyItem: linea.cantidad,
      PrcItem: linea.precioUnitarioNetoCLP,
      MontoItem: linea.precioUnitarioNetoCLP * linea.cantidad - (linea.descuentoCLP ?? 0),
      ...(linea.descuentoCLP ? { DescuentoMonto: linea.descuentoCLP } : {}),
    }));

    const payload: OpenfacturaDocumentRequest = {
      response: [...FORMATOS_RESPUESTA],
      dte: {
        Encabezado: {
          IdDoc: {
            TipoDTE: montos.tipoDocumento,
            Folio: entrada.folio,
            FchEmis: entrada.fechaEmision,
          },
          Emisor: {
            RUTEmisor: entrada.rutEmisor,
            RznSoc: entrada.razonSocialEmisor,
          },
          Receptor: {
            RUTRecep: entrada.rutReceptor,
            RznSocRecep: entrada.razonSocialReceptor,
            CorreoRecep: entrada.emailReceptor,
          },
          Totales: {
            MntNeto: montos.neto,
            TasaIVA: '19.00',
            IVA: montos.iva,
            MntTotal: montos.total,
          },
        },
        Detalle: detalle,
      },
    };

    // Nota de crédito (tipo 61): referenciar el documento original.
    if (
      montos.tipoDocumento === 61 &&
      entrada.folioDocumentoReferencia !== undefined &&
      entrada.tipoDocumentoReferencia !== undefined
    ) {
      payload.dte.Referencia = [
        {
          NroLinRef: 1,
          TpoDocRef: String(entrada.tipoDocumentoReferencia),
          FolioRef: entrada.folioDocumentoReferencia,
        },
      ];
    }

    return payload;
  }

  /**
   * Lanza si no hay API key configurada. El esqueleto no debe poder llamar a la
   * API sin credencial — falla rápido y claro (sin exponer la credencial).
   *
   * Nota: no se modela como `asserts this is { apiKey: string }` porque, al ser
   * `apiKey` un campo `private`, la intersección que genera TypeScript colapsa a
   * `never`. `peticion` ya castea `this.apiKey as string` tras esta guarda.
   */
  private exigirApiKey(): void {
    if (!this.apiKey) {
      throw new ErrorDteProveedor(
        401,
        'Openfactura: falta la API key del tenant — completa el onboarding DTE del courier',
      );
    }
  }

  /**
   * Cliente HTTP de bajo nivel contra Openfactura, con backoff/reintentos
   * compartidos (`reintentarConBackoff`) y clasificación 429/5xx → reintentable.
   *
   * La API key viaja SOLO en el header `apikey` (construido en el último
   * momento). Nunca se loguea ni se incluye en errores.
   */
  private async peticion<T>(opts: {
    metodo: 'GET' | 'POST';
    ruta: string;
    cuerpoJson?: unknown;
    idempotencyKey?: string;
    /** tenantId del llamador, para poder lanzar `ErrorFolioAgotado` con el quién. */
    tenantId?: string;
  }): Promise<T> {
    return reintentarConBackoff(async () => {
      const headers: Record<string, string> = {
        accept: 'application/json',
        // Construido en el último momento; nunca asignado a variable de mayor
        // vida ni incluido en logs/errores.
        apikey: this.apiKey as string,
      };
      if (opts.cuerpoJson !== undefined) headers['content-type'] = 'application/json';
      if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

      const respuesta = await fetch(`${this.baseUrl}${opts.ruta}`, {
        method: opts.metodo,
        headers,
        body: opts.cuerpoJson !== undefined ? JSON.stringify(opts.cuerpoJson) : undefined,
      });

      if (!respuesta.ok) {
        const retryAfterMs = this.leerRetryAfterMs(respuesta.headers);
        // VERIFICADO EN VIVO: el cuerpo de error es `{error:{message,code,
        // details:[{field,issue}]}}` y NO contiene secretos (la API key viaja
        // solo en el header). Extraemos un mensaje operativo saneado para
        // diagnóstico — nunca el cuerpo crudo completo.
        const cuerpoError = await respuesta.json().catch(() => null);
        const detalle = extraerErrorOpenfactura(cuerpoError);
        throw new ErrorHttpOpenfactura(
          `Openfactura respondió ${respuesta.status} para ${opts.metodo} ${opts.ruta}`,
          respuesta.status,
          {
            retryAfterMs,
            mensajeProveedor: detalle?.mensaje,
            codigoProveedor: detalle?.codigo,
          },
        );
      }

      return (await respuesta.json()) as T;
    }).catch((error: unknown) => {
      // Traducir el error de transporte al error de dominio del puerto.
      if (error instanceof ErrorHttpOpenfactura) {
        // CAF/folios agotados → error de dominio NO reintentable (el job C3 no
        // debe reintentar; debe alertar vía C7). Heurística sobre el mensaje
        // saneado, a falta de un código dedicado de Openfactura.
        if (opts.tenantId && error.mensajeProveedor && pareceFolioAgotado(error.mensajeProveedor)) {
          throw new ErrorFolioAgotado(opts.tenantId);
        }
        // El mensaje saneado del proveedor SÍ es seguro de propagar (sin
        // credenciales ni cuerpo crudo) — ayuda al diagnóstico operativo.
        const sufijo = error.mensajeProveedor
          ? `: ${error.codigoProveedor ? `[${error.codigoProveedor}] ` : ''}${error.mensajeProveedor}`
          : ' (sin detalle del proveedor)';
        throw new ErrorDteProveedor(error.status, `Openfactura${sufijo}`);
      }
      throw error;
    });
  }

  /** Lee `Retry-After` (segundos o fecha HTTP) → ms, para respetar al proveedor. */
  private leerRetryAfterMs(headers: Headers): number | undefined {
    const valor = headers.get('retry-after');
    if (!valor) return undefined;
    const segundos = Number(valor);
    if (!Number.isNaN(segundos)) return segundos * 1000;
    const fecha = Date.parse(valor);
    if (!Number.isNaN(fecha)) return Math.max(0, fecha - Date.now());
    return undefined;
  }

  /**
   * Mapea el estado SII reportado por Openfactura al enum del puerto.
   *
   * TODO-ESTADO-SII / TODO-VALIDAR-EN-VIVO: los valores exactos del proveedor
   * NO están documentados públicamente (el modelo `InlineResponse200` del SDK
   * viene vacío). Esta tabla es una HIPÓTESIS a confirmar contra el sandbox.
   * Mientras no se valide, `consultarEstadoDte` lanza 501 en vez de adivinar.
   */
  private mapearEstadoSii(
    estadoProveedor: string,
  ): ConsultarEstadoDteResultado['estadoSii'] {
    switch (estadoProveedor.toUpperCase()) {
      // Hipótesis basada en la nomenclatura habitual del SII chileno:
      case 'ACEPTADO':
      case 'DOK': // "Documento OK"
        return 'aceptado';
      case 'ACEPTADO_CON_REPAROS':
      case 'RLV': // "Reparo leve"
        return 'aceptado_con_discrepancias';
      case 'RECHAZADO':
      case 'RCH':
        return 'rechazado';
      default:
        return 'pendiente';
    }
  }
}
