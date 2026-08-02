/**
 * Puerto de geocoding — única puerta por la que el sistema geocodifica una
 * dirección a coordenadas.
 * =====================================================================
 *
 * Patrón idéntico a `integraciones/dte/puerto.ts` y `integraciones/pagos`:
 * el job (consumidor) depende de la interfaz `PuertoGeocoding`, nunca del
 * adaptador concreto. La fábrica elige el adaptador.
 *
 * DIFERENCIA con DTE/pagos (importante): el geocoding NO es por tenant. La API
 * key de Google es de PLATAFORMA (la paga el fundador, no el courier), así que
 * NO vive en `identidad.secretos_cifrados` ni se descifra por tenant. La
 * fábrica elige el adaptador por una variable de entorno GLOBAL:
 *
 *   - GEOCODING_PROVIDER=stub  (default en dev/test/CI) → adaptador determinista
 *     sin red, centroides de comuna. Cero costo, cero llamadas externas.
 *   - GEOCODING_PROVIDER=google + GOOGLE_MAPS_API_KEY → adaptador real.
 *
 * La API key (`GOOGLE_MAPS_API_KEY`) NUNCA se loguea, no se incluye en errores
 * ni se propaga en URLs hacia logs — regla dura del proyecto.
 *
 * VERIFICACIÓN CONTRA DOC OFICIAL (Google Geocoding API, junio 2026):
 *   - Endpoint: https://maps.googleapis.com/maps/api/geocode/json (HTTPS oblig.).
 *   - `region=cl` sesga (no restringe) hacia Chile (ccTLD de 2 letras).
 *   - `components=administrative_area:Region Metropolitana|country:CL` filtra.
 *   - `location_type`: ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE.
 *   - `status`: OK | ZERO_RESULTS | OVER_QUERY_LIMIT | OVER_DAILY_LIMIT |
 *     REQUEST_DENIED | INVALID_REQUEST | UNKNOWN_ERROR.
 *   Fuente: developers.google.com/maps/documentation/geocoding/requests-geocoding.
 *   Detalles volátiles a reconfirmar antes de producción: costo por 1.000
 *   requests, límite de QPS del plan, y si conviene migrar a la Places/Geocoding
 *   API v2 ("Address Validation"). El TTL del cache es indefinido por diseño
 *   (una dirección normalizada es un hecho geográfico estable).
 */

import { ErrorGeocodingConfig } from './errores';
import { StubGeocodingAdapter } from './adaptadores/stub';
import { GoogleGeocodingAdapter } from './adaptadores/google';
import type { ParametrosGeocoding, ResultadoGeocoding } from './tipos';

/**
 * Contrato que todo adaptador de geocoding concreto cumple. El job depende de
 * esta interfaz; los tests inyectan un doble.
 */
export interface PuertoGeocoding {
  /**
   * Geocodifica una dirección a coordenadas + estado normalizado.
   * Resiliente: el adaptador real reintenta/clasifica errores de red como
   * `ErrorGeocodingProveedor` (reintentable). Una dirección irresoluble NO es
   * un error: devuelve `estado: 'no_resuelto'`.
   */
  geocodificar(args: ParametrosGeocoding): Promise<ResultadoGeocoding>;
}

/**
 * Devuelve el adaptador de geocoding según la configuración GLOBAL de la
 * plataforma (variables de entorno). NO recibe `tenantId`: el geocoding no es
 * por tenant.
 *
 * - `GEOCODING_PROVIDER` ausente o `stub` → `StubGeocodingAdapter`.
 * - `GEOCODING_PROVIDER=google` → exige `GOOGLE_MAPS_API_KEY`; si falta →
 *   `ErrorGeocodingConfig` (no reintentable).
 * - Cualquier otro valor → `ErrorGeocodingConfig`.
 *
 * La API key se pasa al adaptador pero NUNCA se loguea aquí.
 */
export function obtenerPuertoGeocoding(): PuertoGeocoding {
  const proveedor = (process.env.GEOCODING_PROVIDER ?? 'stub').trim().toLowerCase();

  switch (proveedor) {
    case 'stub':
    case '':
      return new StubGeocodingAdapter();

    case 'google': {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey || apiKey.trim() === '') {
        // No incluir ningún valor — solo el hecho de que falta.
        throw new ErrorGeocodingConfig(
          "GEOCODING_PROVIDER=google requiere GOOGLE_MAPS_API_KEY; no está definida",
        );
      }
      return new GoogleGeocodingAdapter(apiKey);
    }

    default:
      // `proveedor` viene de env — texto controlado por devops, pero lo
      // citamos con comillas y sin valores sensibles.
      throw new ErrorGeocodingConfig(
        `GEOCODING_PROVIDER='${proveedor}' no es reconocido (usa 'stub' o 'google')`,
      );
  }
}
