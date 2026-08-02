/**
 * Piezas compartidas de los adaptadores de OpenWeather.
 * =====================================================================
 *
 * POR QUÉ OPENWEATHER Y NO OPEN-METEO (verificado 2026-07-27, no inferido)
 * -----------------------------------------------------------------------------
 * Open-Meteo quedó descartado por LICENCIA, no por calidad: su tier gratuito
 * prohíbe el uso comercial y define como comercial una app con suscripciones —
 * que es exactamente lo que es Rutax. OpenWeather, en cambio:
 *
 *   · **No pide tarjeta** para obtener la clave del tier gratuito.
 *   · **Permite uso comercial** en el tier gratuito.
 *   · Exige a cambio **atribución visible**: el texto «Weather data provided by
 *     OpenWeather» y un enlace a openweathermap.org. Está en la franja al pie
 *     del mapa (`_componentes/mapa/atribucion-mapa.tsx`) y **no puede quitarse
 *     de ahí sin romper la licencia**.
 *   · Cuota: 60 llamadas por minuto y 1.000.000 al mes. Nuestro consumo con la
 *     grilla de 14 puntos es ~20.000 al mes entre las dos fuentes.
 *
 * -----------------------------------------------------------------------------
 * TRES TRAMPAS DE ESTA API, TODAS VERIFICADAS EN LA DOCUMENTACIÓN
 * -----------------------------------------------------------------------------
 * 1. **`units=metric` devuelve el viento en METROS POR SEGUNDO, no en km/h.**
 *    La documentación lo dice literal («Unit Default: meter/sec, Metric:
 *    meter/sec»). Es la trampa más cara del lote: la columna
 *    `contexto.clima_horario.viento_kmh` espera km/h, y escribir m/s ahí divide
 *    el viento por 3,6 sin que nada falle. Se convierte en `vientoAKmh()`.
 *
 * 2. **`rain.3h` es ACUMULADO de tres horas, no intensidad horaria.** El
 *    pronóstico gratuito viene en pasos de 3 h. Escribir ese número como si
 *    fuera mm/hora TRIPLICA la lluvia que ve el motor de riesgo y convierte
 *    cualquier tarde de invierno en crítica. Se divide entre las horas del paso.
 *
 * 3. **`dt` es Unix en segundos UTC**, un instante absoluto de verdad. Es una
 *    ventaja frente a Open-Meteo, que devolvía hora local naive y obligaba a
 *    reconstruir el offset de Santiago a mano. Aquí `new Date(dt * 1000)` basta
 *    y no hay conversión de zona que equivocar.
 *
 * -----------------------------------------------------------------------------
 * LA CLAVE ES UN SECRETO
 * -----------------------------------------------------------------------------
 * `appid` viaja en el query string porque la API no admite otra cosa. En
 * consecuencia: **ninguna URL de esta integración se cita entera** en un error,
 * un log o un mensaje. `referenciaSegura()` corta el query y es lo único que se
 * puede imprimir.
 */

import { ErrorContextoConfig } from './errores';

/** Host del tier gratuito. Configurable solo para pruebas y para el tier de pago. */
export const BASE_URL_OPENWEATHER = 'https://api.openweathermap.org';

/** Paso del pronóstico gratuito de clima, en horas. */
export const PASO_HORAS_FORECAST = 3;

/** m/s → km/h. Ver trampa 1 del encabezado. */
export function vientoAKmh(metrosPorSegundo: number | null | undefined): number | null {
  if (typeof metrosPorSegundo !== 'number' || !Number.isFinite(metrosPorSegundo)) return null;
  return Math.round(metrosPorSegundo * 3.6 * 100) / 100;
}

/**
 * Acumulado del paso → intensidad media por hora. Ver trampa 2 del encabezado.
 *
 * Es una MEDIA, y eso pierde la estructura del chaparrón: 6 mm caídos en veinte
 * minutos se leen como 2 mm/h durante tres horas. Es el costo de resolución del
 * pronóstico gratuito, y está aceptado a sabiendas — el motor de riesgo agrega
 * por franja de 4–5 horas tomando el máximo, así que el efecto queda acotado.
 */
export function intensidadPorHora(
  acumuladoMm: number | null | undefined,
  horasDelPaso = PASO_HORAS_FORECAST,
): number | null {
  if (typeof acumuladoMm !== 'number' || !Number.isFinite(acumuladoMm)) return null;
  return Math.round((acumuladoMm / horasDelPaso) * 100) / 100;
}

/** `dt` de OpenWeather (Unix en segundos) → instante. */
export function instanteDesdeDt(dt: unknown): Date | null {
  if (typeof dt !== 'number' || !Number.isFinite(dt)) return null;
  const instante = new Date(dt * 1000);
  return Number.isNaN(instante.getTime()) ? null : instante;
}

/**
 * Arma la URL de una llamada. La clave va aparte y **nunca** se concatena a
 * mano en un mensaje.
 */
export function construirUrlOpenWeather(args: {
  baseUrl?: string;
  ruta: string;
  lat: number;
  long: number;
  apiKey: string;
  extra?: Record<string, string | number>;
}): URL {
  if (!args.apiKey) {
    throw new ErrorContextoConfig(
      'Falta OPENWEATHER_API_KEY. Es la clave del tier gratuito de OpenWeather; ' +
        'se obtiene sin tarjeta en openweathermap.org y no se versiona.',
    );
  }

  const url = new URL(args.ruta, args.baseUrl ?? BASE_URL_OPENWEATHER);
  url.searchParams.set('lat', String(args.lat));
  url.searchParams.set('lon', String(args.long));
  for (const [clave, valor] of Object.entries(args.extra ?? {})) {
    url.searchParams.set(clave, String(valor));
  }
  // Última, para que un recorte accidental del query no la deje visible al inicio.
  url.searchParams.set('appid', args.apiKey);
  return url;
}

/**
 * Lee un número de un objeto tolerando `null`, ausencia y basura. Devuelve
 * `null` en vez de `0`: un cero inventado en precipitación silencia la lluvia y
 * en PM2.5 silencia un episodio.
 */
export function numeroOpcional(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

/** Un elemento de `list` ya validado como objeto. */
export function comoLista(cuerpo: unknown): Record<string, unknown>[] {
  if (typeof cuerpo !== 'object' || cuerpo === null) return [];
  const lista = (cuerpo as { list?: unknown }).list;
  if (!Array.isArray(lista)) return [];
  return lista.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
  );
}
