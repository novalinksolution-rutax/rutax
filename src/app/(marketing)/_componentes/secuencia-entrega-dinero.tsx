"use client";

/**
 * La secuencia del hero: del pedido al dinero, en 8,2 segundos.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ PRUEBA, Y POR QUÉ ES UNA SOLA PIEZA
 * -----------------------------------------------------------------------------
 * El argumento entero de Rutax es que **una entrega genera sola sus dos líneas
 * de dinero**. Contarlo con palabras exige que el visitante confíe; mostrarlo
 * como cuatro escenas separadas obliga a creer que son el mismo pedido.
 *
 * Por eso es **una sola fila que nunca se reemplaza**: la misma fila que entró
 * en el beat 1 es la que se asigna, se entrega y produce las dos tarjetas. El
 * ojo la sigue, y ahí está la prueba.
 *
 * -----------------------------------------------------------------------------
 * LOS CUATRO BEATS Y LOS TRES DESCANSOS
 * -----------------------------------------------------------------------------
 * | Beat | Qué se ve |
 * |---|---|
 * | 1 · Entra solo | Baja la fila con FLEX, dirección y comuna **ya escritas** |
 * | 2 · Se asigna | Se marca la casilla, se llena el conductor, pasa a «En ruta» |
 * | 3 · Se entrega | El teléfono cierra la parada con foto; la fila pasa a Entregado |
 * | 4 · Las dos líneas | Bajan cobro y pago con 120 ms de diferencia. **Se queda acá** |
 *
 * Los descansos de 0,4 s van **donde el ojo necesita confirmar un cambio**. Sin
 * ellos, ocho segundos se leen como un tirón.
 *
 * -----------------------------------------------------------------------------
 * CUATRO REGLAS DEL SITIO QUE ESTA PIEZA TIENE QUE CUMPLIR
 * -----------------------------------------------------------------------------
 * · **74 — ninguna cifra aparece por animación.** Los montos están en el HTML
 *   desde el primer instante; lo que se anima es la aparición de la tarjeta que
 *   los contiene, no el número contando hacia arriba. Un contador animado le
 *   dice al visitante «mira qué bonito», y esto tiene que decir «mira qué
 *   pasó».
 * · **75 — no se repite en bucle.** Corre una vez, arranca cuando entra en
 *   pantalla, y hay un «Volver a ver». Un bucle convierte una demostración en
 *   un fondo de pantalla y garantiza que nadie llegue al final.
 * · **76 — tiene versión estática diseñada.** Con «reducir movimiento» se
 *   muestran los cuatro beats a la vez, numerados. **Es una pieza diseñada, no
 *   la ausencia de otra.**
 * · **79 — cero imágenes.** Todo es texto y color plano. La velocidad es parte
 *   del argumento: una portada que tarda no puede prometer que ahorra tiempo.
 *
 * -----------------------------------------------------------------------------
 * EL PRIMER CUADRO VIENE EN EL HTML
 * -----------------------------------------------------------------------------
 * ⚠️ Aunque el JavaScript no llegue nunca, se ve **una tabla de pedidos con dos
 * filas reales**, no un hueco ni un esqueleto gris. El estado inicial del
 * componente es el beat 1 completo, así que el servidor ya lo renderiza; la
 * animación solo agrega lo que viene después.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Los cuatro beats, con el instante en que empieza cada uno. */
const BEATS = [
  { n: 1, ms: 0, titulo: "Entra solo", pie: "Nadie escribe una dirección." },
  { n: 2, ms: 2400, titulo: "Se asigna", pie: "Un grupo, un conductor, un clic." },
  { n: 3, ms: 4400, titulo: "Se entrega", pie: "Foto y ubicación, entregue o no." },
  {
    n: 4,
    ms: 6200,
    titulo: "Las dos líneas",
    pie: "Salieron de la misma entrega. Cuadradas.",
  },
] as const;

const FIN_MS = 8200;

export function SecuenciaEntregaDinero() {
  // Arranca en el beat 1 —no en 0— para que el servidor ya renderice la tabla
  // con su fila. Si el JS no llega, esto es lo que queda, y es una pantalla
  // legítima del producto.
  const [beat, setBeat] = useState(1);
  const [corriendo, setCorriendo] = useState(false);
  const [reducido, setReducido] = useState(false);
  const [termino, setTermino] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const relojes = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const aplicar = () => setReducido(mq.matches);
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);

  const limpiar = useCallback(() => {
    relojes.current.forEach(clearTimeout);
    relojes.current = [];
  }, []);

  const correr = useCallback(() => {
    limpiar();
    setTermino(false);
    setBeat(1);
    setCorriendo(true);
    for (const b of BEATS.slice(1)) {
      relojes.current.push(setTimeout(() => setBeat(b.n), b.ms));
    }
    relojes.current.push(
      setTimeout(() => {
        setCorriendo(false);
        setTermino(true);
      }, FIN_MS),
    );
  }, [limpiar]);

  // Arranca cuando la pieza ENTRA en pantalla, no al cargar: nadie llega a
  // mitad de ciclo, y quien abre la página con el hero fuera de vista no se
  // pierde la demostración.
  useEffect(() => {
    if (reducido || !caja.current) return;
    const nodo = caja.current;
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas[0]?.isIntersecting) {
          obs.disconnect();
          correr();
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(nodo);
    return () => obs.disconnect();
  }, [reducido, correr]);

  useEffect(() => limpiar, [limpiar]);

  // ── Versión estática (regla 76) ────────────────────────────────────────
  // Los cuatro beats a la vez, numerados. Es la que se usa además en la imagen
  // para compartir y en el correo.
  if (reducido) {
    return (
      <div className="grid gap-3 sm:grid-cols-2" data-estatico="true">
        {BEATS.map((b) => (
          <div key={b.n} className="border border-line bg-bg-raised p-4">
            <p className="rx-num font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
              {b.n} · {b.titulo}
            </p>
            <div className="mt-3">{cuerpoDeBeat(b.n)}</div>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">{b.pie}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={caja} className="space-y-3">
      <div className="border border-line bg-bg-raised">
        {/* La cabecera de la tabla no se anima: es el marco, y un marco que
            aparece hace dudar de que el producto exista. */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line-subtle bg-bg-inset px-4 py-2">
          <span className="size-4 border border-line" aria-hidden="true" />
          <span className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
            Pedidos de hoy
          </span>
          <span className="rx-num text-[10px] text-fg-subtle">2 de 2</span>
        </div>

        <FilaPedido
          beat={beat}
          destinatario="Sofía Guzmán"
          direccion="Av. Irarrázaval 2340"
          comuna="Ñuñoa"
        />
        {/* La segunda fila es contexto: prueba que es una tabla y no una
            tarjeta disfrazada. No participa de la secuencia. */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 opacity-45">
          <span className="size-4 border border-line" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Luis Campos</p>
            <p className="truncate text-xs text-fg-muted">Av. Las Condes 8901 · Las Condes</p>
          </div>
          <Distintivo tono="neutral">Pendiente</Distintivo>
        </div>
      </div>

      {/* Beat 3 · el teléfono del conductor. Entra por abajo y se va. */}
      <div
        className={[
          "transition-all duration-500 ease-out",
          beat >= 3 ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        ].join(" ")}
        aria-hidden={beat < 3}
      >
        <div className="flex items-center gap-3 border border-line bg-bg-inset px-4 py-3">
          <span className="rx-num font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
            App del conductor
          </span>
          <span className="text-sm text-fg-muted">Parada cerrada con foto y ubicación.</span>
        </div>
      </div>

      {/* Beat 4 · las dos líneas, con 120 ms de diferencia. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <TarjetaLinea
          visible={beat >= 4}
          retrasoMs={0}
          rotulo="Le cobras al seller"
          monto="$3.800"
          detalle="Tarifa de FalabellaTech en Ñuñoa"
          tono="balanced"
        />
        <TarjetaLinea
          visible={beat >= 4}
          retrasoMs={120}
          rotulo="Le pagas al conductor"
          monto="$1.900"
          detalle="R. Muñoz · entrega same-day"
          tono="progress"
        />
      </div>

      <div className="flex min-h-[2.5rem] items-center justify-between gap-3">
        <p
          className="text-sm leading-relaxed text-fg-muted transition-opacity duration-300"
          // `aria-live` en `polite`: el lector anuncia el pie de cada beat sin
          // interrumpir lo que esté leyendo.
          aria-live="polite"
        >
          {BEATS[beat - 1]?.pie}
        </p>
        {/* Aparece al terminar, no antes: un botón de repetir mientras corre
            invita a cortar la única pasada. */}
        {termino ? (
          <button
            type="button"
            onClick={correr}
            className="shrink-0 text-sm font-medium text-fg-link underline-offset-4 hover:underline"
          >
            Volver a ver
          </button>
        ) : corriendo ? (
          <span className="shrink-0 font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
            {beat} de 4
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** La fila que atraviesa los cuatro beats. Es siempre la misma. */
function FilaPedido({
  beat,
  destinatario,
  direccion,
  comuna,
}: {
  beat: number;
  destinatario: string;
  direccion: string;
  comuna: string;
}) {
  const asignada = beat >= 2;
  const entregada = beat >= 3;

  return (
    <div
      className={[
        "grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line-subtle px-4 py-3",
        "transition-colors duration-500",
        asignada ? "bg-accent-deep/25" : "bg-transparent",
      ].join(" ")}
    >
      <span
        className={[
          "grid size-4 place-items-center border transition-colors duration-300",
          asignada ? "border-brand bg-brand" : "border-line",
        ].join(" ")}
        aria-hidden="true"
      >
        {asignada ? (
          <svg viewBox="0 0 12 12" className="size-3 text-fg-on-accent" fill="none">
            <path
              d="M2.5 6.2 5 8.7 9.5 3.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rx-num shrink-0 border border-line px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-fg-muted uppercase">
            Flex
          </span>
          <p className="truncate text-sm font-medium">{destinatario}</p>
        </div>
        <p className="truncate text-xs text-fg-muted">
          {direccion} · {comuna}
          {/* El conductor se escribe en el beat 2. La transición es de ancho y
              opacidad, no un cambio de texto: se ve que se LLENA. */}
          <span
            className={[
              "inline-block overflow-hidden align-bottom transition-all duration-500 ease-out",
              asignada ? "max-w-[12rem] opacity-100" : "max-w-0 opacity-0",
            ].join(" ")}
          >
            <span className="text-fg">{" · R. Muñoz"}</span>
          </span>
        </p>
      </div>

      <Distintivo tono={entregada ? "balanced" : asignada ? "progress" : "neutral"}>
        {entregada ? "Entregado" : asignada ? "En ruta" : "Pendiente"}
      </Distintivo>
    </div>
  );
}

function Distintivo({
  tono,
  children,
}: {
  tono: "neutral" | "progress" | "balanced";
  children: React.ReactNode;
}) {
  const clases = {
    neutral: "border-neutral-line bg-neutral-bg text-neutral-fg",
    progress: "border-progress-line bg-progress-bg text-progress-fg",
    balanced: "border-balanced-line bg-balanced-bg text-balanced-fg",
  }[tono];
  return (
    <span
      data-tono={tono}
      className={`shrink-0 border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors duration-500 ${clases}`}
    >
      {children}
    </span>
  );
}

/**
 * Una de las dos líneas de dinero.
 *
 * ⚠️ **El monto está en el HTML desde el primer render** (regla 74): lo que se
 * anima es la aparición de la tarjeta, nunca la cifra. Un número que cuenta
 * hacia arriba es decoración, y acá la cifra es el argumento.
 */
function TarjetaLinea({
  visible,
  retrasoMs,
  rotulo,
  monto,
  detalle,
  tono,
}: {
  visible: boolean;
  retrasoMs: number;
  rotulo: string;
  monto: string;
  detalle: string;
  tono: "balanced" | "progress";
}) {
  const borde = tono === "balanced" ? "border-balanced-line" : "border-progress-line";
  return (
    <div
      style={{ transitionDelay: visible ? `${retrasoMs}ms` : "0ms" }}
      className={[
        "border bg-bg-raised p-4 transition-all duration-500 ease-out",
        borde,
        visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1.5 opacity-0",
      ].join(" ")}
      aria-hidden={!visible}
    >
      <p className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">{rotulo}</p>
      <p className="rx-num mt-1 text-2xl font-semibold">{monto}</p>
      <p className="mt-1 text-xs text-fg-muted">{detalle}</p>
    </div>
  );
}

/** El cuerpo de cada beat en la versión estática. */
function cuerpoDeBeat(n: number) {
  if (n === 4) {
    return (
      <div className="space-y-1">
        <p className="rx-num text-lg font-semibold">
          $3.800 <span className="text-xs font-normal text-fg-muted">al seller</span>
        </p>
        <p className="rx-num text-lg font-semibold">
          $1.900 <span className="text-xs font-normal text-fg-muted">al conductor</span>
        </p>
      </div>
    );
  }
  const estado = n === 1 ? "Pendiente" : n === 2 ? "En ruta" : "Entregado";
  const tono = n === 1 ? "neutral" : n === 2 ? "progress" : "balanced";
  return (
    <div className="flex items-center gap-2">
      <span className="rx-num border border-line px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-fg-muted uppercase">
        Flex
      </span>
      <span className="truncate text-sm">Av. Irarrázaval 2340</span>
      <Distintivo tono={tono as "neutral" | "progress" | "balanced"}>{estado}</Distintivo>
    </div>
  );
}
