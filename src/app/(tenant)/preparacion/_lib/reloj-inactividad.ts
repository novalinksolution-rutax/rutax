/**
 * Reloj de inactividad de una visita de retiro — lógica PURA, sin React.
 * =============================================================================
 *
 * Ver docs/ux/etapa-5-preparacion-del-dia.md §6. El problema que resuelve: la
 * pantalla se refresca por señal de Realtime (cada escaneo dispara un
 * `router.refresh()`), pero un conductor que DEJÓ de escanear no genera ningún
 * evento — así que nada dispara un refresco, y "hace 3 min" se quedaría
 * congelado para siempre si el cálculo se hiciera solo en el servidor. El caso
 * que más importa (un conductor parado) es justo el que menos señales produce.
 *
 * Por eso vive en un módulo aparte, con el reloj INYECTABLE (`ahoraMs`): el
 * componente cliente (`_componentes/reloj-visita.tsx`) llama a estas funciones
 * cada 30 s con `Date.now()`, y las pruebas las llaman con instantes fijos.
 * Sacar la lógica de un `.tsx` es lo que la vuelve verificable — Vitest corre
 * en entorno `node` y solo recoge `src/**\/*.test.ts` (ver `vitest.config.ts`):
 * nada que viva dentro de un componente se puede probar.
 */

import { horaLocalEnSantiago } from "@/lib/fecha-santiago";

/**
 * Minutos desde la última señal (escaneo, o apertura si todavía no hay
 * ninguno) a partir de los cuales una visita ABIERTA se considera "sin
 * novedades". El escaneo en bodega es en ráfaga (cooldown de ~800 ms por
 * bulto): un conductor activo no genera silencios de varios minutos solo por
 * acomodar cajas o hablar con el seller. Diez minutos es largo comparado con
 * el ritmo real de escaneo y corto comparado con las ~5-6 horas de la ventana
 * de retiro. Mismo criterio de constante nombrada que
 * `UMBRAL_GEOCODING_RANCIO_MINUTOS` / `UMBRAL_INCIDENCIA_SIN_GESTION_HORAS`
 * en `src/lib/ui/traduccion-estados.ts`.
 */
export const UMBRAL_RETIRO_SIN_NOVEDADES_MINUTOS = 10;

export interface EntradaReloj {
  /** ISO. `null` si la visita todavía no registra ningún escaneo. */
  ultimoEscaneoEn: string | null;
  /** ISO. Hora de apertura — la señal de vida cuando no hay escaneos aún. */
  abiertaEn: string;
  /** `Date.now()` en producción; un instante fijo inyectado en las pruebas. */
  ahoraMs: number;
}

export interface EstadoReloj {
  /** Una de las cuatro plantillas de §6, ya con el tiempo relativo adentro. */
  texto: string;
  /** `true` = ámbar (superó el umbral). NUNCA rojo: esto no es una incidencia. */
  enAviso: boolean;
  /** ISO de la señal usada — para el `title` con la hora exacta (§6, a11y). */
  senalEn: string;
}

/** `ultimoEscaneoEn` si existe; si no, `abiertaEn` — "cuándo llegó" es la señal de vida inicial. */
export function ultimaSenalDe(entrada: Pick<EntradaReloj, "ultimoEscaneoEn" | "abiertaEn">): string {
  return entrada.ultimoEscaneoEn ?? entrada.abiertaEn;
}

/**
 * Duración relativa, SIN el prefijo "hace": lo agregan las cuatro plantillas
 * de `calcularEstadoReloj`, que lo usan en distinta posición de la frase (ver
 * el wireframe de §9: "Sin escaneos hace 14 min", "Último escaneo hace 2 min").
 *
 * `< 1 min` → "instantes" · `1-59 min` → "N min" · `>= 60 min` → "H h" o
 * "H h M min" si sobran minutos.
 */
export function formatearDuracion(ms: number): string {
  const minutosTotales = Math.floor(Math.max(0, ms) / 60_000);
  if (minutosTotales < 1) return "instantes";
  if (minutosTotales < 60) return `${minutosTotales} min`;
  const horas = Math.floor(minutosTotales / 60);
  const minutosRestantes = minutosTotales % 60;
  return minutosRestantes > 0 ? `${horas} h ${minutosRestantes} min` : `${horas} h`;
}

/**
 * `true` si una visita ABIERTA superó el umbral de inactividad. El servidor
 * (para clasificar la pantalla y contar "sin novedades" en la franja) y el
 * cliente (para el color del reloj de cada tarjeta) comparten esta misma
 * cuenta — un solo lugar donde se decide "cuánto es demasiado".
 */
export function visitaSuperaUmbral(entrada: EntradaReloj): boolean {
  const senalMs = new Date(ultimaSenalDe(entrada)).getTime();
  const minutos = (entrada.ahoraMs - senalMs) / 60_000;
  return minutos > UMBRAL_RETIRO_SIN_NOVEDADES_MINUTOS;
}

/**
 * El texto y el color del reloj de una visita ABIERTA — las cuatro
 * combinaciones de §6, nunca más:
 *
 * |                        | bajo el umbral (gris)     | sobre el umbral (ámbar)                |
 * |------------------------|----------------------------|-----------------------------------------|
 * | ya hay escaneos        | `Último escaneo hace {t}`  | `Sin escaneos hace {t}`                 |
 * | sin escaneos todavía   | `En la bodega hace {t}`    | `Sin escaneos hace {t}, desde que llegó` |
 */
export function calcularEstadoReloj(entrada: EntradaReloj): EstadoReloj {
  const senalEn = ultimaSenalDe(entrada);
  const hayEscaneos = entrada.ultimoEscaneoEn !== null;
  const enAviso = visitaSuperaUmbral(entrada);
  const t = formatearDuracion(entrada.ahoraMs - new Date(senalEn).getTime());

  let texto: string;
  if (hayEscaneos && !enAviso) texto = `Último escaneo hace ${t}`;
  else if (hayEscaneos && enAviso) texto = `Sin escaneos hace ${t}`;
  else if (!hayEscaneos && !enAviso) texto = `En la bodega hace ${t}`;
  else texto = `Sin escaneos hace ${t}, desde que llegó`;

  return { texto, enAviso, senalEn };
}

/**
 * `Cerrada a las HH:MM`, con la hora de SANTIAGO explícita — nunca la del
 * navegador (§6: "un dueño mirando desde el teléfono en otro huso no debe ver
 * una hora corrida"). Reusa `horaLocalEnSantiago` (`src/lib/fecha-santiago.ts`)
 * en vez de un `Intl.DateTimeFormat` propio: es la misma fuente que usa el
 * resto del repo para esta conversión.
 */
export function textoCerradaA(cerradaEnIso: string): string {
  return `Cerrada a las ${horaLocalEnSantiago(new Date(cerradaEnIso))}`;
}
