"use client";

/**
 * `línea de tiempo pública` — el flujo de la entrega, dibujado.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUIÉN LA MIRA, Y POR QUÉ ESO CAMBIA TODO
 * -----------------------------------------------------------------------------
 * La abre **el comprador de una tienda**, desde WhatsApp, en un teléfono, con
 * mala señal, y normalmente estando en la calle. No tiene cuenta, no sabe qué
 * es un courier y no le puede preguntar a nadie: si la pantalla no se explica
 * sola, no hay segunda oportunidad.
 *
 * Un distintivo suelto que dice «En camino» contesta *qué* pasa. Lo que esta
 * persona quiere saber es *dónde va en el trayecto* — cuánto ya se recorrió y
 * cuánto falta. Eso es una línea de tiempo, no una etiqueta.
 *
 * -----------------------------------------------------------------------------
 * TRES HITOS, Y NI UNO MÁS
 * -----------------------------------------------------------------------------
 * | Hito | Cuándo se marca | De dónde sale la hora |
 * |---|---|---|
 * | **Lo tenemos nosotros** | el bulto salió de la tienda | `pedidos.retirado_en` |
 * | **En camino** | el pedido va en la ruta del día | *no hay hora: va la ventana* |
 * | **Entregado** | se cerró la parada | `pruebas_entrega.capturado_en` |
 *
 * ⚠️ **El hito del medio NO lleva hora, y es a propósito.** No existe una
 * columna que diga a qué hora salió a ruta: lo más parecido es `asignado_en`,
 * que es cuando el coordinador lo repartió — puede ser tres horas antes de que
 * la van se mueva. Escribir «salió a las 13:40» con ese dato sería inventar
 * precisión delante de alguien que no puede contradecirlo. Va la **ventana**,
 * que sí es un compromiso real.
 *
 * -----------------------------------------------------------------------------
 * LO QUE SE ANIMA, Y LO QUE NUNCA
 * -----------------------------------------------------------------------------
 * Se anima **el trazo**: la línea se llena desde el primer hito hasta donde
 * está el pedido hoy, y los puntos se encienden a su paso. Eso es lo que
 * convierte tres filas en un recorrido.
 *
 * **No se anima ni un dato.** Los títulos, las horas, el código y el distintivo
 * están en el HTML desde el primer cuadro y son legibles con el JavaScript
 * apagado. La animación revela **el camino ya recorrido**, no la información —
 * es la misma regla 74 del sitio comercial, que acá pesa más todavía porque
 * quien mira necesita el dato, no el espectáculo.
 *
 * **No se repite.** Corre una vez, dura 1,4 s y se detiene. Un bucle en esta
 * pantalla sería una animación corriendo indefinidamente en el teléfono de
 * alguien que está en la calle, gastándole batería para no decirle nada nuevo.
 *
 * **Tiene versión estática diseñada.** Con «reducir movimiento» la línea aparece
 * ya llena, en su posición final. No es la ausencia de la animación: es el mismo
 * dibujo, sin el trazo.
 *
 * -----------------------------------------------------------------------------
 * EL DETALLE QUE HACE EL TRABAJO: LA CABEZA A MEDIO CAMINO
 * -----------------------------------------------------------------------------
 * Cuando el pedido va **en camino**, el tramo entre el segundo y el tercer hito
 * se llena **hasta el 45 %** y ahí se queda. Es la única forma de decir, sin una
 * palabra, «ya salió, todavía no llega». Si se llenara entero, el dibujo diría
 * que está entregado; si no se llenara nada, diría que no ha salido.
 */

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { CLASES_TONO, exigeTrama, type TonoEstado } from "@/lib/ui/tonos-estado";

export type ClaveHito = "recibido" | "en_camino" | "cierre";

export interface HitoPublico {
  clave: ClaveHito;
  titulo: string;
  /** La hora real, la ventana comprometida, o nada. Nunca una hora inventada. */
  detalle: string | null;
  /** `hecho` pinta el punto lleno; `actual` es donde está hoy; `pendiente` va apagado. */
  situacion: "hecho" | "actual" | "pendiente";
  /** El tono del sistema. Solo el hito de cierre lo cambia (falla, cancelado). */
  tono: TonoEstado;
}

/** Cuánto se llena el tramo que lleva al hito donde está el pedido ahora. */
const AVANCE_PARCIAL = 0.45;
/** Duración del trazo de un tramo. */
const MS_TRAMO = 520;
/** Separación entre el arranque de un tramo y el del siguiente. */
const MS_ESCALON = 320;

export function LineaTiempoPublica({
  hitos,
  /** El pedido está en el hito del medio y no ha llegado: el trazo se corta al 45 %. */
  enTransito,
}: {
  hitos: HitoPublico[];
  enTransito: boolean;
}) {
  const [reducido, setReducido] = useState(false);
  // Arranca en `false` para que el HTML del servidor —y el primer cuadro del
  // cliente— traigan la línea vacía, y el trazo tenga de dónde crecer. Si el
  // JS no llega nunca, la línea queda vacía pero **los tres hitos con sus horas
  // se leen igual**, que es lo que esta persona vino a buscar.
  const [trazado, setTrazado] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const aplicar = () => setReducido(mq.matches);
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);

  useEffect(() => {
    // Un cuadro de espera: sin él, React puede aplicar el estado final en el
    // mismo commit que el inicial y el navegador no ve transición ninguna.
    const cuadro = requestAnimationFrame(() => setTrazado(true));
    // ⚠️ **Y una red debajo, porque `requestAnimationFrame` NO corre en una
    // pestaña oculta.** Este enlace se abre desde WhatsApp, que muy a menudo
    // abre la pestaña en segundo plano: sin esto, el trazo se queda en cero y la
    // línea dice, con todas sus letras, que el pedido no ha avanzado nada. Un
    // adorno que no aparece es un adorno; una línea de tiempo vacía es
    // información falsa. `setTimeout` sí corre oculto —lo estrangulan a ~1 s,
    // que acá da igual—, así que gana el que llegue primero.
    const red = setTimeout(() => setTrazado(true), 0);
    return () => {
      cancelAnimationFrame(cuadro);
      clearTimeout(red);
    };
  }, []);

  const listo = reducido || trazado;

  return (
    <ol
      className="relative"
      data-estatico={reducido ? "true" : undefined}
      // La línea es decorativa: el lector de pantalla ya recibe los tres hitos
      // con su situación en el texto de cada uno.
      aria-label="Avance de tu pedido"
    >
      {hitos.map((h, i) => {
        const ultimo = i === hitos.length - 1;
        // El tramo que sale de este hito hacia el siguiente. Se llena entero si
        // el siguiente ya ocurrió; hasta el 45 % si el pedido está justo ahí.
        const siguiente = hitos[i + 1];
        // Se llena entero todo tramo que **llega** a un hito ya alcanzado —el
        // pedido pasó por ahí—, y solo el que **sale** del hito actual se corta
        // al 45 %. Escrito al revés, un pedido en camino dejaba el primer tramo
        // a medias y el segundo vacío: el dibujo decía que ni siquiera había
        // llegado a salir.
        const proporcion = !siguiente
          ? 0
          : siguiente.situacion !== "pendiente"
            ? 1
            : h.situacion === "actual" && enTransito
              ? AVANCE_PARCIAL
              : 0;

        return (
          <li key={h.clave} className={cn("relative flex gap-4", ultimo ? "" : "pb-7")}>
            {/* ── La columna del trazo ─────────────────────────────────── */}
            <div className="relative flex w-4 shrink-0 justify-center">
              {/* Riel apagado: siempre está, para que el trazo tenga sobre qué
                  correr y la línea no aparezca de la nada. */}
              {ultimo ? null : (
                <span
                  aria-hidden="true"
                  className="absolute top-4 bottom-0 left-1/2 w-px -translate-x-1/2 bg-line"
                />
              )}
              {/* Trazo: crece de arriba hacia abajo. `scaleY` y no `height`
                  porque `transform` no obliga al navegador a recalcular el
                  layout en cada cuadro — en un teléfono de gama baja, que es
                  donde se abre esto, la diferencia se ve. */}
              {ultimo ? null : (
                <span
                  aria-hidden="true"
                  className="absolute top-4 bottom-0 left-1/2 w-px origin-top -translate-x-1/2 bg-brand"
                  style={{
                    transform: `translateX(-50%) scaleY(${listo ? proporcion : 0})`,
                    transition: reducido
                      ? undefined
                      : `transform ${MS_TRAMO}ms cubic-bezier(0.4, 0, 0.2, 1) ${i * MS_ESCALON}ms`,
                  }}
                />
              )}
              {/* El punto. Cuadrado y no círculo: el sistema no usa radios
                  redondos, y un cuadrado de 8 px sobrevive al monocromo. */}
              <Punto
                situacion={h.situacion}
                tono={h.tono}
                encendido={listo && h.situacion !== "pendiente"}
                retardo={reducido ? 0 : Math.max(0, i * MS_ESCALON - 60)}
                sinTransicion={reducido}
              />
            </div>

            {/* ── El contenido: nunca se anima ─────────────────────────── */}
            <div className={cn("min-w-0 flex-1 pb-1", h.situacion === "pendiente" && "opacity-45")}>
              <p
                className={cn(
                  "text-sm leading-snug",
                  h.situacion === "actual" ? "font-medium text-fg" : "text-fg",
                )}
              >
                {h.titulo}
              </p>
              {h.detalle ? (
                <p className="rx-num mt-0.5 text-sm text-fg-muted">{h.detalle}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * El punto de un hito.
 *
 * Toma su color del tono del sistema —el mismo que ve el coordinador— y no de
 * una clase escrita a mano. Es la regla 46: el seguimiento es una **traducción**
 * del estado, no un producto aparte con su propia paleta.
 */
function Punto({
  situacion,
  tono,
  encendido,
  retardo,
  sinTransicion,
}: {
  situacion: HitoPublico["situacion"];
  tono: TonoEstado;
  encendido: boolean;
  retardo: number;
  sinTransicion: boolean;
}) {
  const relleno = situacion === "pendiente" ? "border-line bg-bg" : CLASES_TONO[tono];

  return (
    <span
      aria-hidden="true"
      data-tono={situacion === "pendiente" ? undefined : tono}
      data-trama={situacion !== "pendiente" && exigeTrama(tono) ? "" : undefined}
      className={cn(
        "relative z-10 mt-1.5 block size-3 border",
        relleno,
        // El hito donde está el pedido ahora lleva un anillo: se distingue del
        // que ya pasó incluso en blanco y negro, y sin usar rojo (regla 67).
        situacion === "actual" && "ring-2 ring-brand ring-offset-2 ring-offset-bg-raised",
      )}
      style={{
        opacity: encendido || situacion === "pendiente" ? 1 : 0,
        transform: `scale(${encendido || situacion === "pendiente" ? 1 : 0.4})`,
        transition: sinTransicion
          ? undefined
          : `opacity 220ms ease-out ${retardo}ms, transform 220ms cubic-bezier(0.34, 1.4, 0.64, 1) ${retardo}ms`,
      }}
    />
  );
}
