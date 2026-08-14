/**
 * resolverCoordenadaConCache — helper compartido de geocoding con caché global.
 * =====================================================================
 *
 * Extraído de `jobs/geocodificar-pedido.ts` (su antiguo "Paso 2") para que
 * DOS llamadores compartan una sola implementación:
 *
 *   - `jobs/geocodificar-pedido.ts` — evento `operacion/pedido.ingestado`,
 *     dentro de un `step.run` de Inngest con `retries: 3`. Llama SIN
 *     `timeoutMs`: ya está protegido por los reintentos del job y no hay un
 *     humano esperando la respuesta HTTP. Este helper preserva ese
 *     comportamiento exacto cuando `timeoutMs` no se pasa.
 *   - Server Actions de bodegas (etapas 2/2b de retiro-y-ruteo,
 *     `identidad.seller_bodegas` / `identidad.courier_bodegas` — ver
 *     `supabase/migrations/20260813000002_identidad_bodegas_seller_courier.sql`).
 *     Estas SÍ tienen un humano esperando el request: deben pasar
 *     `timeoutMs` (usa `TIMEOUT_GEOCODING_SINCRONO_MS` salvo que tengan una
 *     razón propia para otro valor).
 *
 * POR QUÉ VIVE AQUÍ (`integraciones`) Y NO EN `operacion`: el caché
 * (`integraciones.geocoding_cache`) es GLOBAL — sin `tenant_id`, FORCE RLS sin
 * políticas para `authenticated`/`anon`, solo `service_role` puede leerlo o
 * escribirlo (migración `20260613000003`). Y `src/lib/supabase/service-role.ts`
 * documenta explícitamente que SOLO `src/modules/integraciones/**` y jobs de
 * servidor pueden importarlo — nunca código que sirva un request de usuario
 * directamente (`app/**`). Este helper es, a propósito, el ÚNICO punto por el
 * que una Server Action de bodegas puede alcanzar ese caché: nunca importa
 * `service-role.ts` ella misma.
 *
 * No sabe nada de pedidos, bodegas, tenants ni ningún concepto de `operacion`
 * o `identidad` — solo traduce dirección+comuna a coordenada. El caché es
 * GLOBAL: dos llamadores geocodificando la misma dirección+comuna (un pedido
 * y una bodega, o dos bodegas de sellers distintos) comparten el mismo HIT.
 *
 * IDEMPOTENCIA / RESILIENCIA: no las resuelve este helper — las resuelve cada
 * llamador según su contexto. El job es idempotente por el `geo_estado` del
 * pedido (Paso 1, fuera de este helper) y reintenta vía Inngest; una Server
 * Action síncrona reintenta si el humano vuelve a intentar la acción.
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { obtenerPuertoGeocoding, type PuertoGeocoding } from './puerto';
import { calcularClaveHash, resolverComunaCanonica } from './normalizacion';
import type { EstadoGeocoding, ProveedorGeocoding, ResultadoGeocoding } from './tipos';

// ---------------------------------------------------------------------------
// Inyección de dependencia del puerto (para tests sin red).
//
// Vivía en `jobs/geocodificar-pedido.ts`; se traslada aquí para que un solo
// interruptor sirva a TODOS los llamadores (el job y, en adelante, las Server
// Actions de bodegas). El job re-exporta estas dos funciones con el MISMO
// nombre para no romper sus tests existentes.
// ---------------------------------------------------------------------------

/** Fábrica del puerto, sobrescribible en tests. */
let obtenerPuertoActual: () => PuertoGeocoding = obtenerPuertoGeocoding;

/** Solo para tests: inyecta un puerto de geocoding doble. */
export function setPuertoGeocoding(fn: () => PuertoGeocoding): void {
  obtenerPuertoActual = fn;
}

/** Restaura la fábrica real del puerto. */
export function resetPuertoGeocoding(): void {
  obtenerPuertoActual = obtenerPuertoGeocoding;
}

// ---------------------------------------------------------------------------
// Timeout del camino síncrono
// ---------------------------------------------------------------------------

/**
 * Techo de tiempo (ms) sugerido para llamadores SÍNCRONOS (Server Actions con
 * un humano esperando el request). El job de Inngest NO lo usa.
 *
 * 8 s: mismo valor que ya usa el repo para el otro caso de "fetch síncrono con
 * humano esperando" (`notificaciones/email/adaptadores/resend.ts:26`). Da
 * margen bajo el timeout de función serverless más ajustado (Vercel Hobby:
 * 10 s) y queda muy por encima de la latencia típica de Google Geocoding
 * (cientos de ms).
 */
export const TIMEOUT_GEOCODING_SINCRONO_MS = 8_000;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Fila de `integraciones.geocoding_cache` tal como Postgres la devuelve. */
interface FilaCache {
  lat: number | null;
  long: number | null;
  geo_estado: EstadoGeocoding;
  confianza: number | null;
  proveedor: ProveedorGeocoding;
  comuna_norm: string;
}

/**
 * Logger mínimo, inyectable y opcional. Deliberadamente genérico (no el tipo
 * de `logger` de Inngest): este módulo no depende de `operacion` ni de la
 * forma del `step`/`logger` de un job — cualquier llamador (job o Server
 * Action) puede pasar el suyo, o ninguno.
 */
export interface LoggerLigero {
  info: (mensaje: string) => void;
}

export interface ArgsResolverCoordenadaConCache {
  /** Dirección de calle (sin normalizar; este helper la normaliza). */
  direccion: string;
  /** Comuna declarada (sin normalizar). */
  comuna: string;
  /**
   * Techo de tiempo (ms) para la llamada al proveedor en un MISS de caché.
   * `undefined` (default) = SIN límite — comportamiento histórico del job.
   * Los llamadores síncronos deben pasar `TIMEOUT_GEOCODING_SINCRONO_MS` (o
   * un valor propio).
   */
  timeoutMs?: number;
  /** Logger opcional, best-effort. Solo se usa para señalizar un cache HIT. */
  logger?: LoggerLigero;
  /**
   * Ignora el caché y consulta al proveedor sí o sí (el resultado se escribe
   * igual, pisando la entrada anterior).
   *
   * Existe porque el caché guarda TAMBIÉN los `no_resuelto`, y eso es correcto
   * para el camino automático —evita repetir llamadas facturables por una
   * dirección que el proveedor ya dijo no conocer— pero convierte cualquier
   * botón de "reintentar" en un adorno: lee el fallo cacheado y no vuelve a
   * preguntar nunca. Mordió en producción el 2026-08-13: una bodega quedó en
   * "Dirección no ubicada", cada reintento devolvía lo mismo al instante, y no
   * había ni excepción ni log porque el proveedor no se llegaba a llamar.
   *
   * Úsalo SOLO cuando un humano pide explícitamente reintentar. Nunca en un
   * job masivo: ahí saltarse el caché multiplica el costo sin ganar nada.
   */
  forzarConsulta?: boolean;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Resuelve `direccion + comuna` a coordenadas pasando primero por el caché
 * GLOBAL `integraciones.geocoding_cache` (clave = hash de `direccion_norm` +
 * `comuna_norm`, calculado por `calcularClaveHash`):
 *   - HIT  → usa la fila cacheada, NO llama al proveedor.
 *   - MISS → llama al puerto de geocoding y hace upsert en el caché.
 *
 * Lanza lo que lance la lectura/escritura del caché (`Error` genérico) o lo
 * que lance el puerto (`ErrorGeocodingProveedor` / `ErrorGeocodingConfig`). El
 * llamador decide qué hacer con el error: el job lo deja subir para que
 * Inngest reintente (`step.run` + `retries: 3`); una Server Action debe
 * atraparlo y traducirlo a un estado de UI — nunca dejar que un pedido/bodega
 * quede en un estado intermedio sin persistir nada.
 */
export async function resolverCoordenadaConCache(
  args: ArgsResolverCoordenadaConCache,
): Promise<ResultadoGeocoding> {
  const { direccion, comuna, timeoutMs, logger, forzarConsulta } = args;
  const { claveHash, direccionNorm, comunaNorm } = calcularClaveHash(direccion, comuna);

  const supabase = crearClienteServiceRole();

  // Lookup en cache global. Se salta entero con `forzarConsulta` — ver la nota
  // de esa opción: un reintento pedido por un humano tiene que llegar al
  // proveedor, o no es un reintento.
  const { data: cacheData, error: cacheError } = forzarConsulta
    ? { data: null, error: null }
    : await supabase
        .schema('integraciones')
        .from('geocoding_cache')
        .select('lat, long, geo_estado, confianza, proveedor, comuna_norm')
        .eq('clave_hash', claveHash)
        .maybeSingle();

  if (cacheError) {
    throw new Error(`Error al leer geocoding_cache: ${cacheError.message}`);
  }

  if (cacheData) {
    // HIT — usar el resultado cacheado SIN llamar al proveedor.
    const fila = cacheData as FilaCache;
    logger?.info(`Geocoding: cache HIT (clave_hash=${claveHash.slice(0, 12)}…).`);
    return {
      resuelto: fila.geo_estado === 'resuelto',
      lat: fila.lat,
      long: fila.long,
      confianza: fila.confianza,
      estado: fila.geo_estado,
      // Recuperar la comuna canónica desde la declarada (estable) — igual
      // que hacía el job antes de esta extracción.
      comunaResuelta: resolverComunaCanonica(comuna),
      proveedor: fila.proveedor,
    } satisfies ResultadoGeocoding;
  }

  // MISS — llamar al proveedor a través del puerto.
  const puerto = obtenerPuertoActual();
  const res: ResultadoGeocoding = await puerto.geocodificar({
    direccion,
    comuna,
    timeoutMs,
  });

  // UPSERT en cache (on conflict clave_hash). Resultado compartido por toda
  // la plataforma — una dirección se geocodifica una sola vez, la pida un
  // pedido o una bodega.
  const { error: upsertError } = await supabase
    .schema('integraciones')
    .from('geocoding_cache')
    .upsert(
      {
        clave_hash: claveHash,
        direccion_norm: direccionNorm,
        comuna_norm: comunaNorm,
        lat: res.lat,
        long: res.long,
        geo_estado: res.estado,
        confianza: res.confianza,
        proveedor: res.proveedor,
      },
      { onConflict: 'clave_hash' },
    );

  if (upsertError) {
    throw new Error(`Error al upsert en geocoding_cache: ${upsertError.message}`);
  }

  return res;
}
