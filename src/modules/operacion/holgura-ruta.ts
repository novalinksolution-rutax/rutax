/**
 * La holgura de una ruta contra el corte de las 21:00.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * PARA QUÉ EXISTE
 * -----------------------------------------------------------------------------
 * El coordinador reordena paradas y ve cambiar los kilómetros. Los kilómetros no
 * son la pregunta: **la pregunta es si el conductor alcanza a cerrar**. Sin esto
 * la pantalla dice «+13,4 km» y deja al coordinador decidiendo si eso rompe el
 * turno, que es justo la cuenta que no puede hacer de cabeza a las 15:50.
 *
 * -----------------------------------------------------------------------------
 * LOS SUPUESTOS VAN ESCRITOS EN LA PANTALLA, NO ESCONDIDOS ACÁ
 * -----------------------------------------------------------------------------
 * Es la misma regla que se aplicó al cálculo de conductores necesarios de la
 * Preparación del día: **una estimación con los supuestos escondidos se lee como
 * una instrucción**. Por eso el resultado devuelve los dos supuestos junto al
 * número, para que la pantalla los muestre al lado y no haya forma de mostrar
 * uno sin el otro.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ LA DISTANCIA SOLO ENTRA EN EL DELTA
 * -----------------------------------------------------------------------------
 * Los 12 min por parada salen de la operación real que describió el courier
 * —«~5–6 h para 25–30 paradas»— y por lo tanto **ya incluyen el viaje típico
 * entre paradas**. Sumarle encima el tiempo de TODOS los kilómetros contaría el
 * traslado dos veces y produciría un cierre a medianoche para una ruta normal.
 *
 * Lo que sí es honesto medir es el **cambio**: cuánto viaje agrega o quita el
 * reordenamiento respecto del orden que ya está guardado. Los dos lados de esa
 * resta se miden igual —en línea recta, con la misma función— así que el delta
 * es comparable aunque el absoluto quede corto frente a la calle real.
 *
 * -----------------------------------------------------------------------------
 * LA VELOCIDAD ES «EQUIVALENTE EN LÍNEA RECTA», Y POR ESO ES BAJA
 * -----------------------------------------------------------------------------
 * 15 km/h no es la velocidad de la camioneta: es la que hay que usar cuando la
 * distancia se midió en línea recta. La calle real de Santiago da vueltas —del
 * orden de 1,3 veces la recta— y en hora punta se avanza a unos 20 km/h. La
 * combinación deja ~15 km/h de recta. Poner los 20 acá subestimaría el efecto de
 * cada cambio en un tercio, que es justo el error que hace inútil el aviso.
 */

/**
 * Minutos por parada, de punta a punta: llegar, estacionar, entregar, firmar y
 * salir. Sale de la operación real del courier (~5–6 h para 25–30 paradas).
 *
 * Vive acá —en un módulo puro y sin dependencias— porque lo consumen tanto el
 * servidor (`retiro/expectativa.ts`) como el navegador (el panel de ruta).
 */
export const MINUTOS_POR_PARADA = 12;

/** Velocidad equivalente cuando la distancia se midió en línea recta. */
export const KMH_LINEA_RECTA = 15;

/** El despacho no arranca antes de esto, aunque la ruta se ordene a las 11:00. */
export const HORA_DESPACHO = 16;

/** El corte del día. Después de esta hora no se entrega. */
export const HORA_CORTE = 21;

export interface HolguraRuta {
  /** Minutos desde medianoche en que se estima cerrar la última parada. */
  cierreEstimadoMin: number;
  /** Margen contra el corte, en minutos. Negativo = se pasa del corte. */
  margenMin: number;
  /**
   * Cuántos minutos agrega (o quita) el reordenamiento propuesto respecto del
   * orden guardado. `null` cuando no hay distancias que comparar.
   */
  minutosDelCambio: number | null;
  /** Los supuestos, para que la pantalla los muestre al lado del número. */
  supuestos: { minutosPorParada: number; kmhLineaRecta: number };
}

export interface EntradaHolgura {
  /** Paradas que el conductor todavía no cierra. Las cerradas ya no cuestan. */
  paradasAbiertas: number;
  /** Metros del orden guardado. `null` = sin bodega de origen o sin medir. */
  metrosGuardados: number | null;
  /** Metros del orden que el coordinador tiene en pantalla. */
  metrosPropuestos: number | null;
  /** Minutos desde medianoche, hora de Santiago. */
  ahoraMin: number;
}

/**
 * Cuándo cierra esta ruta y cuánto margen queda.
 *
 * Devuelve `null` cuando no hay nada que estimar: sin paradas abiertas la ruta
 * ya está cerrada y un «cierra a las 18:40» sería una cifra inventada sobre un
 * conductor que se fue a la casa.
 */
export function calcularHolguraRuta(entrada: EntradaHolgura): HolguraRuta | null {
  if (entrada.paradasAbiertas <= 0) return null;

  // Antes de las 16:00 la ruta no ha salido: el reloj de la estimación arranca
  // en el despacho, no ahora. Reordenar a las 11:00 no adelanta ninguna entrega.
  const arranqueMin = Math.max(entrada.ahoraMin, HORA_DESPACHO * 60);

  const minutosDelCambio =
    entrada.metrosGuardados !== null && entrada.metrosPropuestos !== null
      ? Math.round(
          ((entrada.metrosPropuestos - entrada.metrosGuardados) / 1000 / KMH_LINEA_RECTA) * 60,
        )
      : null;

  const cierreEstimadoMin =
    arranqueMin + entrada.paradasAbiertas * MINUTOS_POR_PARADA + (minutosDelCambio ?? 0);

  return {
    cierreEstimadoMin,
    margenMin: HORA_CORTE * 60 - cierreEstimadoMin,
    minutosDelCambio,
    supuestos: { minutosPorParada: MINUTOS_POR_PARADA, kmhLineaRecta: KMH_LINEA_RECTA },
  };
}

/**
 * «21:00» a partir de minutos desde medianoche, **con vuelta de reloj**.
 *
 * La primera versión seguía contando y escribía «25:43». Se vio en pantalla y no
 * se lee: nadie mira un reloj de 25 horas. La magnitud del exceso ya la dice la
 * frase de margen («4 h 43 después del corte»), así que acá corresponde una hora
 * de verdad — y el `cruzaMedianoche` es para que la pantalla pueda escribir «de
 * mañana» y no deje un «01:43» que parece del mismo día.
 */
export function formatearHoraDeMinutos(minutos: number): {
  hora: string;
  cruzaMedianoche: boolean;
} {
  const normalizados = Math.max(0, Math.round(minutos));
  const h = Math.floor(normalizados / 60);
  const m = normalizados % 60;
  return {
    hora: `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    cruzaMedianoche: h >= 24,
  };
}

/** «1 h 20» / «40 min». Para el margen, que casi siempre pasa de la hora. */
export function formatearDuracionCorta(minutos: number): string {
  const abs = Math.abs(Math.round(minutos));
  if (abs < 60) return `${abs} min`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

/**
 * Minutos desde medianoche **en Santiago**, no en el reloj de quien mira.
 *
 * `es-CL` fija el formato y NO el huso: un `getHours()` a secas responde contra
 * la zona del runtime, y en el servidor de Vercel eso es UTC. Es el mismo error
 * que mordió en diez sitios a la vez el 2026-08-16.
 */
export function minutosSantiagoAhora(ahora: Date = new Date()): number {
  const partes = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(ahora);
  const valor = (tipo: string) =>
    Number.parseInt(partes.find((p) => p.type === tipo)?.value ?? "0", 10);
  return valor("hour") * 60 + valor("minute");
}
