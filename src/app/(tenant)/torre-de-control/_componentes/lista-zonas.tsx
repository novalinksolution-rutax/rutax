import type { Zona } from "../_fixture/estado-torre";
import { FilaZona } from "./fila-zona";
import { ContadorSinUbicar } from "./contador-sin-ubicar";
import { LeyendaRiesgo } from "./leyenda-riesgo";

interface Props {
  zonas: Zona[];
  zonaSeleccionada: string | null;
  pedidosSinGeocodificar: number;
  onSeleccionarZona: (zonaId: string) => void;
  /** `false` = el usuario pidió el mapa (tecla L) — R3 aún no existe, ver nota. */
  mostrarLista: boolean;
}

/**
 * Equivalente sin mapa de R3 (regla de producto 7 + README §5). Ocupa el
 * espacio de R3 en este paso, porque el mapa (MapLibre + PMTiles + DPA 2023)
 * es una tarea de infraestructura aparte que este paso explícitamente no
 * construye. No es un placeholder: es accesibilidad, es la vista móvil, y
 * debe existir siempre — así que sigue viva incluso cuando el mapa llegue.
 *
 * Zonas ordenadas por riesgo descendente, como pide la regla 7.
 */
export function ListaZonas({
  zonas,
  zonaSeleccionada,
  pedidosSinGeocodificar,
  onSeleccionarZona,
  mostrarLista,
}: Props) {
  const ordenadas = [...zonas].sort((a, b) => b.riesgo - a.riesgo);

  if (!mostrarLista) {
    return (
      <div
        id="r3-mapa"
        className="tc-cargando flex flex-1 flex-col items-center justify-center gap-2 border border-dashed border-tc-ink-400 p-8 text-center"
      >
        <p className="text-[11px] font-extrabold tracking-[0.12em] text-tc-ink-700 uppercase">
          R3 · mapa — pendiente
        </p>
        <p className="max-w-sm text-[12.5px] text-tc-ink-700">
          El mapa requiere MapLibre, un basemap PMTiles y la geometría comunal DPA 2023 — es
          trabajo de infraestructura aparte. Mientras tanto, esta pantalla usa siempre la vista de
          lista.
        </p>
      </div>
    );
  }

  return (
    <div id="r3-mapa" className="flex flex-1 flex-col gap-3 overflow-hidden bg-tc-papel p-3">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-extrabold tracking-[0.14em] text-tc-ink-600 uppercase">
          Zonas por riesgo
        </p>
        <p className="text-[9px] text-tc-ink-600">tecla L conmuta con el mapa</p>
      </div>

      {/* Encabezado de columnas — mismo grid que las filas. Este componente
          solo se monta dentro del árbol de escritorio (ver TorreConsola), así
          que no necesita su propio breakpoint: siempre hay espacio de sobra. */}
      <div
        className="grid shrink-0 gap-3 border-b-2 border-tc-tinta px-3 pb-1.5 text-[9px] font-extrabold tracking-[0.1em] text-tc-ink-600 uppercase"
        style={{ gridTemplateColumns: "44px 150px 1fr 120px 110px 100px" }}
      >
        <span>Punt.</span>
        <span>Zona</span>
        <span>Riesgo</span>
        <span>Pendientes</span>
        <span>Corte</span>
        <span>Conductores</span>
      </div>

      <div className="flex-1 overflow-y-auto tc-rail" role="list" aria-label="Zonas ordenadas por riesgo">
        {ordenadas.map((zona) => (
          <div key={zona.id} role="listitem">
            <FilaZona
              zona={zona}
              seleccionada={zonaSeleccionada === zona.id}
              onSeleccionar={() => onSeleccionarZona(zona.id)}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <LeyendaRiesgo />
        <ContadorSinUbicar cantidad={pedidosSinGeocodificar} />
      </div>
    </div>
  );
}
