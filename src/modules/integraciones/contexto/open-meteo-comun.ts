/**
 * Piezas compartidas por los dos adaptadores de Open-Meteo (clima y aire).
 * =====================================================================
 *
 * Los dos endpoints —`api.open-meteo.com/v1/forecast` y
 * `air-quality-api.open-meteo.com/v1/air-quality`— hablan EXACTAMENTE el mismo
 * dialecto: mismos parámetros de multicoordenada, misma forma de respuesta,
 * mismo formato de hora. La parte de ese dialecto que es fácil de implementar
 * mal vive aquí una sola vez, con sus pruebas.
 *
 * -----------------------------------------------------------------------------
 * VERIFICADO EN VIVO CONTRA LA API (2026-07-26), no solo contra la doc
 * -----------------------------------------------------------------------------
 * Petición real con las 52 comunas de `CENTROIDES_RM` a `/v1/forecast`:
 *   HTTP 200 · 1.276 ms · 146 KB · arreglo de 52 elementos, en el MISMO orden
 *   de las coordenadas pedidas.
 *
 * GOTCHA 1 — LA RESPUESTA MULTICOORDENADA ES UN ARREGLO, Y SE MAPEA POR ÍNDICE.
 *   Con una sola coordenada Open-Meteo devuelve un OBJETO; con varias, un
 *   ARREGLO. No hay `location_id` en JSON (la doc lo ofrece solo para CSV/XLSX),
 *   así que el único vínculo comuna↔resultado es la POSICIÓN.
 *
 * GOTCHA 2 — NO SE PUEDE REMAPEAR POR COORDENADAS. La API devuelve la
 *   coordenada del NODO DE GRILLA del modelo, no la que se pidió. Medido: las
 *   52 comunas de la RM caen en solo 26 nodos distintos — la mitad comparte
 *   nodo. Intentar emparejar por lat/long produciría comunas duplicadas y
 *   comunas perdidas, en silencio. Por eso `emparejarPorIndice()` valida el
 *   largo y falla ruidosamente si no calza.
 *
 * GOTCHA 3 — LAS HORAS VIENEN SIN OFFSET. Con `timezone=America/Santiago` el
 *   campo `time` es `"2026-07-26T00:00"`: hora local de Santiago, NAIVE. En
 *   Node, `new Date("2026-07-26T00:00")` interpreta un date-time sin offset como
 *   hora LOCAL DEL PROCESO — y Vercel corre en UTC. Sería un corrimiento de 3–4
 *   horas: exactamente el bug que "mostraría el clima del día equivocado", que
 *   §6 marca como el peor fallo posible de este módulo. Se convierte con
 *   `combinarFechaHoraSantiago()` de `src/lib/fecha-santiago.ts`.
 *
 *   Y NO se usa el `utc_offset_seconds` de la respuesta, aunque venga: es UN
 *   valor para toda la ventana pronosticada. Chile cambia de horario (DST) en
 *   septiembre y en abril; un horizonte que cruce la transición tendría dos
 *   offsets distintos y el escalar los aplastaría a uno. `combinarFechaHora-
 *   Santiago` resuelve hora por hora vía IANA, sin hardcodear ±3/±4.
 *
 * GOTCHA 4 — HAY UN LÍMITE DE LARGO DE URL. 52 coordenadas dan ~1,1 KB de URL,
 *   holgado. Si algún día se consultan más puntos (manzanas, no comunas), hay
 *   que trocear: por eso el troceo existe (`PUNTOS_POR_LLAMADA`) aunque hoy no
 *   se active.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ DESAJUSTE CON §4 DEL DISEÑO — USO COMERCIAL
 * -----------------------------------------------------------------------------
 * §4 afirma "gratis, uso comercial" para Open-Meteo. Los términos oficiales
 * (open-meteo.com/en/terms, consultados 2026-07-26) dicen lo contrario: el tier
 * gratuito es "Commercial use ❌" — "You may only use the free API services for
 * non-commercial purposes" — y define como uso comercial "operating websites or
 * apps that have subscriptions". Rutax cobra suscripción. El uso comercial exige
 * un plan de pago, que además cambia el host (`customer-api.open-meteo.com`) y
 * agrega `&apikey=`.
 *
 * Consecuencia de diseño: `baseUrl` y `apiKey` son configurables por entorno y
 * la key, si existe, se trata como SECRETO (nunca en logs, nunca en un mensaje
 * de error, nunca en `detalleTecnico` — `referenciaSegura()` corta el query).
 * El host exacto del tier de pago para el endpoint de calidad del aire NO se
 * pudo verificar sin una suscripción activa: se deja como variable de entorno en
 * vez de inventarlo.
 *
 * -----------------------------------------------------------------------------
 * COSTO REAL POR CICLO (ajuste fino a §6)
 * -----------------------------------------------------------------------------
 * §6 dice "1 request (52 comunas)". Cierto como PETICIÓN HTTP —que es la
 * ganancia grande: una conexión y ~1,3 s en vez de 52 idas y vueltas— pero la
 * CUOTA de Open-Meteo no se cuenta por petición: pondera por número de
 * ubicaciones, variables y días. 52 puntos × 1/hora ≈ 1.248 llamadas ponderadas
 * al día, holgadamente bajo el tope de 10.000/día del tier gratuito, pero no es
 * "1". Vale la pena saberlo antes de bajar la cadencia a 15 minutos.
 */

import { combinarFechaHoraSantiago } from '@/lib/fecha-santiago';
import { CENTROIDES_RM } from '@/lib/geo/centroides-rm';
import type { ComunaRM } from '@/lib/ui/comunas-rm';
import { ErrorContextoRespuesta } from './errores';

/**
 * Tope defensivo de puntos por llamada. Open-Meteo documenta hasta 1.000
 * ubicaciones por petición; el límite real que muerde antes es el largo de URL.
 * Con 52 comunas (~1,1 KB) nunca se activa el troceo — está para que consultar
 * más puntos en el futuro no rompa nada en silencio.
 */
export const PUNTOS_POR_LLAMADA = 200;

/**
 * Bloque `hourly` de Open-Meteo: `time` más un arreglo por variable pedida.
 * Los valores pueden ser `null` cuando el modelo no tiene dato para esa hora.
 */
export interface BloqueHorario {
  time: string[];
  [variable: string]: Array<number | null> | string[];
}

/** Forma parcial de la respuesta de Open-Meteo que consumimos. */
export interface RespuestaOpenMeteo {
  latitude?: number;
  longitude?: number;
  utc_offset_seconds?: number;
  timezone?: string;
  hourly?: BloqueHorario;
  /** Cuerpo de error de Open-Meteo: `{ error: true, reason: "..." }` con HTTP 400. */
  error?: boolean;
  reason?: string;
}

/** Un punto de consulta: comuna + su centroide. */
export interface PuntoComuna {
  comuna: ComunaRM;
  lat: number;
  long: number;
}

/**
 * Construye los puntos de consulta a partir del catálogo compartido
 * `CENTROIDES_RM` (`src/lib/geo/`, uso de producción declarado en su encabezado).
 * Sin argumento, las 52 comunas de la RM.
 */
export function puntosDeConsulta(comunas?: readonly ComunaRM[]): PuntoComuna[] {
  const lista = comunas ?? (Object.keys(CENTROIDES_RM) as ComunaRM[]);
  return lista.map((comuna) => {
    const centroide = CENTROIDES_RM[comuna];
    if (!centroide) {
      throw new ErrorContextoRespuesta(
        `la comuna '${comuna}' no está en CENTROIDES_RM`,
      );
    }
    return { comuna, lat: centroide.lat, long: centroide.long };
  });
}

/** Parte `puntos` en lotes que quepan cómodos en una URL. */
export function trocear<T>(puntos: readonly T[], tamano = PUNTOS_POR_LLAMADA): T[][] {
  if (tamano < 1) throw new RangeError('el tamaño de lote debe ser >= 1');
  const lotes: T[][] = [];
  for (let i = 0; i < puntos.length; i += tamano) {
    lotes.push(puntos.slice(i, i + tamano));
  }
  return lotes;
}

/**
 * Arma la URL multicoordenada. `latitude` y `longitude` son listas paralelas
 * separadas por coma — así las 52 comunas caben en una sola petición HTTP.
 *
 * `apiKey` se agrega solo si existe (tier comercial). NUNCA se loguea esta URL.
 */
export function construirUrlOpenMeteo(args: {
  baseUrl: string;
  puntos: readonly PuntoComuna[];
  variablesHorarias: readonly string[];
  forecastDays: number;
  pastDays?: number;
  apiKey?: string;
}): URL {
  const url = new URL(args.baseUrl);
  url.searchParams.set('latitude', args.puntos.map((p) => p.lat).join(','));
  url.searchParams.set('longitude', args.puntos.map((p) => p.long).join(','));
  url.searchParams.set('hourly', args.variablesHorarias.join(','));
  // Se pide en hora local de Santiago a propósito: así el corte de día que ve
  // el coordinador es el civil chileno, no el de UTC.
  url.searchParams.set('timezone', 'America/Santiago');
  url.searchParams.set('forecast_days', String(args.forecastDays));
  if (args.pastDays !== undefined && args.pastDays > 0) {
    url.searchParams.set('past_days', String(args.pastDays));
  }
  if (args.apiKey) {
    url.searchParams.set('apikey', args.apiKey);
  }
  return url;
}

/**
 * Normaliza la respuesta a un arreglo. Open-Meteo devuelve un OBJETO para una
 * sola coordenada y un ARREGLO para varias — tratar solo un caso es el error
 * clásico que aparece justo cuando alguien consulta una comuna suelta.
 */
export function comoArreglo(cuerpo: unknown): RespuestaOpenMeteo[] {
  if (Array.isArray(cuerpo)) return cuerpo as RespuestaOpenMeteo[];
  if (cuerpo && typeof cuerpo === 'object') return [cuerpo as RespuestaOpenMeteo];
  throw new ErrorContextoRespuesta('el cuerpo no es un objeto ni un arreglo');
}

/**
 * Empareja resultados con comunas POR ÍNDICE, que es el único vínculo fiable
 * (ver GOTCHA 1 y 2 del encabezado). Falla ruidosamente si los largos no calzan:
 * un emparejamiento corrido asignaría el clima de Melipilla a Vitacura sin que
 * nada se queje, y ese dato después mueve el puntaje de riesgo de una zona.
 */
export function emparejarPorIndice(
  puntos: readonly PuntoComuna[],
  resultados: readonly RespuestaOpenMeteo[],
): Array<{ punto: PuntoComuna; resultado: RespuestaOpenMeteo }> {
  if (resultados.length !== puntos.length) {
    throw new ErrorContextoRespuesta(
      `se pidieron ${puntos.length} ubicaciones y llegaron ${resultados.length}; ` +
        'el emparejamiento comuna↔resultado es posicional y no se puede reconstruir',
    );
  }
  return puntos.map((punto, i) => ({ punto, resultado: resultados[i] }));
}

/**
 * Convierte una marca `"YYYY-MM-DDTHH:mm"` de Open-Meteo (hora local de
 * Santiago, sin offset) al instante absoluto correspondiente.
 *
 * ESTA FUNCIÓN ES EL CORAZÓN DEL MÓDULO EN CUANTO A CORRECCIÓN. Ver GOTCHA 3.
 * Nunca sustituir por `new Date(marca)` ni por `toISOString()`.
 */
export function horaSantiagoAInstante(marca: string): Date {
  const separador = marca.indexOf('T');
  if (separador === -1) {
    throw new ErrorContextoRespuesta(
      `marca de tiempo sin separador 'T': '${marca}'`,
    );
  }
  const fecha = marca.slice(0, separador);
  // Open-Meteo entrega 'HH:mm'; se acepta 'HH:mm:ss' por si lo agrega.
  const hora = marca.slice(separador + 1, separador + 6);

  try {
    return combinarFechaHoraSantiago(fecha, hora);
  } catch (e) {
    throw new ErrorContextoRespuesta(
      `marca de tiempo ilegible '${marca}': ${(e as Error).message}`,
    );
  }
}

/**
 * Extrae una variable horaria como arreglo de `number | null`, validando que
 * tenga el mismo largo que `time`. Si la variable no vino (el modelo no la
 * ofrece para ese punto), devuelve `null`s — es un dato ausente, no un fallo:
 * las columnas de `contexto.clima_horario` son nullables justamente por esto.
 */
export function extraerVariable(
  bloque: BloqueHorario,
  nombre: string,
  largoEsperado: number,
): Array<number | null> {
  const crudo = bloque[nombre];
  if (crudo === undefined) {
    return new Array<number | null>(largoEsperado).fill(null);
  }
  if (!Array.isArray(crudo)) {
    throw new ErrorContextoRespuesta(`la variable '${nombre}' no es un arreglo`);
  }
  if (crudo.length !== largoEsperado) {
    throw new ErrorContextoRespuesta(
      `la variable '${nombre}' trae ${crudo.length} valores y 'time' trae ${largoEsperado}`,
    );
  }
  return (crudo as Array<number | null | string>).map((v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null,
  );
}

/** Valida y devuelve el bloque `hourly`, o falla con un mensaje que sirva. */
export function bloqueHorario(resultado: RespuestaOpenMeteo, comuna: string): BloqueHorario {
  if (resultado.error) {
    throw new ErrorContextoRespuesta(
      `Open-Meteo rechazó la consulta: ${resultado.reason ?? 'sin detalle'}`,
    );
  }
  const bloque = resultado.hourly;
  if (!bloque || !Array.isArray(bloque.time)) {
    throw new ErrorContextoRespuesta(
      `falta el bloque 'hourly' para la comuna '${comuna}'`,
    );
  }
  return bloque;
}
