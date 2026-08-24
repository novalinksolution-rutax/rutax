"use client";

/**
 * `hoja inferior` — media · completa · con arrastre · con pie fijo.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ RESUELVE, Y POR QUÉ NO ALCANZABA CON `Sheet side="bottom"`
 * -----------------------------------------------------------------------------
 * El `Sheet` de shadcn ya sabe entrar desde abajo, pero con `h-auto`: la hoja
 * mide lo que mida su contenido y **no tiene ni puntos ni arrastre ni pie fijo**,
 * que son los tres rasgos que el sistema le pide a esta pieza.
 *
 * Los tres se ganan algo concreto:
 *
 * · **Media deja ver lo de atrás.** El coordinador abre «pedidos seleccionados»
 *   para revisar qué lleva, y necesita seguir viendo la lista de la que los
 *   sacó. Un panel a pantalla completa lo obliga a cerrarlo para mirar y a
 *   abrirlo otra vez para seguir.
 * · **El arrastre es la salida que el pulgar alcanza.** La «X» vive arriba a la
 *   derecha; en un teléfono grande sostenido con una mano, ese punto está fuera
 *   del alcance del pulgar.
 * · **El pie fijo evita el peor error de esta familia:** el botón que decide —
 *   «Asignar», «Confirmar»— empujado debajo del pliegue por el contenido. Este
 *   producto ya lo ha tenido.
 *
 * Lo que decide dónde queda la hoja al soltar vive aparte y con pruebas, en
 * `src/lib/ui/hoja-inferior.ts`.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL ARRASTRE SOLO VIVE EN EL ASA
 * -----------------------------------------------------------------------------
 * Mismo reparto que el barrido de la bandeja de asignar: si el arrastre
 * empezara en cualquier parte de la hoja, **desplazar su contenido y mover la
 * hoja serían el mismo gesto** y la lista de adentro quedaría intocable. El asa
 * es la única zona con `touch-action: none`.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EN ESCRITORIO VUELVE A SER UN PANEL LATERAL
 * -----------------------------------------------------------------------------
 * El sistema tiene **dos** contenedores para esto: `panel lateral` y `hoja
 * inferior`. No son el mismo con distinto ancho — una hoja que sube desde abajo
 * en una pantalla de 27 pulgadas es un gesto de teléfono fuera de lugar, y un
 * panel lateral en un teléfono es un panel de escritorio al que le quitaron el
 * ancho.
 *
 * El cambio va **por CSS y no por una rama en JavaScript**: medir el ancho en el
 * cliente daría un primer render distinto al del servidor, y eso es un aviso de
 * hidratación y un parpadeo en cada apertura. A partir de `lg` la hoja se pega a
 * la derecha, ocupa el alto completo y **el asa desaparece**: ahí no hay dedo que
 * arrastre. El alto medido en JS se anula con `lg:!h-full`.
 *
 * -----------------------------------------------------------------------------
 * SE MONTA SOBRE `Sheet`, NO AL LADO
 * -----------------------------------------------------------------------------
 * Reusa el mismo primitivo (Radix Dialog) que ya trae la trampa de foco, el
 * cierre con Escape, el velo y el bloqueo del fondo. Un segundo diálogo escrito
 * a mano sería una segunda implementación de accesibilidad que mantener — y la
 * que se queda atrás siempre es la nueva.
 */

import * as React from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  ALTO_HOJA,
  altoDurante,
  destinoAlSoltar,
  type PuntoHoja,
} from "@/lib/ui/hoja-inferior";

export function HojaInferior({
  abierta,
  onOpenChange,
  titulo,
  descripcion,
  /** Se muestra siempre, pegado abajo: el contenido se desplaza por detrás. */
  pie,
  /** Con qué altura abre. `media` deja ver la pantalla de atrás. */
  inicial = "media",
  className,
  children,
}: {
  abierta: boolean;
  onOpenChange: (abierta: boolean) => void;
  titulo: React.ReactNode;
  descripcion?: React.ReactNode;
  pie?: React.ReactNode;
  inicial?: PuntoHoja;
  className?: string;
  children: React.ReactNode;
}) {
  const [punto, setPunto] = React.useState<PuntoHoja>(inicial);
  const [arrastre, setArrastre] = React.useState<number | null>(null);
  const gesto = React.useRef<{ y0: number; t0: number; yUlt: number; tUlt: number } | null>(null);
  const [altoVentana, setAltoVentana] = React.useState(0);

  // Al cerrarse vuelve a su punto de partida: reabrirla en `completa` porque la
  // vez anterior se expandió tapa la pantalla sin que nadie lo haya pedido.
  //
  // ⚠️ Se ajusta **durante el render**, comparando con el valor anterior, y no en
  // un efecto. Un efecto correría *después* de pintar, así que al reabrirla se
  // vería un cuadro con la altura vieja antes de saltar a la nueva — y React
  // documenta este patrón justamente para eso: reiniciar estado cuando cambia
  // una prop.
  const [abiertaPrevia, setAbiertaPrevia] = React.useState(abierta);
  if (abierta !== abiertaPrevia) {
    setAbiertaPrevia(abierta);
    if (!abierta) {
      setPunto(inicial);
      setArrastre(null);
      // El gesto en curso NO se limpia acá: escribir un ref durante el render
      // rompe con el render concurrente. Y no hace falta — el siguiente
      // `onPointerDown` lo sobrescribe entero, y sin `arrastre` no se lee.
    }
  }

  // ⚠️ `dvh` y no `vh`: en un teléfono con la barra del navegador visible, `vh`
  // sobra justo el alto de esa barra y el pie fijo queda **debajo del borde**,
  // que es exactamente lo que esta pieza viene a impedir. Se mide en JS porque
  // el arrastre necesita el número, no solo la unidad CSS.
  React.useEffect(() => {
    const medir = () => setAltoVentana(window.innerHeight);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  const alto =
    altoVentana === 0
      ? undefined
      : arrastre === null
        ? altoVentana * ALTO_HOJA[punto]
        : altoDurante({ punto, desplazamiento: arrastre, altoVentana });

  const propsAsa = {
    style: { touchAction: "none" as const },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const t = performance.now();
      gesto.current = { y0: e.clientY, t0: t, yUlt: e.clientY, tUlt: t };
      setArrastre(0);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = gesto.current;
      if (!g) return;
      g.yUlt = e.clientY;
      g.tUlt = performance.now();
      setArrastre(e.clientY - g.y0);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const g = gesto.current;
      gesto.current = null;
      setArrastre(null);
      if (!g || altoVentana === 0) return;
      const dt = Math.max(1, g.tUlt - g.t0);
      const destino = destinoAlSoltar({
        punto,
        desplazamiento: e.clientY - g.y0,
        velocidad: (g.yUlt - g.y0) / dt,
        altoVentana,
      });
      if (destino === "cerrar") onOpenChange(false);
      else setPunto(destino);
    },
    onPointerCancel: () => {
      gesto.current = null;
      setArrastre(null);
    },
  };

  return (
    <Sheet open={abierta} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // El botón de cerrar de `SheetContent` se conserva: el asa es la salida
        // cómoda, no la única — con teclado y con lector de pantalla el arrastre
        // no existe.
        className={cn(
          "gap-0 rounded-none p-0",
          // A partir de `lg` deja de ser una hoja y vuelve a ser panel lateral.
          //
          // ⚠️ **Cada override lleva `data-[side=bottom]:` delante, y no es
          // adorno.** La base trae `data-[side=bottom]:right-0`, que es un
          // selector de atributo: le gana a un `lg:right-0` pelado por
          // especificidad, no por orden — una consulta de medios no suma
          // especificidad ninguna. Sin igualar el selector, la mitad de estas
          // reglas no hace nada y el panel queda a medio pegar, que es justo lo
          // que se midió antes de escribirlas así.
          //
          // El alto en línea que calcula el arrastre se anula con `h-full!`.
          "lg:data-[side=bottom]:inset-y-0 lg:data-[side=bottom]:right-0",
          "lg:data-[side=bottom]:left-auto lg:data-[side=bottom]:h-full!",
          // `w-full` con `max-w-md` encima: sin el ancho, `left:auto` deja el panel
          // del tamaño de su contenido y se ve como una tira flaca pegada al borde.
          "lg:data-[side=bottom]:w-full lg:data-[side=bottom]:max-w-md",
          "lg:data-[side=bottom]:border-t-0 lg:data-[side=bottom]:border-l",
          className,
        )}
        style={alto === undefined ? undefined : { height: alto }}
      >
        {/* ── El asa ─────────────────────────────────────────────────────
            Es un botón de verdad, no un adorno: con teclado alterna entre los
            dos puntos, que es lo que el arrastre hace con el dedo. Sin esto,
            expandir la hoja sería un gesto que solo existe para quien puede
            hacerlo. */}
        <button
          type="button"
          {...propsAsa}
          onClick={() => setPunto((p) => (p === "media" ? "completa" : "media"))}
          aria-label={punto === "media" ? "Agrandar la hoja" : "Achicar la hoja"}
          className="flex w-full shrink-0 cursor-grab items-center justify-center py-3 active:cursor-grabbing lg:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden="true" />
        </button>

        <div className="shrink-0 px-4 pb-3 lg:pt-4">
          <SheetTitle className="text-base">{titulo}</SheetTitle>
          {descripcion ? (
            <SheetDescription className="mt-0.5">{descripcion}</SheetDescription>
          ) : (
            // Radix exige una descripción accesible: sin esto avisa por consola
            // en cada apertura y el lector de pantalla anuncia la hoja sin decir
            // de qué es.
            <SheetDescription className="sr-only">Panel de {String(titulo)}</SheetDescription>
          )}
        </div>

        {/* El cuerpo es lo ÚNICO que se desplaza. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>

        {pie ? (
          <div className="shrink-0 border-t border-line bg-bg-raised px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {pie}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
