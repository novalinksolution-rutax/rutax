/**
 * Contrato de degradación de los puertos de contexto.
 * =====================================================================
 *
 * Regla no negociable de §6 del diseño: *"todo puerto degrada, nunca revienta.
 * Si la fuente falla, la capa se marca 'sin datos' en la UI y el resto del
 * módulo sigue funcionando."*
 *
 * Por eso los puertos NO devuelven `T` ni lanzan ante un fallo del proveedor:
 * devuelven `ResultadoContexto<T>`, un tipo que sabe decir "no pude" sin lanzar.
 * El job de A4 hace `if (!res.ok)` y escribe el estado degradado en
 * `contexto.fuentes_estado` en vez de tumbarse.
 *
 * DOS TEXTOS, DOS AUDIENCIAS — no mezclarlos nunca:
 *   · `motivo`         → va a `contexto.fuentes_estado.motivo`, que un
 *                        COORDINADOR lee en la barra de frescura. Es copy, no
 *                        un stack trace. Redactado, en español, sin jerga HTTP.
 *   · `detalleTecnico` → va al log / a Sentry. Saneado (nunca una URL con
 *                        credenciales, nunca un token), pero técnico.
 *
 * El copy definitivo de `motivo` es competencia de `copywriter` (la propia
 * migración `20260725000001_contexto_torre_de_control.sql` lo deja dicho al
 * sembrar las 5 filas). Lo de aquí es provisional y deliberadamente conservador:
 * dice qué pasó y qué va a ocurrir, sin prometer nada.
 */

/** Éxito: hay datos utilizables. */
export interface ContextoOk<T> {
  ok: true;
  datos: T;
  /** Instante en que se obtuvo. Alimenta `contexto.fuentes_estado.actualizado_en`. */
  obtenidoEn: Date;
}

/**
 * Fallo: no hay datos. NO es una excepción — es un valor de retorno legítimo.
 * El llamador escribe `estado` + `motivo` en `contexto.fuentes_estado` y sigue.
 */
export interface ContextoFallo {
  ok: false;
  /** Texto REDACTADO para el usuario final (coordinador). Va a la BD. */
  motivo: string;
  /** Texto técnico SANEADO. Va al log, nunca a la pantalla. */
  detalleTecnico: string;
  /** `true` si el próximo ciclo tiene chance de funcionar sin intervención. */
  reintentable: boolean;
}

export type ResultadoContexto<T> = ContextoOk<T> | ContextoFallo;

/**
 * Catálogo de motivos redactados. Constantes con nombre en vez de literales
 * dispersos: si `copywriter` reescribe uno, se reescribe en un solo lugar y los
 * tests siguen verdes.
 *
 * `{fuente}` se sustituye con el nombre humano de la fuente ("clima",
 * "calidad del aire", "feriados").
 */
export const MOTIVOS_DEGRADACION = {
  /** Timeout o red caída. */
  sinRespuesta: (fuente: string) =>
    `La fuente de ${fuente} no respondió a tiempo. Se reintentará en el próximo ciclo.`,
  /** 5xx / 429 persistente tras los reintentos. */
  errorProveedor: (fuente: string) =>
    `El proveedor de ${fuente} respondió con error en los últimos intentos. Se reintentará en el próximo ciclo.`,
  /** 4xx distinto de 429: la petición está mal, reintentar no ayuda. */
  peticionRechazada: (fuente: string) =>
    `La consulta a la fuente de ${fuente} fue rechazada. Requiere revisión técnica.`,
  /** El cuerpo llegó pero no tiene la forma esperada. */
  respuestaIlegible: (fuente: string) =>
    `La fuente de ${fuente} entregó datos que no se pudieron interpretar. Requiere revisión técnica.`,
  /** Variable de entorno mal puesta. */
  malConfigurada: (fuente: string) =>
    `La fuente de ${fuente} no está configurada correctamente. Requiere revisión técnica.`,
} as const;

/** Construye un resultado exitoso. `obtenidoEn` por defecto es ahora. */
export function exito<T>(datos: T, obtenidoEn: Date = new Date()): ContextoOk<T> {
  return { ok: true, datos, obtenidoEn };
}

/** Construye un fallo degradado. */
export function fallo(
  motivo: string,
  detalleTecnico: string,
  reintentable: boolean,
): ContextoFallo {
  return { ok: false, motivo, detalleTecnico, reintentable };
}

/**
 * Recorta y limpia un texto antes de meterlo en `detalleTecnico`.
 *
 * Dos cosas, ambas por la regla dura del proyecto (secretos jamás en logs):
 *   1. Enmascara cualquier `apikey=`, `key=`, `token=` o `access_token=` que
 *      venga incrustado en el texto (típicamente porque alguien citó una URL).
 *      Ninguna de las tres fuentes de este módulo usa key hoy; esto existe
 *      porque el tier comercial de Open-Meteo la pasa por query string.
 *   2. Trunca: un cuerpo de error de 200 KB no aporta más que sus primeros
 *      300 caracteres y sí llena el log.
 */
export function sanearParaMensaje(texto: string, largoMaximo = 300): string {
  const enmascarado = texto.replace(
    /\b(apikey|api_key|key|token|access_token|secret)=([^&\s"']+)/gi,
    '$1=[REDACTADO]',
  );
  return enmascarado.length > largoMaximo
    ? `${enmascarado.slice(0, largoMaximo)}…`
    : enmascarado;
}

/**
 * Traduce cualquier excepción a un fallo degradado. Es la red de seguridad del
 * llamador: A4 envuelve la fábrica del puerto (que SÍ lanza ante configuración
 * inválida) con esto y nunca tumba el job.
 *
 * ```ts
 * let puerto: PuertoClima;
 * try { puerto = obtenerPuertoClima(); }
 * catch (e) { return degradarDesdeError(e, 'clima'); }
 * ```
 */
export function degradarDesdeError(error: unknown, fuente: string): ContextoFallo {
  const mensaje = error instanceof Error ? error.message : String(error);
  const reintentable =
    typeof error === 'object' &&
    error !== null &&
    'reintentable' in error &&
    (error as { reintentable?: unknown }).reintentable === true;

  return fallo(
    reintentable
      ? MOTIVOS_DEGRADACION.errorProveedor(fuente)
      : MOTIVOS_DEGRADACION.malConfigurada(fuente),
    sanearParaMensaje(mensaje),
    reintentable,
  );
}
