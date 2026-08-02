/**
 * Puerto de CALIDAD DEL AIRE.
 * =====================================================================
 *
 * Mismo patrón que `../clima/puerto.ts` y que `integraciones/geocoding`: el job
 * depende de `PuertoAire`, la fábrica elige el adaptador por entorno. Dato
 * global, no de tenant: sin `tenantId`, sin secretos por courier.
 *
 *   - CONTEXTO_AIRE_PROVIDER=stub         (default en dev/test/CI)
 *   - CONTEXTO_AIRE_PROVIDER=openweather  → adaptador real
 *
 * Variables del adaptador real:
 *   - OPENWEATHER_API_KEY — obligatoria. SECRETO: nunca en logs ni en URLs
 *     citadas. Se comparte con el puerto de clima a propósito: es la misma
 *     cuenta de OpenWeather.
 *   - OPENWEATHER_BASE_URL — opcional, solo para pruebas o para el host de pago.
 *
 * La licencia del tier gratuito exige **atribución visible en pantalla**; vive
 * en la franja al pie del mapa y no puede quitarse de ahí.
 */

import { ErrorContextoConfig } from '../errores';
import type { ResultadoContexto } from '../resultado';
import { OpenWeatherAireAdapter } from './adaptadores/openweather';
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

    case 'openweather':
    case 'open-weather': {
      const baseUrl = process.env.OPENWEATHER_BASE_URL?.trim() || undefined;
      const apiKey = process.env.OPENWEATHER_API_KEY?.trim() || undefined;
      // Nunca se loguea `apiKey`, ni su largo, ni un prefijo.
      return new OpenWeatherAireAdapter({ baseUrl, apiKey });
    }

    default:
      throw new ErrorContextoConfig(
        `CONTEXTO_AIRE_PROVIDER='${proveedor}' no es reconocido (usa 'stub' u 'openweather')`,
      );
  }
}
