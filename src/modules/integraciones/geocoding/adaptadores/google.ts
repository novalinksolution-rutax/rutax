/**
 * Adaptador real de Google Geocoding API.
 * =====================================================================
 *
 * Geocodifica direcciones de la Región Metropolitana a coordenadas.
 *
 * VERIFICADO CONTRA DOC OFICIAL (junio 2026 — developers.google.com/maps/
 * documentation/geocoding/requests-geocoding):
 *   - Endpoint: https://maps.googleapis.com/maps/api/geocode/json (HTTPS).
 *   - `region=cl` sesga (no restringe) hacia Chile (ccTLD de 2 letras).
 *   - `components=administrative_area:Region Metropolitana|country:CL` filtra.
 *   - `location_type`: ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER |
 *     APPROXIMATE → mapeado a `confianza` 1.0 / 0.8 / 0.6 / 0.4.
 *   - `status`: OK | ZERO_RESULTS → resultado normal; OVER_QUERY_LIMIT |
 *     OVER_DAILY_LIMIT | UNKNOWN_ERROR | (HTTP 429/5xx) → reintentable;
 *     REQUEST_DENIED | INVALID_REQUEST → NO reintentable (config/bug).
 *
 * DETALLES VOLÁTILES a reconfirmar antes de producción: costo por 1.000
 * requests del plan vigente, límite de QPS, y conveniencia de migrar a la
 * Address Validation API. No se confirmaron aquí porque el adaptador por
 * defecto del MVP es el stub.
 *
 * SEGURIDAD: la API key se pasa como query param a Google (lo exige la API),
 * pero NUNCA se loguea, no se incluye en errores y no se imprime la URL con la
 * key. Regla dura del proyecto.
 *
 * TIMEOUT: `args.timeoutMs` (opcional) se traduce a `AbortSignal.timeout(ms)`
 * en el `fetch` — mismo patrón que el resto del repo para llamadas de red
 * (`integraciones/contexto/http.ts`, `notificaciones/email/adaptadores/resend.ts`,
 * `api-publica/jobs/entregar-webhook.ts`). Si no se pasa, el `fetch` NO lleva
 * `signal` — sin límite, igual que siempre. Un timeout que dispara se propaga
 * como fallo de red (rechazo de `fetch`) y cae en el mismo `catch` de abajo,
 * así que sale como `ErrorGeocodingProveedor` reintentable, sin necesitar
 * manejo especial.
 *
 * REGLAS DE DEPENDENCIAS: solo importa de `../tipos`, `../errores` y el helper
 * de normalización + catálogo RM. No importa de módulos de negocio.
 */

import type { PuertoGeocoding } from '../puerto';
import { ErrorGeocodingProveedor } from '../errores';
import { resolverComunaCanonica } from '../normalizacion';
import type { ParametrosGeocoding, ResultadoGeocoding } from '../tipos';

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Región administrativa objetivo. La operación del MVP es solo RM (Santiago). */
const REGION_METROPOLITANA = 'Region Metropolitana';

/** Forma parcial de la respuesta de Google que consumimos. */
interface RespuestaGoogle {
  status: string;
  error_message?: string;
  results?: Array<{
    geometry?: {
      location?: { lat?: number; lng?: number };
      location_type?: string;
    };
    address_components?: Array<{
      long_name?: string;
      short_name?: string;
      types?: string[];
    }>;
  }>;
}

/** Mapea `location_type` de Google a una confianza 0.0–1.0. */
function confianzaDesdeLocationType(locationType: string | undefined): number {
  switch (locationType) {
    case 'ROOFTOP':
      return 1.0;
    case 'RANGE_INTERPOLATED':
      return 0.8;
    case 'GEOMETRIC_CENTER':
      return 0.6;
    case 'APPROXIMATE':
    default:
      return 0.4;
  }
}

export class GoogleGeocodingAdapter implements PuertoGeocoding {
  /**
   * API key de plataforma. NUNCA se loguea, no se incluye en errores ni en
   * URLs que se impriman. Solo se usa al construir el query a Google.
   */
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async geocodificar(args: ParametrosGeocoding): Promise<ResultadoGeocoding> {
    const url = new URL(GOOGLE_GEOCODE_URL);
    url.searchParams.set('address', `${args.direccion}, ${args.comuna}`);
    url.searchParams.set('region', 'cl');
    url.searchParams.set(
      'components',
      `administrative_area:${REGION_METROPOLITANA}|country:CL`,
    );
    url.searchParams.set('key', this.apiKey);

    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        method: 'GET',
        // Sin `args.timeoutMs` no se agrega `signal` — mismo comportamiento
        // que antes de este campo (sin límite). Ver nota de TIMEOUT arriba.
        ...(args.timeoutMs !== undefined
          ? { signal: AbortSignal.timeout(args.timeoutMs) }
          : {}),
      });
    } catch (e) {
      // Error de red/timeout — transitorio, reintentable. NO incluir la URL
      // (lleva la API key) en el mensaje.
      throw new ErrorGeocodingProveedor(
        `fallo de red al contactar Google Geocoding: ${(e as Error).message}`,
      );
    }

    if (respuesta.status === 429 || respuesta.status >= 500) {
      // Rate limit o error de servidor — reintentable.
      throw new ErrorGeocodingProveedor(
        `Google respondió HTTP ${respuesta.status}`,
        respuesta.status,
      );
    }

    if (!respuesta.ok) {
      // 4xx distinto de 429 (p. ej. 400/403) — config/credencial; no reintentar
      // de forma indefinida, pero lo modelamos como error de proveedor con su
      // código para que el job decida. No incluir la URL con la key.
      throw new ErrorGeocodingProveedor(
        `Google respondió HTTP ${respuesta.status}`,
        respuesta.status,
      );
    }

    const datos = (await respuesta.json()) as RespuestaGoogle;

    switch (datos.status) {
      case 'OK':
        return this.normalizarResultadoOk(datos, args);

      case 'ZERO_RESULTS':
        // Dirección irresoluble — NO es error. El job la persiste como
        // no_resuelto y NO reintenta.
        return this.noResuelto();

      case 'OVER_QUERY_LIMIT':
      case 'OVER_DAILY_LIMIT':
      case 'UNKNOWN_ERROR':
        // Transitorio — reintentable. `error_message` puede traer detalle del
        // proveedor; lo incluimos sanitizado (Google no devuelve la key ahí).
        throw new ErrorGeocodingProveedor(
          `Google status=${datos.status}` +
            (datos.error_message ? `: ${datos.error_message}` : ''),
        );

      case 'REQUEST_DENIED':
      case 'INVALID_REQUEST':
      default:
        // Config inválida / petición mal formada / key denegada. Lo tratamos
        // como error de proveedor (el job no debe reintentar indefinidamente).
        // NO incluimos `error_message` de REQUEST_DENIED por si menciona la key.
        throw new ErrorGeocodingProveedor(
          `Google status=${datos.status} (no reintentable)`,
        );
    }
  }

  /** Construye el resultado normalizado a partir de una respuesta OK. */
  private normalizarResultadoOk(
    datos: RespuestaGoogle,
    args: ParametrosGeocoding,
  ): ResultadoGeocoding {
    const primero = datos.results?.[0];
    const lat = primero?.geometry?.location?.lat;
    const lng = primero?.geometry?.location?.lng;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      // OK sin coordenadas usables — tratar como no resuelto.
      return this.noResuelto();
    }

    // Determinar la comuna que Google asignó (componente `locality` o
    // `administrative_area_level_3`) y mapearla al catálogo RM.
    const comunaGoogle = this.extraerComuna(primero?.address_components);
    const comunaCanonica =
      resolverComunaCanonica(comunaGoogle ?? args.comuna) ??
      resolverComunaCanonica(args.comuna);

    // Fuera de cobertura: el resultado tiene coordenadas pero la comuna no
    // pertenece a la RM (catálogo) → el courier no opera ahí.
    if (comunaCanonica === null) {
      return {
        resuelto: false,
        lat: null,
        long: null,
        confianza: null,
        estado: 'fuera_cobertura',
        comunaResuelta: comunaGoogle ?? null,
        proveedor: 'google',
      };
    }

    return {
      resuelto: true,
      lat,
      long: lng,
      confianza: confianzaDesdeLocationType(primero?.geometry?.location_type),
      estado: 'resuelto',
      comunaResuelta: comunaCanonica,
      proveedor: 'google',
    };
  }

  /** Extrae el nombre de comuna de los `address_components` de Google. */
  private extraerComuna(
    componentes:
      | Array<{ long_name?: string; types?: string[] }>
      | undefined,
  ): string | null {
    if (!componentes) return null;
    // Google modela la comuna chilena como `locality` o
    // `administrative_area_level_3`.
    const candidato =
      componentes.find((c) => c.types?.includes('locality')) ??
      componentes.find((c) =>
        c.types?.includes('administrative_area_level_3'),
      );
    return candidato?.long_name ?? null;
  }

  private noResuelto(): ResultadoGeocoding {
    return {
      resuelto: false,
      lat: null,
      long: null,
      confianza: null,
      estado: 'no_resuelto',
      comunaResuelta: null,
      proveedor: 'google',
    };
  }
}
