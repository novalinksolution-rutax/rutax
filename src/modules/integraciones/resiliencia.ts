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
