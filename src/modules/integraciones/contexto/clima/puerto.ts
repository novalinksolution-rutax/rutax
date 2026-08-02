/**
 * Puerto de CLIMA — única puerta por la que el sistema consulta el pronóstico.
 * =====================================================================
 *
 * Patrón idéntico a `integraciones/geocoding/puerto.ts`: el job (consumidor)
 * depende de la interfaz `PuertoClima`, nunca del adaptador concreto. La fábrica
 * elige el adaptador por variable de entorno GLOBAL — el clima de Santiago no es
 * dato de tenant (§5 del diseño), así que la fábrica NO recibe `tenantId` y no
 * hay nada que descifrar por courier.
 *
 *   - CONTEXTO_CLIMA_PROVIDER=stub         (default en dev/test/CI) → sin red.
 *   - CONTEXTO_CLIMA_PROVIDER=openweather  → adaptador real.
 *
 * Variables del adaptador real:
 *   - OPENWEATHER_API_KEY — obligatoria. Es un SECRETO: no se loguea, no entra
 *     en ningún mensaje de error y no se cita ninguna URL que la lleve
 *     (`referenciaSegura()` corta el query string). Se obtiene sin tarjeta.
 *   - OPENWEATHER_BASE_URL — opcional. Existe para las pruebas y por si algún
 *     día se contrata un host distinto; no se inventa aquí un hostname.
 *
 * ⚠️ La licencia del tier gratuito de OpenWeather permite uso comercial **a
 * cambio de atribución visible en pantalla**. Vive en la franja al pie del mapa
 * y quitarla rompe la licencia, no solo la cortesía. Fue justamente la falta de
 * permiso comercial lo que descartó a Open-Meteo, el proveedor anterior.
 *
 * DEGRADACIÓN: `obtenerPronostico` NUNCA lanza por un fallo de la fuente —
 * devuelve `ResultadoContexto`, que sabe decir "no pude". Lo único que lanza es
 * `obtenerPuertoClima()` ante configuración inválida (bug de despliegue); el
 * llamador lo envuelve con `degradarDesdeError()`.
 */

import { ErrorContextoConfig } from '../errores';
import type { ResultadoContexto } from '../resultado';
import { OpenWeatherClimaAdapter } from './adaptadores/openweather';
import { StubClimaAdapter } from './adaptadores/stub';
import type { ParametrosClima, PronosticoClima } from './tipos';

/** Contrato que todo adaptador de clima concreto cumple. */
export interface PuertoClima {
  /**
   * Pronóstico horario por comuna. No lanza ante fallos del proveedor:
   * devuelve `{ ok: false, motivo }` para que el llamador marque la capa como
   * degradada en `contexto.fuentes_estado` y siga.
   */
  obtenerPronostico(args?: ParametrosClima): Promise<ResultadoContexto<PronosticoClima>>;
}

export function obtenerPuertoClima(): PuertoClima {
  const proveedor = (process.env.CONTEXTO_CLIMA_PROVIDER ?? 'stub').trim().toLowerCase();

  switch (proveedor) {
    case '':
    case 'stub':
      return new StubClimaAdapter();

    case 'openweather':
    case 'open-weather': {
      const baseUrl = process.env.OPENWEATHER_BASE_URL?.trim() || undefined;
      const apiKey = process.env.OPENWEATHER_API_KEY?.trim() || undefined;
      // Nunca se loguea `apiKey`, ni su largo, ni un prefijo.
      return new OpenWeatherClimaAdapter({ baseUrl, apiKey });
    }

    default:
      throw new ErrorContextoConfig(
        `CONTEXTO_CLIMA_PROVIDER='${proveedor}' no es reconocido (usa 'stub' u 'openweather')`,
      );
  }
}
