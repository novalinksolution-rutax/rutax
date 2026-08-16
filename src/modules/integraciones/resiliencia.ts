/**
 * Utilidades de resiliencia compartidas por los adaptadores de `integraciones`.
 *
 * La skill `flex-ml` (y, en general, cualquier integración externa de este
 * proyecto) exige: reintentos con backoff ante límites de tasa/caídas
 * transitorias, e idempotencia para no duplicar efectos ante reintentos o
 * eventos repetidos (webhooks + sondeo de respaldo). Vive aquí — no en el
 * adaptador de ML — porque el adaptador DTE (próxima iteración) la necesitará
 * igual.
 *
 * ⚠️ QUÉ SE REINTENTA, EXACTAMENTE. Solo los errores marcados con
 * `reintentable: true` (ver `ErrorReintentable`). Eso cubre dos familias, y la
 * segunda hay que producirla a mano:
 *
 *   1. **Respuestas del proveedor** — 429 y 5xx. Cada adaptador marca su propio
 *      `ErrorHttp*` al construirlo.
 *   2. **Fallos de transporte** — DNS, TLS, socket cerrado, host inalcanzable.
 *      `fetch` los lanza como un `TypeError` PELADO, sin la marca, así que NO se
 *      reintentan solos. Hay que envolverlos con `ejecutarPeticionDeRed` en el
 *      punto de la llamada. Hasta el 2026-08-16 este docstring prometía que los
 *      fallos de red se reintentaban y era falso: los adaptadores de ML y
 *      Shopify se rendían al primer corte de red.
 *
 * Lo que NO se reintenta, a propósito: 401, 403, 404 y demás 4xx. Reintentar un
 * problema de autorización solo quema cuota sin cambiar el resultado.
 *
 * Sin dependencias nuevas: usa solo `Promise`/`setTimeout`.
 */

export interface OpcionesReintento {
  /** Número máximo de intentos totales (incluido el primero). Default 4. */
  maxIntentos?: number;
  /** Espera base en ms antes del primer reintento. Default 500ms. */
  esperaBaseMs?: number;
  /** Tope superior de espera entre reintentos, evita backoff sin límite. Default 30s. */
  esperaMaximaMs?: number;
  /**
   * Decide si un error amerita reintento. Por default, reintenta errores
   * marcados como `reintentable` (ver `EsErrorReintentable`) — p. ej. 429/5xx
   * y fallos de red — y NO reintenta errores 4xx de validación/autorización
   * (reintentar un 401/403 sin resolver la causa solo quema cuota).
   */
  debeReintentar?: (error: unknown, intento: number) => boolean;
  /**
   * Hook de espera inyectable — permite a las pruebas avanzar el tiempo sin
   * esperar de verdad. Por default, `setTimeout` real.
   */
  dormir?: (ms: number) => Promise<void>;
  /**
   * Observador opcional invocado antes de cada reintento — para bitácora o
   * métricas. NUNCA debe recibir datos sensibles (el llamador es responsable
   * de no incluir tokens/credenciales en los argumentos que produce el error).
   */
  alReintentar?: (info: { intento: number; esperaMs: number; error: unknown }) => void;
}

const ESPERA_BASE_DEFAULT_MS = 500;
const ESPERA_MAXIMA_DEFAULT_MS = 30_000;
const MAX_INTENTOS_DEFAULT = 4;

function dormirReal(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Marca de interfaz que los adaptadores usan para indicar "este error es
 * transitorio, vale la pena reintentar" (p. ej. HTTP 429/5xx, timeouts,
 * errores de red). `reintentarConBackoff` la respeta por default.
 */
export interface ErrorReintentable {
  reintentable: true;
  /**
   * Si el proveedor indicó cuánto esperar (p. ej. header `Retry-After` de ML
   * ante 429), regístralo aquí en milisegundos — se usa en vez del backoff
   * calculado cuando está presente, para respetar al proveedor exactamente.
   */
  retryAfterMs?: number;
}

export function esErrorReintentable(error: unknown): error is Error & ErrorReintentable {
  return (
    typeof error === "object" &&
    error !== null &&
    "reintentable" in error &&
    (error as { reintentable?: unknown }).reintentable === true
  );
}

// =============================================================================
// Fallos de transporte — la petición no llegó a salir, o se cortó en el camino
// =============================================================================

/**
 * La petición no alcanzó al proveedor: DNS, TLS, socket cerrado, host caído.
 *
 * Es reintentable por definición — no hay nada del lado del proveedor que haya
 * dicho que no, solo un camino que se cortó. Es exactamente el caso para el que
 * existe el backoff.
 */
export class ErrorRedIntegracion extends Error implements ErrorReintentable {
  readonly reintentable = true;
  /** Nombre del proveedor, para que el log diga a quién no se pudo alcanzar. */
  readonly proveedor: string;

  constructor(proveedor: string, contexto: string, causa: unknown) {
    const detalle = causa instanceof Error ? causa.message : String(causa);
    super(`No se pudo alcanzar ${proveedor} (${contexto}): ${detalle}`);
    this.name = "ErrorRedIntegracion";
    this.proveedor = proveedor;
    this.cause = causa;
  }
}

/**
 * Códigos de error de sistema y de undici que significan "el camino falló".
 *
 * Se enumeran en vez de aceptar cualquier `TypeError` porque un `TypeError`
 * también sale de un bug propio —llamar algo que es `undefined`, por ejemplo—, y
 * reintentar cuatro veces un bug de programación esconde el bug y gasta tiempo.
 */
const CODIGOS_FALLO_TRANSPORTE = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EHOSTDOWN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function leerCodigo(valor: unknown): string | null {
  if (typeof valor !== "object" || valor === null) return null;
  const codigo = (valor as { code?: unknown }).code;
  return typeof codigo === "string" ? codigo : null;
}

/**
 * ¿Este error es un fallo de transporte, y no otra cosa?
 *
 * Primero por código de sistema —el dato duro, que `fetch` deja en `cause`— y
 * solo si no hay código, por el mensaje: undici dice `fetch failed`, el
 * navegador dice `Failed to fetch`.
 *
 * ⚠️ Una URL mal construida se descarta explícitamente. `fetch` la reporta
 * también como `TypeError`, pero una URL inválida sigue inválida al cuarto
 * intento: es un error de programación disfrazado de fallo de red.
 */
export function esFalloDeTransporte(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (/parse url|invalid url/i.test(error.message)) return false;

  const codigo = leerCodigo(error) ?? leerCodigo((error as { cause?: unknown }).cause);
  if (codigo) return CODIGOS_FALLO_TRANSPORTE.has(codigo);

  return error instanceof TypeError && /fetch failed|failed to fetch/i.test(error.message);
}

/**
 * Envuelve la llamada de red de un adaptador para que un corte de transporte
 * quede marcado como reintentable.
 *
 * Recibe un thunk y no una URL a propósito: cada adaptador arma su petición como
 * le corresponde —cabeceras, firma, cuerpo— y lo único que se comparte es la
 * clasificación del fallo. Y se envuelve **solo el `fetch`**, no el manejo de la
 * respuesta: así un error de nuestro propio código al leer el cuerpo nunca se
 * confunde con la red.
 *
 * Lo que NO es fallo de transporte se relanza intacto.
 *
 * ⚠️ Un `AbortError` no entra acá. Hoy ningún cliente pasa `signal`, así que no
 * se da; cuando alguno ponga timeout propio habrá que decidirlo a conciencia,
 * porque un abort por timeout sí conviene reintentar y un abort por cancelación
 * del job no — reintentarlo sería pasar por encima de quien decidió parar.
 */
export async function ejecutarPeticionDeRed(
  proveedor: string,
  contexto: string,
  ejecutar: () => Promise<Response>,
): Promise<Response> {
  try {
    return await ejecutar();
  } catch (causa) {
    if (!esFalloDeTransporte(causa)) throw causa;
    throw new ErrorRedIntegracion(proveedor, contexto, causa);
  }
}

/**
 * Backoff exponencial con jitter completo (full jitter — recomendado por AWS
 * Architecture Blog para evitar el efecto "estampida" de reintentos
 * sincronizados entre múltiples instancias): `random(0, min(cap, base * 2^intento))`.
 */
export function calcularEsperaBackoff(
  intento: number,
  esperaBaseMs: number,
  esperaMaximaMs: number,
): number {
  const exponencial = esperaBaseMs * 2 ** intento;
  const tope = Math.min(esperaMaximaMs, exponencial);
  return Math.floor(Math.random() * tope);
}

/**
 * Ejecuta `accion` con reintentos y backoff exponencial + jitter. Por default
 * solo reintenta errores marcados explícitamente como reintentables — así
 * evitamos quemar el límite de tasa de ML reintentando errores de
 * autorización/validación que no se resuelven solos.
 */
export async function reintentarConBackoff<T>(
  accion: (intento: number) => Promise<T>,
  opciones: OpcionesReintento = {},
): Promise<T> {
  const maxIntentos = opciones.maxIntentos ?? MAX_INTENTOS_DEFAULT;
  const esperaBaseMs = opciones.esperaBaseMs ?? ESPERA_BASE_DEFAULT_MS;
  const esperaMaximaMs = opciones.esperaMaximaMs ?? ESPERA_MAXIMA_DEFAULT_MS;
  const dormir = opciones.dormir ?? dormirReal;
  const debeReintentar = opciones.debeReintentar ?? ((error) => esErrorReintentable(error));

  let ultimoError: unknown;

  for (let intento = 0; intento < maxIntentos; intento += 1) {
    try {
      return await accion(intento);
    } catch (error) {
      ultimoError = error;

      const esUltimoIntento = intento === maxIntentos - 1;
      if (esUltimoIntento || !debeReintentar(error, intento)) {
        throw error;
      }

      const retryAfterMs = esErrorReintentable(error) ? error.retryAfterMs : undefined;
      const esperaMs = retryAfterMs ?? calcularEsperaBackoff(intento, esperaBaseMs, esperaMaximaMs);

      opciones.alReintentar?.({ intento: intento + 1, esperaMs, error });
      await dormir(esperaMs);
    }
  }

  // Inalcanzable en la práctica (el for siempre retorna o lanza), pero TS
  // necesita una salida — y preferimos un error explícito a `undefined as T`.
  throw ultimoError ?? new Error("reintentarConBackoff: se agotaron los intentos sin error capturado");
}

/**
 * Caché de idempotencia en memoria con TTL — evita reprocesar el mismo
 * "evento" (p. ej. notificación de webhook + el mismo hallazgo vía sondeo de
 * respaldo) dentro de una ventana de tiempo.
 *
 * DELIBERADAMENTE simple (Map + TTL): no introduce infraestructura nueva
 * (coherente con "NO microservicios ni colas propias"). La idempotencia
 * "dura" (a través de reinicios/instancias) la garantiza el propio modelo de
 * datos — p. ej. una columna `unique` o un `upsert` por `ml_shipment_id` en
 * el job de ingesta de Fase B — esta caché solo evita trabajo redundante
 * dentro de una misma ejecución/corta ventana.
 */
export class CacheIdempotencia {
  private readonly vistos = new Map<string, number>();

  constructor(private readonly ttlMs: number = 5 * 60_000) {}

  /**
   * Devuelve `true` la primera vez que ve `clave` (y la registra); `false`
   * en llamadas subsecuentes dentro del TTL. Uso típico:
   *
   * ```ts
   * if (!cache.marcarSiEsNuevo(`ml:webhook:${notificacion.id}`)) return; // ya procesado
   * ```
   */
  marcarSiEsNuevo(clave: string): boolean {
    this.purgarExpirados();

    if (this.vistos.has(clave)) return false;

    this.vistos.set(clave, Date.now());
    return true;
  }

  private purgarExpirados(): void {
    const ahora = Date.now();
    for (const [clave, marcaTiempo] of this.vistos) {
      if (ahora - marcaTiempo > this.ttlMs) {
        this.vistos.delete(clave);
      }
    }
  }

  /** Solo para pruebas/diagnóstico — no usar en lógica de negocio. */
  get tamano(): number {
    return this.vistos.size;
  }
}
