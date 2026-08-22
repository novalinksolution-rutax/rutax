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
 * Los 18 ejes de estado que el producto tiene hoy, con su nombre canónico.
 *
 * Existe para que una llamada no pueda inventarse un eje: `EJE.pedido` falla al
 * compilar si se escribe mal, y `"pedido"` a mano no. Los nombres son los que
 * viajan en las claves de `CORRECCIONES_TONO`, así que un typo acá es una
 * corrección que nunca se aplica — **en silencio**. Por eso además hay una
 * prueba mecánica: `tonos-estado.test.ts` comprueba que cada clave existe de
 * verdad en el vocabulario que dice ser.
 */
export const EJE = {
  pedido: "pedido",
  retiro: "retiro",
  incidencia: "incidencia",
  manifiesto: "manifiesto",
  seller: "seller",
  geo: "geo",
  cobertura: "cobertura",
  periodo: "periodo",
  liquidacion: "liquidacion",
  payout: "payout",
  conciliacion: "conciliacion",
  categoriaConciliacion: "categoria-conciliacion",
  matchPago: "match-pago",
  cobroPeriodo: "cobro-periodo",
  suscripcion: "suscripcion",
  periodoSuscripcion: "periodo-suscripcion",
  pagoSuscripcion: "pago-suscripcion",
  mandato: "mandato",
  // Los siete que el bloque 0.3 trajo desde archivos de pantalla.
  sii: "sii",
  conexion: "conexion",
  conexionCobranza: "conexion-cobranza",
  invitacion: "invitacion",
  folio: "folio",
  certificacion: "certificacion",
  job: "job",
} as const;

export type NombreEje = (typeof EJE)[keyof typeof EJE];

/**
 * Casos donde el sistema de diseño decide un tono DISTINTO del que el código
 * aplica hoy. La clave es `eje:valor`.
 *
 * Cada corrección lleva su razón, porque sin ella la próxima persona la
 * "arregla" de vuelta.
 *
 * TRES CRITERIOS, Y TODO ACÁ SALE DE UNO DE LOS TRES
 * ---------------------------------------------------------------------------
 * 1 · **Lo que está fuera de juego a propósito va en `inert`, con trama.**
 *     Cancelado, anulado, suspendido, descartado. Hoy son gris plano y se
 *     confunden con lo que sigue vivo. La trama es lo que los distingue de un
 *     vacío en monocromo — o sea en la etiqueta térmica y para quien no
 *     distingue los grises.
 *
 * 2 · **Celebrar lo normal gasta la señal.** El rótulo de estado existe para
 *     explicar la EXCEPCIÓN. Que un seller esté activo, que una comuna tenga
 *     tarifa o que una dirección se haya ubicado es lo esperado, no un logro:
 *     va en `neutral`, y así el verde queda con fuerza para cuando importe.
 *
 * 3 · **Alarmar lo normal es peor todavía.** Un pedido sin asignar a las 10:00
 *     es el punto de partida de todos, y en ámbar la tabla entera se ve como un
 *     problema. Lo mismo el cobro recién emitido, o el pago que aún no se
 *     atribuye. `attention` significa «míralo», y si todo lo pide, nada lo pide.
 *
 * Fuente: `docs/diseno/RUTAX-REGISTRO-DE-OBJETOS.md` §.4 de cada objeto.
 */
export const CORRECCIONES_TONO: Record<string, { tono: TonoEstado; razon: string }> = {
  // ===========================================================================
  // Criterio 1 · Los que pasan a `inert`
  // ===========================================================================
  "pedido:cancelado": {
    tono: "inert",
    razon: "Fuera de juego a propósito. La trama lo distingue de un vacío en monocromo.",
  },
  "manifiesto:cancelado": {
    tono: "inert",
    razon: "Mismo caso que el pedido cancelado: existe, no se borra, y no está en juego.",
  },
  "seller:suspendido": {
    tono: "inert",
    razon: "No es una falla del sistema: es una decisión del courier. Hoy se pinta en rojo.",
  },
  "periodo:anulado": {
    tono: "inert",
    razon:
      "Una línea de dinero anulada no se borra: queda con su autor y su motivo. Registro §16.4. Hoy va en rojo, como si algo se hubiera roto.",
  },
  "match-pago:descartado": {
    tono: "inert",
    razon: "Descartado a mano y recuperable desde su cajón. No es neutro: es inerte.",
  },
  "suscripcion:cancelada": {
    tono: "inert",
    razon: "Fuera de juego, no pendiente.",
  },
  "mandato:cancelado": {
    tono: "inert",
    razon: "El mandato revocado sigue existiendo y no se puede volver a usar. Es inerte, no neutro.",
  },
  "conciliacion:ignorada": {
    tono: "inert",
    razon: "Se decidió no actuar. Distinto de resuelta y distinto de abierta.",
  },
  "invitacion:expirada": {
    tono: "inert",
    razon: "Una invitación vencida existe, no sirve y no se borra: hay que emitir otra. Distinta de una pendiente, que sigue viva.",
  },
  "invitacion:revocada": {
    tono: "inert",
    razon: "La canceló alguien a propósito. Mismo caso que la vencida, distinto origen.",
  },
  "folio:agotado": {
    tono: "inert",
    razon: "El CAF se consumió entero. No es falla: es el final normal de todo folio, y lo que bloquea es la verificación previa, no el rótulo.",
  },
  "folio:vencido": {
    tono: "inert",
    razon: "Fuera de plazo ante el SII. Hoy va en rojo, como si algo se hubiera roto; lo que hay que hacer es cargar otro CAF.",
  },
  "conexion-cobranza:revocado": {
    tono: "inert",
    razon: "El banco o el courier retiraron el permiso. Registro §12.3: desconectada va en `inert`, no en gris de pendiente.",
  },
  "conexion-cobranza:desconectado": {
    tono: "inert",
    razon: "Nunca se conectó o se desconectó a propósito. Registro §12.3.",
  },

  // ===========================================================================
  // Criterio 2 · Lo normal no se celebra
  // ===========================================================================
  "seller:activo": {
    tono: "neutral",
    razon: "Que un seller esté activo es lo normal, no un logro. Hoy va en verde.",
  },
  "retiro:retirado": {
    tono: "neutral",
    razon:
      "Retirar es lo esperado, no un logro: el 100 % de lo que sale a ruta pasó por acá. Registro §1.4 eje 2.",
  },
  "geo:resuelto": {
    tono: "neutral",
    razon:
      "El diseño ni siquiera marca la dirección ubicada: el silencio es el estado normal. Registro §1.4 eje 3.",
  },
  "cobertura:tarifada": {
    tono: "neutral",
    razon: "Que la comuna tenga tarifa es la condición para operar, no una buena noticia.",
  },

  // ===========================================================================
  // Criterio 3 · Lo normal tampoco se alarma
  // ===========================================================================
  "pedido:pendiente_asignacion": {
    tono: "neutral",
    razon:
      "Sin asignar es el punto de partida de todo pedido. Hoy va en ámbar, y a las 10:00 la tabla entera se ve como un problema.",
  },
  "pedido:asignado": {
    tono: "neutral",
    razon:
      "Asignado todavía no salió: el bulto sigue en la bodega. El avance real empieza en ruta, y solo ahí va `progress`. Registro §1.4 eje 1.",
  },
  "pedido:devuelto": {
    tono: "neutral",
    razon: "Devuelto al seller es un desenlace válido y cerrado, no algo que mirar.",
  },
  "seller:invitado": {
    tono: "neutral",
    razon: "Una invitación pendiente no es una advertencia: es un estado normal con vencimiento.",
  },
  "retiro:pendiente": {
    tono: "neutral",
    razon:
      "Ninguna situación de retiro es alarma. Pendiente es lo que la plataforma tiene por retirar: la mañana entera está así.",
  },
  "manifiesto:borrador": {
    tono: "neutral",
    razon:
      "Un manifiesto en borrador es el estado en que nace. El conductor lo ve como «tu ruta se está armando», no como un aviso.",
  },
  "match-pago:sin_atribuir": {
    tono: "neutral",
    razon:
      "Un movimiento bancario recién leído está sin atribuir por definición. Registro §18.4.",
  },
  "cobro-periodo:pendiente": {
    tono: "neutral",
    razon:
      "Un cobro recién emitido está pendiente hasta que lo paguen. En ámbar, el día de facturar la tabla entera se ve rota.",
  },
  "conciliacion:esperando_info": {
    tono: "neutral",
    razon:
      "Esperando a un tercero no es accionable por quien mira: no hay nada que hacer hasta que conteste. Registro §17.4.",
  },
  "invitacion:pendiente": {
    tono: "neutral",
    razon:
      "Una invitación recién enviada tiene 7 días por delante. En ámbar, la columna de un equipo nuevo se ve entera como un problema. Registro §9.3.",
  },
  "invitacion:aceptada": {
    tono: "neutral",
    razon:
      "Que la acepten es lo que se espera que pase, y desde ese momento la persona ya es un usuario activo — que también va en `neutral`. Registro §9.3.",
  },
  "geo:fuera_cobertura": {
    tono: "attention",
    razon:
      "Nada se rompió: la dirección se ubicó bien y lo que falta es cobertura del courier. Es el mismo caso que `cobertura:sin_tarifa_zona`, que ya va en `attention`; tenerlos en tonos distintos era incoherente.",
  },

  // ===========================================================================
  // Correcciones que SUBEN de intensidad
  // ===========================================================================
  "sii:pendiente": {
    tono: "progress",
    razon:
      "El documento ya salió y está esperando respuesta del SII: es un trámite en curso, no un estado quieto. Registro §14.4, donde el valor se llama «enviado».",
  },
  "suscripcion:trial": {
    tono: "attention",
    razon:
      "Una prueba tiene fecha de término y exige elegir plan antes. `progress` la pinta como si avanzara sola. Registro §13.4.",
  },
  "suscripcion:suspendida": {
    tono: "fault",
    razon:
      "Suspendida es a los 60 días de mora y el courier deja de operar. `attention` no alcanza para eso. Registro §13.4.",
  },
};

/**
 * DECISIONES DELIBERADAS QUE NO SON CORRECCIONES — no las "arregles"
 * ---------------------------------------------------------------------------
 * · `incidencia:abierta` se queda en `fault`. La regla 67 del sistema reserva
 *   el rojo de la Torre de control a la incidencia abierta: es lo único
 *   accionable de esa pantalla, y bajarlo a `attention` la deja sin su única
 *   señal.
 *
 * · `geo:pendiente` se queda en `neutral`. Es «ubicando dirección…», o sea un
 *   trabajo en curso del sistema, no algo que el usuario tenga que mirar.
 *
 * · `retiro:no_procesado` se queda en `neutral`, y **ya sale así solo**: no
 *   lleva entrada en la tabla porque sería un no-op. La razón se escribe igual,
 *   porque es contraintuitiva y alguien la va a querer subir a `attention`: no
 *   retirar no es falla — la mitad de los candidatos que la plataforma ingesta
 *   termina así. La prueba `tonos-estado.test.ts` rechaza las correcciones que
 *   no cambian nada, justamente para que la tabla no se llene de decisiones
 *   aparentes.
 *
 * · `mandato:activo` se queda en `balanced`. Acá el verde sí informa: sin
 *   mandato activo el cobro automático no corre, así que su presencia es el
 *   hecho relevante, no el ruido de fondo.
 *
 * LO QUE ESTA TABLA NO PUEDE EXPRESAR, Y HAY QUE RESOLVER EN LA PANTALLA
 * ---------------------------------------------------------------------------
 * · El registro (§17.4) dice que una excepción abierta va en `fault` **si es de
 *   las 3 categorías de fuga** y en `attention` si es de las otras 15. Eso
 *   depende de DOS ejes a la vez —estado y categoría— y esta tabla es de uno
 *   solo. `conciliacion:pendiente` queda en `attention`, que es el caso mayoría,
 *   y la elevación a `fault` la tiene que hacer la pantalla de conciliación
 *   cuando conozca la categoría. Va con el bloque 5.
 *
 * · `categoria-conciliacion` NO es un eje de ciclo: es una clasificación. Por la
 *   regla 69 —solo el eje de ciclo usa distintivo con color— no debería
 *   renderizarse como distintivo teñido. Cambiarlo es trabajo de pantalla, no de
 *   esta tabla.
 */

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
