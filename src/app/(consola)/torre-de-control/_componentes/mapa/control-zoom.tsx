"use client";

import type { NivelZoom } from "../../_fixture/estado-torre";
import { FOCO_ANILLO } from "../../_lib/estilos";

interface Props {
  zoom: NivelZoom;
  /** Motivo por el que «Pedidos» no está disponible, o `null` si sí lo está. */
  motivoPedidos: string | null;
  onCambiarZoom: (zoom: NivelZoom) => void;
  onAlternarLista: () => void;
}

const NIVELES: { valor: NivelZoom; etiqueta: string }[] = [
  { valor: "zonas", etiqueta: "Zonas" },
  { valor: "comunas", etiqueta: "Comunas" },
  { valor: "pedidos", etiqueta: "Pedidos" },
];

/**
 * Zoom segmentado + salida a la vista de lista (README §4, flotante
 * arriba-derecha).
 *
 * «Pedidos» se comporta como una capa bloqueada y no como un botón muerto:
 * mismo tratamiento visual (`.42` + `⊘`), mismo motivo accesible. Con el
 * proveedor de geocoding de respaldo todos los pedidos caen en el centroide de
 * su comuna, así que dibujarlos sería inventar una precisión que el dato no
 * tiene. Se enciende por configuración cuando haya geocoding real, no
 * cambiando este componente.
 */
export function ControlZoom({ zoom, motivoPedidos, onCambiarZoom, onAlternarLista }: Props) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex border-2 border-tc-tinta bg-tc-papel" role="group" aria-label="Nivel de detalle">
        {NIVELES.map((nivel, i) => {
          const activo = zoom === nivel.valor;
          const bloqueado = nivel.valor === "pedidos" && motivoPedidos !== null;
          return (
            <button
              key={nivel.valor}
              type="button"
              onClick={() => {
                if (!bloqueado) onCambiarZoom(nivel.valor);
              }}
              aria-pressed={activo}
              aria-disabled={bloqueado}
              title={bloqueado ? (motivoPedidos ?? undefined) : undefined}
              className={[
                "flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-extrabold tracking-[0.08em] uppercase transition-colors",
                i > 0 ? "border-l border-tc-ink-300" : "",
                activo
                  ? "bg-tc-tinta text-tc-papel"
                  : bloqueado
                    ? "cursor-not-allowed text-tc-tinta opacity-[.42]"
                    : "text-tc-tinta hover:bg-tc-inserto",
                FOCO_ANILLO,
              ].join(" ")}
            >
              {bloqueado ? <span aria-hidden="true">⊘</span> : null}
              {nivel.etiqueta}
              {bloqueado && motivoPedidos ? <span className="sr-only"> — {motivoPedidos}</span> : null}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onAlternarLista}
        className={`border-2 border-tc-tinta bg-tc-papel px-2.5 py-1.5 text-[10px] font-extrabold tracking-[0.08em] text-tc-tinta uppercase transition-colors hover:bg-tc-inserto ${FOCO_ANILLO}`}
      >
        Vista de lista <kbd className="ml-1 text-[8.5px] font-semibold opacity-50">L</kbd>
      </button>
    </div>
  );
}
