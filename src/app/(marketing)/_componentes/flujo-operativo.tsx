"use client";

import { useEffect, useRef } from "react";

import { montarFlujo } from "./flujo-escena";
import "./flujo-operativo.css";

/**
 * El hero de la portada: un día de trabajo animado, de los pedidos a la entrega.
 *
 * React dibuja solo el marco —riel, lienzo vacío y pie— y `montarFlujo` es dueño
 * de todo lo que cambia. Ver el porqué en `flujo-escena.ts`: en corto, así el
 * traductor de Chrome no puede tumbar la página y la escena no re-renderiza 60
 * veces por segundo.
 */
const PASOS = ["Pedidos", "Retiro", "Asignación", "En ruta", "Entregado"];

export function FlujoOperativo() {
  const figura = useRef<HTMLElement>(null);
  const lienzo = useRef<SVGSVGElement>(null);
  const riel = useRef<HTMLOListElement>(null);
  const titulo = useRef<HTMLSpanElement>(null);
  const subtitulo = useRef<HTMLSpanElement>(null);
  const pausa = useRef<HTMLButtonElement>(null);
  const icono = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!figura.current || !lienzo.current || !riel.current || !titulo.current || !subtitulo.current || !pausa.current || !icono.current) return;
    return montarFlujo({
      figura: figura.current,
      lienzo: lienzo.current,
      pasos: Array.from(riel.current.querySelectorAll<HTMLElement>("li")),
      titulo: titulo.current,
      subtitulo: subtitulo.current,
      pausa: pausa.current,
      iconoPausa: icono.current,
    });
  }, []);

  return (
    <figure
      ref={figura}
      aria-label="Un día de trabajo con Rutax: llegan los pedidos, se retiran en bodega, se reparten, salen en ruta y se entregan"
      className="flujo-op m-0 min-w-0 overflow-hidden border border-line border-t-2 border-t-brand bg-bg-raised"
    >
      <ol ref={riel} className="m-0 grid list-none grid-cols-5 border-b border-line-subtle p-0">
        {PASOS.map((nombre, i) => (
          <li key={nombre} className="group" data-visto={i === 0 ? "" : undefined}>
            <button
              type="button"
              className="grid w-full cursor-pointer gap-2 px-1 pt-3 pb-2.5 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-text sm:px-3"
            >
              <span className="block h-[3px] overflow-hidden bg-line-subtle">
                <i data-barra="" className="block h-full origin-left scale-x-0 bg-brand" />
              </span>
              <span className="truncate text-[11px] font-semibold tracking-[-0.01em] text-fg-subtle transition-colors group-data-[visto]:text-fg sm:text-[13.5px] sm:tracking-normal">
                {nombre}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div translate="no">
        <svg ref={lienzo} className="lienzo" viewBox="0 0 640 360" aria-hidden="true" />
      </div>

      <figcaption className="flex min-h-16 items-center justify-between gap-3 border-t border-line-subtle bg-bg-sunken px-4 py-3">
        <p className="m-0 grid">
          <span ref={titulo} aria-live="polite" className="text-[15px] font-semibold">
            Llegan los pedidos
          </span>
          <span ref={subtitulo} className="text-[13px] text-fg-muted">
            Desde las tiendas de tus clientes, sin digitar nada.
          </span>
        </p>
        <button
          ref={pausa}
          type="button"
          aria-label="Pausar animación"
          className="grid size-[34px] flex-none cursor-pointer place-items-center rounded-ctrl border border-line text-fg-muted outline-none hover:border-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text"
        >
          <svg ref={icono} viewBox="0 0 14 14" className="size-3.5" aria-hidden="true" />
        </button>
      </figcaption>
    </figure>
  );
}
