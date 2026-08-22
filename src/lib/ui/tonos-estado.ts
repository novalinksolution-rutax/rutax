/**
 * tonos-estado.ts — el vocabulario de seis tonos del sistema de diseño Rutax.
 *
 * QUÉ ES Y POR QUÉ REEMPLAZA AL MODELO ANTERIOR
 * ---------------------------------------------------------------------------
 * `traduccion-estados.ts` tiene hoy seis variantes heredadas de shadcn —
 * `neutral · info · exito · advertencia · error · marca`— y sostiene 29 ejes de
 * estado con ~147 valores. El problema no es la cantidad: es que **le falta un
 * tono**. No hay forma de decir "esto existe pero está fuera de juego a
 * propósito", así que hoy `cancelado`, `anulada`, `suspendido` y `descartado`
 * se pintan de gris igual que "pendiente", que es un estado vivo.
 *
 * El sistema nuevo agrega `inert`, y con él la trama diagonal. Esa trama es lo
 * que hace que un cancelado se distinga de un vacío **en monocromo** — o sea,
 * en la etiqueta térmica y para quien no distingue color.
 *
 * LOS SEIS TONOS, en el orden en que hay que pensarlos:
 *   balanced   terminó bien, cuadra
 *   progress   en curso, avanzando
 *   attention  míralo, NO es error
 *   fault      se rompió, hay que actuar
 *   neutral    existe, sin juicio
 *   inert      fuera de juego a propósito · SIEMPRE con trama
 *
 * CÓMO CONVIVE CON LO QUE YA EXISTE
 * ---------------------------------------------------------------------------
 * Los ~24 mapas `VARIANTE_*` de `traduccion-estados.ts` siguen funcionando: se
 * traducen solos con `tonoDesdeVariante`. Encima se aplica una tabla de
 * correcciones para los casos donde el sistema de diseño decidió otra cosa que
 * lo que el código hace hoy. Nada se rompe, y ninguna pantalla hay que tocar.
 *
 * Fuente: `docs/diseno/RUTAX-REGISTRO-DE-OBJETOS.md` (18 objetos con sus
 * estados) y `docs/diseno/tokens.css` (los tonos y la trama).
 */

// =============================================================================
// 1 · El vocabulario
// =============================================================================

export const TONOS_ESTADO = [
  "balanced",
  "progress",
  "attention",
  "fault",
  "neutral",
  "inert",
] as const;

export type TonoEstado = (typeof TONOS_ESTADO)[number];

/**
 * Clases de cada tono. Consumen los tokens `--rx-*` que expone `rx-puente.css`,
 * así que cambian solos entre los cuatro temas sin que nadie los recalcule.
 *
 * `inert` NO lleva color de fondo: lleva la trama, que es una imagen. Por eso
 * usa la utilidad `rx-inert` en vez de un `bg-*`.
 */
export const CLASES_TONO: Record<TonoEstado, string> = {
  balanced: "bg-balanced-bg text-balanced-fg border-balanced-line",
  progress: "bg-progress-bg text-progress-fg border-progress-line",
  attention: "bg-attention-bg text-attention-fg border-attention-line",
  fault: "bg-fault-bg text-fault-fg border-fault-line",
  neutral: "bg-neutralst-bg text-neutralst-fg border-neutralst-line",
  inert: "rx-inert",
};

/**
 * Glifo de cada tono. El color NUNCA puede ser el único portador de
 * significado: el glifo es la segunda señal y la etiqueta la tercera.
 *
 * Son nombres de ícono de `lucide-react`. Se resuelven en el componente para no
 * arrastrar el peso de la librería a los módulos que solo necesitan el tono.
 */
export const GLIFO_TONO: Record<TonoEstado, string> = {
  balanced: "Check",
  progress: "ArrowRight",
  attention: "AlertTriangle",
  fault: "XCircle",
  neutral: "Minus",
  inert: "Slash",
};

// =============================================================================
// 2 · Puente desde el modelo anterior
// =============================================================================

/** Las seis variantes que usa hoy `traduccion-estados.ts`. */
export type VarianteHeredada =
  | "neutral"
  | "info"
  | "exito"
  | "advertencia"
  | "error"
  | "marca";

/**
 * Traducción mecánica de la variante heredada al tono nuevo.
 *
 * Cinco de las seis tienen equivalente exacto. `marca` no lo tiene: en el
 * sistema nuevo el acento es la ACCIÓN, no un estado, así que un estado que hoy
 * se pinta de marca cae a `neutral` — que es lo correcto: "existe, sin juicio".
 */
const VARIANTE_A_TONO: Record<VarianteHeredada, TonoEstado> = {
  exito: "balanced",
  info: "progress",
  advertencia: "attention",
  error: "fault",
  neutral: "neutral",
  marca: "neutral",
};

export function tonoDesdeVariante(variante: VarianteHeredada): TonoEstado {
  return VARIANTE_A_TONO[variante];
}

// =============================================================================
// 3 · Correcciones del sistema de diseño
// =============================================================================

/**
 * Casos donde el sistema de diseño decide un tono DISTINTO del que el código
 * aplica hoy. La clave es `eje:valor`.
 *
 * Cada corrección lleva su razón, porque sin ella la próxima persona la
 * "arregla" de vuelta.
 */
export const CORRECCIONES_TONO: Record<string, { tono: TonoEstado; razon: string }> = {
  // --- Los que pasan a `inert` ---------------------------------------------
  // Todos comparten la misma naturaleza: existen, no se borran, y están fuera
  // de juego a propósito. Hoy son gris plano y se confunden con lo que sigue
  // vivo.
  "pedido:cancelado": {
    tono: "inert",
    razon: "Fuera de juego a propósito. La trama lo distingue de un vacío en monocromo.",
  },
  "seller:suspendido": {
    tono: "inert",
    razon: "No es una falla del sistema: es una decisión del courier. Hoy se pinta en rojo.",
  },
  "match-pago:descartado": {
    tono: "inert",
    razon: "Descartado a mano y recuperable desde su cajón. No es neutro: es inerte.",
  },
  "suscripcion:cancelada": {
    tono: "inert",
    razon: "Fuera de juego, no pendiente.",
  },
  "conciliacion:ignorada": {
    tono: "inert",
    razon: "Se decidió no actuar. Distinto de resuelta y distinto de abierta.",
  },

  // --- Correcciones de intensidad ------------------------------------------
  // El sistema es explícito: el rótulo de estado existe para explicar la
  // EXCEPCIÓN. Celebrar en verde lo que es simplemente lo normal gasta la
  // señal, y deja sin fuerza al verde cuando de verdad importa.
  "seller:activo": {
    tono: "neutral",
    razon: "Que un seller esté activo es lo normal, no un logro. Hoy va en verde.",
  },
  "seller:invitado": {
    tono: "neutral",
    razon: "Una invitación pendiente no es una advertencia: es un estado normal con vencimiento.",
  },
  "pedido:pendiente_asignacion": {
    tono: "neutral",
    razon: "Sin asignar es el punto de partida de todo pedido. Hoy va en ámbar, y a las 10:00 la tabla entera se ve como un problema.",
  },
  "pedido:devuelto": {
    tono: "neutral",
    razon: "Devuelto al seller es un desenlace válido y cerrado, no algo que mirar.",
  },
  // Ninguna situación de retiro es alarma: que un paquete no se retire es el
  // desenlace normal de la mitad de los candidatos que la plataforma ingesta.
  "retiro:no_procesado": {
    tono: "neutral",
    razon: "No retirar no es falla: la mitad de los candidatos ingestados termina así.",
  },
};

/**
 * Resuelve el tono de un valor de estado.
 *
 * @param eje    Nombre corto del eje: `pedido`, `seller`, `liquidacion`…
 * @param valor  El valor literal del enum, tal como viene de la base.
 * @param heredada Variante que el mapa antiguo asigna hoy. Se usa como base
 *                 cuando no hay corrección declarada.
 */
export function tonoDeEstado(
  eje: string,
  valor: string,
  heredada: VarianteHeredada
): TonoEstado {
  return CORRECCIONES_TONO[`${eje}:${valor}`]?.tono ?? tonoDesdeVariante(heredada);
}

/**
 * ¿Este tono exige la trama? Solo `inert`, y no es negociable: es lo que lo
 * hace legible sin color.
 */
export function exigeTrama(tono: TonoEstado): boolean {
  return tono === "inert";
}
