/**
 * Traducción del estado del canal de Realtime a lo que ve el usuario.
 * =====================================================================
 *
 * POR QUÉ ESTO NO ES UN `=== "SUBSCRIBED"` SUELTO DENTRO DEL COMPONENTE.
 *
 * El indicador vivía pintándose de verde con `status === "SUBSCRIBED"` y
 * tratando TODO lo demás como "Conectando…". Dos problemas, los dos reales:
 *
 * 1. `CHANNEL_ERROR`, `TIMED_OUT` y `CLOSED` son estados TERMINALES: el canal ya
 *    no va a conectar solo. Mostrarlos como "Conectando…" es prometer que algo
 *    está en curso cuando no lo está, y deja al coordinador esperando para
 *    siempre una actualización que no va a llegar.
 * 2. `SUBSCRIBED` significa "el canal se unió al tema", NO "van a llegar
 *    eventos". El 2026-08-14 se comprobó que con el socket autenticado como
 *    `anon` el canal reporta `SUBSCRIBED` igual, mientras el servidor descarta
 *    la suscripción por RLS y no manda absolutamente nada. Por eso el verde
 *    exige ADEMÁS que el token del usuario esté propagado al socket — ver
 *    `crearClienteConRealtimeAutenticado` en `src/lib/supabase/client.ts`.
 *
 * Vive en un `.ts` aparte, y no dentro del `.tsx`, porque Vitest corre en
 * entorno `node` y solo recoge `src/**´/*.test.ts`: lo que queda dentro de un
 * componente no se puede probar. Es la misma lección que dejó el debounce sin
 * tope de `programador-refresco.ts`.
 */

/** Los estados que emite `channel.subscribe()` en supabase-js. */
export type EstadoCanalRealtime = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

export type EstadoEnVivo = "conectando" | "en_vivo" | "sin_actualizacion";

export interface PresentacionEnVivo {
  estado: EstadoEnVivo;
  etiqueta: string;
  /** Texto del `title`: explica qué hacer, no solo qué pasa. */
  detalle: string;
}

export const PRESENTACION_EN_VIVO: Record<EstadoEnVivo, PresentacionEnVivo> = {
  conectando: {
    estado: "conectando",
    etiqueta: "Conectando…",
    detalle: "Estableciendo la conexión para actualizar esta pantalla sola.",
  },
  en_vivo: {
    estado: "en_vivo",
    etiqueta: "En vivo",
    detalle: "Esta pantalla se actualiza sola a medida que cambian los datos.",
  },
  sin_actualizacion: {
    estado: "sin_actualizacion",
    etiqueta: "Sin actualización automática",
    detalle: "No pudimos mantener la conexión. Recarga la página para ver los datos al día.",
  },
};

/**
 * Traduce el estado del canal. `autenticado = false` gana sobre cualquier
 * estado: sin el token del usuario en el socket, el servidor descarta la
 * suscripción y da igual lo que diga el canal.
 */
export function interpretarEstadoCanal(
  estado: EstadoCanalRealtime | null,
  autenticado: boolean,
): PresentacionEnVivo {
  if (!autenticado) return PRESENTACION_EN_VIVO.sin_actualizacion;
  if (estado === null) return PRESENTACION_EN_VIVO.conectando;
  if (estado === "SUBSCRIBED") return PRESENTACION_EN_VIVO.en_vivo;
  // CHANNEL_ERROR · TIMED_OUT · CLOSED — terminales, no "en curso".
  return PRESENTACION_EN_VIVO.sin_actualizacion;
}
