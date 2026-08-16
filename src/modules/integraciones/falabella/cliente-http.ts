/**
 * Cliente HTTP del adaptador de Falabella Seller Center.
 *
 * Sigue el molde de `../shopify/cliente-http.ts` y `../ml/cliente-http.ts`:
 * envuelve todo en `reintentarConBackoff` y lanza errores que implementan
 * `Partial<ErrorReintentable>`, de modo que la política de reintentos del
 * proyecto aplique sin que cada llamador la reimplemente. **Es privado del
 * adaptador**: la superficie pública será `./index.ts` (misma regla que en ML y
 * Shopify, ver `../README.md`).
 *
 * ── VERIFICADO CONTRA LA DOCUMENTACIÓN OFICIAL (2026-08-16) ──────────────────
 * Fuentes: https://developers.falabella.com/docs/getting-started ,
 * https://developers.falabella.com/docs/operate-with-apis y
 * https://developers.falabella.com/docs/signing-requests
 *
 * 1. **Un solo host, sin sandbox.** «Nuestro entorno apunta a la siguiente URL:
 *    https://sellercenter-api.falabella.com» y «Actualmente trabajamos en un
 *    entorno de producción. Se recomienda que para fines de prueba, siempre
 *    trabajes con productos identificados como test y de bajo valor». No hay
 *    ambiente de pruebas: **toda llamada de este cliente golpea producción real
 *    del seller**. El host es una constante y NO se lee de una variable de
 *    entorno a propósito: un `FALABELLA_API_URL` mal puesto mandaría solicitudes
 *    firmadas (con el `UserID` del seller) a un host ajeno.
 *    ⚠️ `sellercenter-api.linio.cl` (el host chileno que aún aparece en SDKs
 *    heredados de Linio) está MUERTO: resuelve a 127.0.0.0. Y
 *    `sellercenter-staging.linio.cl` es NXDOMAIN. No usarlos.
 *
 * 2. **Todo va en la query string, firmado.** Los parámetros comunes
 *    obligatorios son `Action`, `Timestamp`, `UserID`, `Version` y `Signature`;
 *    `Format` es opcional (por defecto XML) y aquí se fuerza a `JSON`. Las
 *    acciones de escritura (`ProductUpdate`, `SetStatusToPackedByMarketplace`,
 *    …) son POST y llevan un **cuerpo aparte** con su payload propio — ver
 *    §«Datos adicionales en POST» de la doc, cuyo ejemplo manda un `<Request>`
 *    en el body mientras los comunes siguen en la URL. Ese cuerpo NO se firma.
 *
 * 3. **Header `User-Agent` obligatorio**, con formato impuesto:
 *    `SELLER_ID/TECNOLOGÍA/VERSIÓN_TECNOLOGÍA/TIPO_INTEGRACIÓN/CÓDIGO_UNIDAD_DE_NEGOCIO`.
 *    Para Chile el código de unidad de negocio es `FACL` (Colombia `FACO`, Perú
 *    `FAPE`). Como Rutax conecta varios negocios, el tipo de integración es el
 *    nombre del integrador, no `PROPIA`. Ver `construirUserAgent`.
 *
 * 4. **El sobre de respuesta es `SuccessResponse` / `ErrorResponse`**, con
 *    `Head` + `Body` en ambos casos. El `Head` de una respuesta exitosa trae
 *    `TotalCount` cuando la acción pagina (p. ej. `GetOrders`), así que este
 *    cliente devuelve `head` y `body`, no solo el body.
 *
 * 5. **El error puede venir con HTTP 200** — misma trampa que en Shopify. La
 *    documentación define un catálogo de códigos de error *de aplicación*
 *    (`E001`…`E429`, `E1000`) que viajan dentro de `ErrorResponse`, y en ningún
 *    lado dice con qué código HTTP se devuelven. Por eso este cliente **mira el
 *    cuerpo siempre**, gane o pierda el `respuesta.ok`: si hay `ErrorResponse`,
 *    es un fallo, y punto. (Ver «Lo que NO se pudo verificar» al final.)
 *
 * 6. **La API Key es secreto de pleno derecho** (es la clave de firma) y no
 *    aparece en ninguna URL, header, log ni objeto de error: solo entra a
 *    `firma.ts`. El `UserID` NO es secreto — es el correo del usuario de Seller
 *    Center y viaja en cada query string — así que sí puede figurar en un error
 *    para poder diagnosticar de qué conexión se trata.
 *
 * ── LO QUE NO SE PUDO VERIFICAR (y cómo se decidió mientras tanto) ───────────
 * - **Código HTTP de un `ErrorResponse`**: la doc no lo dice y no hay sandbox
 *   donde provocarlo. Decisión: tratar el sobre como autoritativo
 *   independientemente del status. Es seguro en las dos direcciones.
 * - **Forma exacta del sobre en JSON**: la doc promete «puedes ver ambos
 *   ejemplos a continuación» y solo publica el XML. Se asume que las claves JSON
 *   son las mismas del XML (`SuccessResponse`, `ErrorResponse`, `Head`, `Body`).
 *   Si no lo fueran, el cliente lanza un error explícito que lista las claves de
 *   primer nivel recibidas (sin valores, para no volcar datos del destinatario).
 * - **Límite de tasa**: la doc publica el código `E429: Too many requests` pero
 *   NO la cuota. No se hardcodea ningún número (misma regla que en ML): se
 *   respeta `Retry-After` si viene y, si no, backoff con jitter.
 */

import {
  reintentarConBackoff,
  type ErrorReintentable,
  type OpcionesReintento,
} from "../resiliencia";
import {
  construirQueryFirmada,
  timestampFalabella,
  VERSION_API_FALABELLA,
  type ParametrosFalabella,
} from "./firma";

/**
 * Único host de la API. Constante deliberada, no configurable — ver punto 1 de
 * la cabecera.
 */
export const FALABELLA_API_URL = "https://sellercenter-api.falabella.com/";

/** Código de unidad de negocio del header `User-Agent`. Chile. */
export const UNIDAD_NEGOCIO_CHILE = "FACL";

/**
 * Nombre del integrador en el header `User-Agent`. Rutax conecta múltiples
 * negocios, así que corresponde el nombre del integrador y no `PROPIA`.
 */
export const TIPO_INTEGRACION_RUTAX = "RUTAX";

/**
 * Códigos de error globales del catálogo oficial que este cliente interpreta.
 * (La lista completa está en la doc, §«Errores Globales».)
 */
export const CODIGO_ERROR_FALABELLA = {
  /** E003: Timestamp has expired — reloj desfasado o solicitud muy demorada. */
  TIMESTAMP_EXPIRADO: 3,
  /** E004: Invalid Timestamp format. */
  TIMESTAMP_INVALIDO: 4,
  /** E006: Unexpected internal error — del lado de ellos, transitorio. */
  ERROR_INTERNO: 6,
  /** E007: Login failed. Signature mismatching — credencial o firma mala. */
  FIRMA_INVALIDA: 7,
  /** E009: Access Denied — el usuario no tiene el rol para esta acción. */
  ACCESO_DENEGADO: 9,
  /** E429: Too many requests. */
  DEMASIADAS_SOLICITUDES: 429,
  /** E1000: Internal Application Error. */
  ERROR_APLICACION: 1000,
} as const;

/**
 * Códigos que ameritan reintento: el límite de tasa y los dos errores internos
 * del proveedor. Todo lo demás (firma mala, acceso denegado, parámetro
 * faltante) da idéntico por más veces que se pregunte, y reintentar solo quema
 * cuota.
 *
 * `TIMESTAMP_EXPIRADO` queda FUERA a propósito aunque cada intento genere un
 * `Timestamp` nuevo: su causa típica es un reloj desfasado, que no se arregla
 * insistiendo. Si aparece, es trabajo de `devops` (NTP), no del backoff.
 */
const CODIGOS_REINTENTABLES: readonly number[] = [
  CODIGO_ERROR_FALABELLA.DEMASIADAS_SOLICITUDES,
  CODIGO_ERROR_FALABELLA.ERROR_INTERNO,
  CODIGO_ERROR_FALABELLA.ERROR_APLICACION,
];

/**
 * Códigos que significan «esta conexión no se arregla sola: el seller tiene que
 * re-vincular o corregir permisos». Distinguirlos del resto es lo que después
 * permite que la salud de conexión diga «lo resolví» vs. «requiere acción del
 * seller», en vez de un genérico "desvinculada".
 */
const CODIGOS_CREDENCIAL: readonly number[] = [
  CODIGO_ERROR_FALABELLA.FIRMA_INVALIDA,
  CODIGO_ERROR_FALABELLA.ACCESO_DENEGADO,
];

/** Fallo de transporte: la respuesta ni siquiera trae un sobre interpretable. */
export class ErrorHttpFalabella extends Error implements Partial<ErrorReintentable> {
  readonly status: number;
  readonly reintentable?: true;
  readonly retryAfterMs?: number;
  /** Cuerpo crudo recortado. Nunca contiene la API Key: no viaja en la petición. */
  readonly cuerpo: unknown;

  constructor(mensaje: string, status: number, cuerpo: unknown, retryAfterMs?: number) {
    super(mensaje);
    this.name = "ErrorHttpFalabella";
    this.status = status;
    this.cuerpo = cuerpo;

    // 429 y 5xx son transitorios; el resto de los 4xx son definitivos. Mismo
    // criterio que `ErrorHttpMl` y `ErrorHttpShopify`.
    if (status === 429 || status >= 500) {
      this.reintentable = true;
      if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
    }
  }
}

/**
 * La solicitud llegó a Falabella y Falabella la rechazó: sobre `ErrorResponse`.
 * Puede venir con HTTP 200 (ver punto 5 de la cabecera).
 */
export class ErrorRespuestaFalabella extends Error implements Partial<ErrorReintentable> {
  readonly reintentable?: true;
  readonly retryAfterMs?: number;
  readonly status: number;
  /** `ErrorCode` del catálogo oficial; `null` si el sobre vino sin él. */
  readonly codigo: number | null;
  /** `ErrorType`: `Sender` (culpa nuestra) o `Platform` (culpa de ellos). */
  readonly tipo: string | null;
  readonly accion: string | null;

  constructor(entrada: {
    mensaje: string;
    status: number;
    codigo: number | null;
    tipo: string | null;
    accion: string | null;
    retryAfterMs?: number;
  }) {
    super(entrada.mensaje);
    this.name = "ErrorRespuestaFalabella";
    this.status = entrada.status;
    this.codigo = entrada.codigo;
    this.tipo = entrada.tipo;
    this.accion = entrada.accion;

    const porCodigo = entrada.codigo !== null && CODIGOS_REINTENTABLES.includes(entrada.codigo);
    // `Platform` es, por definición del propio catálogo, «origen del error: la
    // plataforma». Un fallo de su lado sí puede resolverse solo.
    const porTipo = entrada.tipo === "Platform";
    const porTransporte = entrada.status === 429 || entrada.status >= 500;

    if (porCodigo || porTipo || porTransporte) {
      this.reintentable = true;
      if (entrada.retryAfterMs !== undefined) this.retryAfterMs = entrada.retryAfterMs;
    }
  }
}

/**
 * La petición no llegó a salir o se cortó a mitad de camino (DNS, TLS, socket
 * cerrado, timeout del runtime). `fetch` lanza un `TypeError` pelado, que NO
 * está marcado como reintentable y por lo tanto aborta el intento entero.
 *
 * ⚠️ Divergencia consciente respecto de `../ml` y `../shopify`: allá una caída
 * de red tumba la llamada sin reintentar. Aquí no, y la razón es propia de este
 * proveedor — no hay sandbox, la ingesta corre contra producción del seller, y
 * un socket cortado es exactamente el caso que el backoff existe para absorber.
 * Que los otros dos adaptadores tengan el mismo hueco es una deuda a revisar
 * aparte, no un motivo para repetirlo aquí.
 */
export class ErrorRedFalabella extends Error implements ErrorReintentable {
  readonly reintentable = true;

  constructor(action: string, causa: unknown) {
    super(`No se pudo alcanzar Falabella para ${action}: ${(causa as Error)?.message ?? causa}`);
    this.name = "ErrorRedFalabella";
    this.cause = causa;
  }
}

/**
 * ¿El fallo significa «la credencial de este seller ya no sirve»? Es la pregunta
 * que separa «lo resolví reintentando» de «hay que pedirle al seller que
 * re-vincule», y la respuesta no puede quedar diluida en un error genérico.
 */
export function esCredencialInvalida(error: unknown): boolean {
  if (error instanceof ErrorRespuestaFalabella) {
    return error.codigo !== null && CODIGOS_CREDENCIAL.includes(error.codigo);
  }
  if (error instanceof ErrorHttpFalabella) {
    return error.status === 401 || error.status === 403;
  }
  return false;
}

/** `Head` del sobre. En JSON los valores llegan como string (lo dice la doc). */
export interface CabeceraFalabella {
  RequestId?: string;
  RequestAction?: string;
  ResponseType?: string;
  Timestamp?: string;
  /** Solo en acciones que paginan (`GetOrders`). Clave para no truncar la ingesta. */
  TotalCount?: string | number;
}

export interface RespuestaFalabella<T> {
  head: CabeceraFalabella;
  body: T;
}

/**
 * Construye el `User-Agent` obligatorio.
 *
 * Formato exigido:
 * `SELLER_ID/TECNOLOGÍA_USADA/VERSIÓN_TECNOLOGÍA/TIPO_INTEGRACIÓN/CÓDIGO_UNIDAD_DE_NEGOCIO`.
 *
 * El `sellerId` viene de datos del seller, así que se sanea: un `/` o un salto
 * de línea metidos ahí romperían el formato o, peor, inyectarían un header.
 */
export function construirUserAgent(entrada: {
  sellerId: string;
  tipoIntegracion?: string;
  unidadNegocio?: string;
  versionNode?: string;
}): string {
  const sellerId = entrada.sellerId.replace(/[^A-Za-z0-9_-]/g, "") || "DESCONOCIDO";
  const tipo = entrada.tipoIntegracion ?? TIPO_INTEGRACION_RUTAX;
  const unidad = entrada.unidadNegocio ?? UNIDAD_NEGOCIO_CHILE;
  const version = entrada.versionNode ?? process.versions?.node ?? "0";
  return `${sellerId}/Node/${version}/${tipo}/${unidad}`;
}

function leerRetryAfterMs(headers: Headers): number | undefined {
  const valor = headers.get("retry-after");
  if (!valor) return undefined;
  const segundos = Number(valor);
  if (!Number.isNaN(segundos)) return segundos * 1000;
  const fecha = Date.parse(valor);
  if (!Number.isNaN(fecha)) return Math.max(0, fecha - Date.now());
  return undefined;
}

async function leerCuerpoSeguro(respuesta: Response): Promise<{ texto: string; json: unknown }> {
  let texto = "";
  try {
    texto = await respuesta.text();
  } catch {
    return { texto: "", json: null };
  }
  try {
    return { texto, json: JSON.parse(texto) as unknown };
  } catch {
    // Un cuerpo no-JSON con `Format=JSON` es una página de error de
    // infraestructura (WAF, balanceador). Se recorta para no volcar HTML entero
    // al log de un job.
    return { texto: texto.slice(0, 500), json: null };
  }
}

function aNumero(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "") {
    const n = Number(valor);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function aTexto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

export interface PeticionFalabella {
  /** Nombre de la acción (`GetOrders`, `SetStatusToReadyToShip`, …). */
  action: string;
  /** Correo del usuario de Seller Center. NO es secreto: viaja en la URL. */
  userId: string;
  /** Clave de firma. SECRETO: solo entra al HMAC, nunca a un log ni a la URL. */
  apiKey: string;
  /** Id de vendedor, para el header `User-Agent` obligatorio. */
  sellerId: string;
  /** Parámetros propios de la acción (`CreatedAfter`, `Limit`, `Offset`, …). */
  parametros?: ParametrosFalabella;
  /**
   * Por defecto GET. Las acciones de escritura son POST según su ficha en la doc.
   *
   * ⚠️ **Pendiente para cuando llegue la primera escritura**: hoy el backoff
   * reintenta igual un GET que un POST, y ante un 5xx no se puede saber si la
   * acción alcanzó a aplicarse. Para `SetStatusToReadyToShip` da lo mismo (es
   * idempotente por estado destino: la segunda vez responde `E073`), pero para
   * algo como `Crear Solicitud de Recolección` un reintento podría duplicar el
   * efecto. Esa decisión —no reintentar POST ante 5xx, o exigir una clave de
   * idempotencia propia— se toma al construir la acción de escritura, con la
   * ficha de esa acción en la mano. No se adivina desde aquí.
   */
  metodo?: "GET" | "POST";
  /**
   * Cuerpo de una acción de escritura. NO se firma: la firma cubre solo la query
   * string (ver §«Datos adicionales en POST» de la doc).
   */
  cuerpo?: { contenido: string; contentType: string };
  /** Inyectable para pruebas. Se invoca en CADA intento — ver nota abajo. */
  ahora?: () => Date;
  unidadNegocio?: string;
  tipoIntegracion?: string;
  opcionesReintento?: OpcionesReintento;
}

/**
 * Ejecuta una acción de la API con reintentos ya aplicados.
 *
 * **El `Timestamp` y la firma se construyen DENTRO del closure de reintento**,
 * no fuera. Es deliberado: la API rechaza marcas de tiempo viejas con
 * `E003: Timestamp has expired`, y un backoff puede esperar decenas de
 * segundos. Firmar una vez y reenviar la misma cadena convertiría un 429
 * transitorio en un E003 permanente al tercer intento.
 */
export async function peticionFalabella<T>(
  peticion: PeticionFalabella,
): Promise<RespuestaFalabella<T>> {
  const relojear = peticion.ahora ?? (() => new Date());
  const userAgent = construirUserAgent({
    sellerId: peticion.sellerId,
    tipoIntegracion: peticion.tipoIntegracion,
    unidadNegocio: peticion.unidadNegocio,
  });

  return reintentarConBackoff(async () => {
    const parametros: ParametrosFalabella = {
      ...peticion.parametros,
      Action: peticion.action,
      Format: "JSON",
      Timestamp: timestampFalabella(relojear()),
      UserID: peticion.userId,
      Version: VERSION_API_FALABELLA,
    };

    const url = `${FALABELLA_API_URL}?${construirQueryFirmada(parametros, peticion.apiKey)}`;

    const cabeceras: Record<string, string> = {
      accept: "application/json",
      "user-agent": userAgent,
    };
    if (peticion.cuerpo) cabeceras["content-type"] = peticion.cuerpo.contentType;

    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        method: peticion.metodo ?? "GET",
        headers: cabeceras,
        body: peticion.cuerpo?.contenido,
      });
    } catch (causa) {
      // La URL lleva la firma; el mensaje del error de red NO la repite.
      throw new ErrorRedFalabella(peticion.action, causa);
    }

    const { texto, json } = await leerCuerpoSeguro(respuesta);
    const retryAfterMs = leerRetryAfterMs(respuesta.headers);
    const sobre = esObjeto(json) ? json : null;

    // [TRAMPA] El sobre manda sobre el código HTTP: un `ErrorResponse` es un
    // fallo aunque venga con 200, y explica el problema mejor que el status.
    const error = sobre && esObjeto(sobre.ErrorResponse) ? sobre.ErrorResponse : null;
    if (error) {
      const head = esObjeto(error.Head) ? error.Head : {};
      const codigo = aNumero(head.ErrorCode);
      const mensajeProveedor = aTexto(head.ErrorMessage) ?? "sin mensaje";
      throw new ErrorRespuestaFalabella({
        mensaje: `Falabella rechazó ${peticion.action} para el usuario ${peticion.userId}: ${mensajeProveedor}`,
        status: respuesta.status,
        codigo,
        tipo: aTexto(head.ErrorType),
        accion: aTexto(head.RequestAction),
        retryAfterMs,
      });
    }

    if (!respuesta.ok) {
      throw new ErrorHttpFalabella(
        `Falabella respondió ${respuesta.status} a ${peticion.action}`,
        respuesta.status,
        json ?? texto,
        retryAfterMs,
      );
    }

    const exito = sobre && esObjeto(sobre.SuccessResponse) ? sobre.SuccessResponse : null;
    if (!exito) {
      // Ni `SuccessResponse` ni `ErrorResponse`: la forma del sobre cambió o
      // respondió otra cosa. Se listan las CLAVES, nunca los valores — el cuerpo
      // de `GetOrders` trae nombre y dirección del destinatario.
      const claves = sobre ? Object.keys(sobre).join(", ") : "(cuerpo no-JSON)";
      throw new ErrorHttpFalabella(
        `Falabella respondió 200 sin sobre reconocible en ${peticion.action}. Claves de primer nivel: ${claves}`,
        respuesta.status,
        null,
      );
    }

    return {
      head: (esObjeto(exito.Head) ? exito.Head : {}) as CabeceraFalabella,
      body: exito.Body as T,
    };
  }, peticion.opcionesReintento);
}
