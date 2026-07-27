import { ESCALA_RIESGO } from "../_lib/riesgo";
import { SwatchRiesgo } from "./trama-riesgo";

/**
 * Leyenda de riesgo (README §4, control flotante "abajo izquierda" del mapa).
 * Cumple la regla de producto 4 por diseño: cada trama viaja siempre con su
 * rango numérico y su palabra — el color (o, aquí, la densidad) nunca solo.
 */
export function LeyendaRiesgo() {
  return (
    <div className="flex flex-wrap gap-4 border-2 border-tc-tinta bg-tc-papel px-3.5 py-3" role="list" aria-label="Escala de riesgo">
      {ESCALA_RIESGO.map((escalon) => (
        <div key={escalon.paso} role="listitem" className="flex flex-col gap-1">
          <SwatchRiesgo paso={escalon.paso} />
          <span className="tc-num text-[10.5px] font-bold text-tc-tinta">
            {escalon.rango[0]}–{escalon.rango[1]}
          </span>
          <span className="text-[9px] font-semibold text-tc-ink-600 uppercase">{escalon.palabra}</span>
        </div>
      ))}
    </div>
  );
}
