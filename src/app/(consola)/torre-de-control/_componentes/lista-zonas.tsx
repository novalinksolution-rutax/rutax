import type { Zona } from "../_fixture/estado-torre";
import { FilaZona } from "./fila-zona";
import { ContadorSinUbicar } from "./contador-sin-ubicar";
import { LeyendaRiesgo } from "./leyenda-riesgo";

interface Props {
  zonas: Zona[];
  zonaSeleccionada: string | null;
  pedidosSinGeocodificar: number;
  onSeleccionarZona: (zonaId: string) => void;
}

/**
 * Equivalente sin mapa de R3 (regla de producto 7 + README §5).
 *
 * NO es el respaldo del mapa ni desaparece ahora que el mapa existe: es la ruta
 * accesible al mismo dato —recorrible con tabulador, `Enter` selecciona— y es
 * la vista móvil. La tecla `L` conmuta entre las dos dentro de R3.
 *
 * Zonas ordenadas por riesgo descendente, como pide la regla 7.
 */
export function ListaZonas({
  zonas,
  zonaSeleccionada,
  pedidosSinGeocodificar,
  onSeleccionarZona,
}: Props) {
  const ordenadas = [...zonas].sort((a, b) => b.riesgo - a.riesgo);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden bg-tc-papel p-3">
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
