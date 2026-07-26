/**
 * Puerto de CALIDAD DEL AIRE.
 * =====================================================================
 *
 * Mismo patrón que `../clima/puerto.ts` y que `integraciones/geocoding`: el job
 * depende de `PuertoAire`, la fábrica elige el adaptador por entorno. Dato
 * global, no de tenant: sin `tenantId`, sin secretos por courier.
 *
 *   - CONTEXTO_AIRE_PROVIDER=stub  (default en dev/test/CI)
 *   - CONTEXTO_AIRE_PROVIDER=open-meteo
 *
 * Opcionales del adaptador real:
 *   - OPEN_METEO_AIRE_BASE_URL — sobrescribe el host (tier comercial).
 *   - OPEN_METEO_API_KEY — SOLO tier comercial. SECRETO: nunca en logs ni URLs
 *     citadas. Se comparte con el puerto de clima a propósito: es la misma
 *     suscripción de Open-Meteo.
 *
 * ⚠️ El tier gratuito NO permite uso comercial (ver `../open-meteo-comun.ts`).
 */

import { ErrorContextoConfig } from '../errores';
import type { ResultadoContexto } from '../resultado';
import { OpenMeteoAireAdapter } from './adaptadores/open-meteo';
import { StubAireAdapter } from './adaptadores/stub';
import type { ParametrosAire, PronosticoAireHorario } from './tipos';

export interface PuertoAire {
  /**
   * Pronóstico horario de PM2.5/PM10 por comuna, con el nivel de episodio ya
   * estimado sobre el promedio móvil de 24 h (ver `niveles.ts`). No lanza ante
   * fallos del proveedor: devuelve `{ ok: false, motivo }`.
   */
  obtenerPronostico(
    args?: ParametrosAire,
  ): Promise<ResultadoContexto<PronosticoAireHorario>>;
}

export function obtenerPuertoAire(): PuertoAire {
  const proveedor = (process.env.CONTEXTO_AIRE_PROVIDER ?? 'stub').trim().toLowerCase();

  switch (proveedor) {
    case '':
    case 'stub':
      return new StubAireAdapter();

    case 'open-meteo':
    case 'openmeteo': {
      const baseUrl = process.env.OPEN_METEO_AIRE_BASE_URL?.trim() || undefined;
      const apiKey = process.env.OPEN_METEO_API_KEY?.trim() || undefined;
      return new OpenMeteoAireAdapter({ baseUrl, apiKey });
    }

    default:
      throw new ErrorContextoConfig(
        `CONTEXTO_AIRE_PROVIDER='${proveedor}' no es reconocido (usa 'stub' u 'open-meteo')`,
      );
  }
}
