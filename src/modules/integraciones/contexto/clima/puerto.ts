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
 *   - CONTEXTO_CLIMA_PROVIDER=stub  (default en dev/test/CI) → determinista, sin red.
 *   - CONTEXTO_CLIMA_PROVIDER=open-meteo                     → adaptador real.
 *
 * Variables opcionales del adaptador real:
 *   - OPEN_METEO_CLIMA_BASE_URL — sobrescribe el host. Existe porque el tier
 *     COMERCIAL de Open-Meteo usa otro host (`customer-api.open-meteo.com`) y no
 *     se inventa aquí un hostname que no se pudo verificar sin suscripción.
 *   - OPEN_METEO_API_KEY — SOLO tier comercial. Es un SECRETO: no se loguea, no
 *     entra en ningún mensaje de error y no se cita ninguna URL que la lleve
 *     (`referenciaSegura()` corta el query string).
 *
 * ⚠️ El tier gratuito de Open-Meteo NO permite uso comercial — ver el encabezado
 * de `../open-meteo-comun.ts`. La decisión de contratar el plan de pago es de
 * negocio, no de este archivo; el código solo deja de ser un obstáculo.
 *
 * DEGRADACIÓN: `obtenerPronostico` NUNCA lanza por un fallo de la fuente —
 * devuelve `ResultadoContexto`, que sabe decir "no pude". Lo único que lanza es
 * `obtenerPuertoClima()` ante configuración inválida (bug de despliegue); el
 * llamador lo envuelve con `degradarDesdeError()`.
 */

import { ErrorContextoConfig } from '../errores';
import type { ResultadoContexto } from '../resultado';
import { OpenMeteoClimaAdapter } from './adaptadores/open-meteo';
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

    case 'open-meteo':
    case 'openmeteo': {
      const baseUrl = process.env.OPEN_METEO_CLIMA_BASE_URL?.trim() || undefined;
      const apiKey = process.env.OPEN_METEO_API_KEY?.trim() || undefined;
      // Nunca se loguea `apiKey`, ni su largo, ni un prefijo.
      return new OpenMeteoClimaAdapter({ baseUrl, apiKey });
    }

    default:
      throw new ErrorContextoConfig(
        `CONTEXTO_CLIMA_PROVIDER='${proveedor}' no es reconocido (usa 'stub' u 'open-meteo')`,
      );
  }
}
