import type { Zona } from "../_fixture/estado-torre";
import { esRiesgoCritico, palabraDeRiesgo } from "../_lib/riesgo";
import { numeroTorre } from "../_lib/formato";
import { FOCO_ANILLO_FILA } from "../_lib/estilos";
import { BarraRiesgo } from "./trama-riesgo";

interface Props {
  zona: Zona;
  seleccionada: boolean;
  onSeleccionar: () => void;
  variante?: "escritorio" | "movil";
}

/**
 * Fila del equivalente sin mapa (regla de producto 7): "mismos datos que el
 * mapa" — puntaje, nombre, nivel, pendientes, corte, conductores. Dos
 * variantes de grid, según README §4 (escritorio, dentro de R3) y §5 (móvil,
 * "Zonas por riesgo").
 *
 * Decisión de este paso: el handoff fija el ancho de las 6 columnas de
 * escritorio (`44px 150px 1fr 120px 110px 100px`) pero no especifica qué va
 * en la columna `1fr` — se completa aquí con una barra de riesgo (misma
 * trama del mapa), coherente con la regla 4 y con "vista de lista = mismos
 * datos que el mapa".
 */
export function FilaZona({ zona, seleccionada, onSeleccionar, variante = "escritorio" }: Props) {
  const critico = esRiesgoCritico(zona.riesgo);
  const palabra = palabraDeRiesgo(zona.riesgo);
  const claseFila = `w-full items-center gap-3 border-b border-tc-ink-300 text-left transition-colors ${seleccionada ? "bg-tc-inserto" : ""} hover:bg-tc-inserto ${FOCO_ANILLO_FILA}`;

  if (variante === "movil") {
    return (
      <button
        type="button"
        onClick={onSeleccionar}
        aria-pressed={seleccionada}
        aria-label={`${zona.nombre}, riesgo ${palabra}, puntaje ${zona.riesgo}`}
        className={`grid min-h-[56px] px-3 py-2 ${claseFila}`}
        style={{ gridTemplateColumns: "40px 1fr auto" }}
      >
        <span className={`tc-num text-[24px] leading-none font-extrabold ${critico ? "text-tc-senal-text" : "text-tc-tinta"}`}>
          {zona.riesgo}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate text-[13px] font-extrabold tracking-[0.02em] text-tc-tinta uppercase">
              {zona.nombre}
            </span>
            <span className="shrink-0 text-[10px] font-semibold text-tc-ink-600 uppercase">{palabra}</span>
          </span>
          <BarraRiesgo valor={zona.riesgo} alturaPx={8} />
        </span>
        <span className="tc-num flex flex-col items-end gap-0.5 text-[10px] text-tc-ink-700">
          <span>{numeroTorre(zona.pedidosPendientes)} pend.</span>
          <span>corte {zona.ventanaCorte.hora}</span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSeleccionar}
      aria-pressed={seleccionada}
      aria-label={`${zona.nombre}, riesgo ${palabra}, puntaje ${zona.riesgo}`}
      className={`grid px-3 py-2.5 ${claseFila}`}
      style={{ gridTemplateColumns: "44px 150px 1fr 120px 110px 100px" }}
    >
      <span className={`tc-num text-[20px] leading-none font-extrabold ${critico ? "text-tc-senal-text" : "text-tc-tinta"}`}>
        {zona.riesgo}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[11.5px] font-extrabold tracking-[0.02em] text-tc-tinta uppercase">
          {zona.nombre}
        </span>
        <span className="text-[9px] font-semibold text-tc-ink-600 uppercase">{palabra}</span>
      </span>
      <span className="px-2">
        <BarraRiesgo valor={zona.riesgo} alturaPx={7} />
      </span>
      <span className="tc-num text-[11px] text-tc-ink-700">{numeroTorre(zona.pedidosPendientes)} pendientes</span>
      <span className="tc-num text-[11px] text-tc-ink-700">corte {zona.ventanaCorte.hora}</span>
      <span className="tc-num text-[11px] text-tc-ink-700">
        {zona.conductoresDisponibles} de {zona.conductoresAsignados}
      </span>
    </button>
  );
}
