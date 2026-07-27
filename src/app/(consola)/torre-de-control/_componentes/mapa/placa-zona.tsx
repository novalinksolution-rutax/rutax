"use client";

import type { Zona } from "../../_fixture/estado-torre";
import { esRiesgoCritico, palabraDeRiesgo } from "../../_lib/riesgo";
import { numeroTorre } from "../../_lib/formato";
import { FOCO_ANILLO } from "../../_lib/estilos";

interface Props {
  zona: Zona;
  seleccionada: boolean;
  /** Alguna zona está seleccionada y NO es esta: se atenúa, como el relleno. */
  atenuada: boolean;
  /** La capa «Comunas» está activa: bajo la placa va el bloque de nombres. */
  mostrarComunas: boolean;
  onSeleccionar: () => void;
}

/** Máximo de comunas listadas bajo la placa antes de resumir en «+N más». */
const MAX_COMUNAS_VISIBLES = 6;

/**
 * Placa de zona (README §4, 168 × 68). Vive en la capa HTML sobre el lienzo del
 * mapa, no dentro del vector, por las mismas razones que el handoff da para no
 * usar `<svg><text>`: hereda `tabular-nums` sin trucos, no se deforma con el
 * zoom, es seleccionable y accesible, y admite transiciones.
 *
 * Cumple la regla 4 por construcción: el puntaje numérico y la palabra del
 * nivel viajan siempre con la trama de la zona que hay debajo.
 */
export function PlacaZona({ zona, seleccionada, atenuada, mostrarComunas, onSeleccionar }: Props) {
  const critico = esRiesgoCritico(zona.riesgo);
  const palabra = palabraDeRiesgo(zona.riesgo);
  const visibles = zona.comunas.slice(0, MAX_COMUNAS_VISIBLES);
  const restantes = zona.comunas.length - visibles.length;

  return (
    // La raíz NO se posiciona: de eso se encarga el envoltorio que la ancla al
    // mapa. Si aquí volviera `absolute`, el envoltorio mediría 0×0 y el
    // des-solapado de placas compararía cajas vacías — no detectaría un solo
    // choque y no movería nada. Pasó.
    <div
      className="pointer-events-none flex w-[168px] flex-col"
      style={{ transition: "opacity .18s", opacity: atenuada ? 0.32 : 1 }}
    >
      <button
        type="button"
        onClick={onSeleccionar}
        aria-pressed={seleccionada}
        aria-label={`Zona ${zona.nombre}, riesgo ${palabra}, puntaje ${zona.riesgo}, ${zona.pedidosPendientes} pendientes, corte ${zona.ventanaCorte.hora}`}
        className={`pointer-events-auto flex h-[68px] cursor-pointer flex-col justify-between border-2 border-tc-tinta bg-tc-papel px-2.5 pt-[7px] pb-2 text-left ${FOCO_ANILLO}`}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[11.5px] font-extrabold tracking-[0.09em] text-tc-tinta uppercase">
            {zona.nombre}
          </span>
          <span className="shrink-0 text-[9px] font-bold tracking-[0.09em] text-tc-ink-600 uppercase">
            {palabra}
          </span>
        </span>

        <span className="flex items-end justify-between gap-2 border-t border-[rgba(32,30,29,.26)] pt-[3px]">
          <span
            className={`tc-num text-[30px] leading-[.88] font-extrabold tracking-[-0.03em] ${critico ? "text-tc-senal" : "text-tc-tinta"}`}
          >
            {zona.riesgo}
          </span>
          <span className="tc-num flex flex-col items-end text-[10px] leading-tight font-semibold">
            <span className="text-tc-tinta">{numeroTorre(zona.pedidosPendientes)} pendientes</span>
            <span className="text-tc-ink-600">corte {zona.ventanaCorte.hora}</span>
          </span>
        </span>
      </button>

      {mostrarComunas && zona.comunas.length > 0 ? (
        <p className="border-l border-tc-tinta bg-[rgba(243,242,242,.86)] px-1.5 py-1 text-[9.5px] leading-[1.5] text-tc-tinta">
          {visibles.join(" · ")}
          {restantes > 0 ? ` · +${restantes} más` : ""}
        </p>
      ) : null}
    </div>
  );
}
