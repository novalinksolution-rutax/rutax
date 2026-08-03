import type { FrescuraFuente, Horizonte } from "../../_fixture/estado-torre";
import { horaSantiago } from "../../_lib/tiempo";
import { FOCO_ANILLO } from "../../_lib/estilos";
import { HORIZONTES } from "../../_lib/horizontes";

interface Props {
  ahoraIso: string;
  frescura: FrescuraFuente[];
  horizonte: Horizonte;
  onCambiarHorizonte: (h: Horizonte) => void;
}

/**
 * Cabecera sticky móvil (README §5, punto 1): marca + frescura comprimida a
 * una línea (`"09:14 · 3 fuentes · 1 atrasada"`) + los horizontes en segmentado
 * de ancho completo, `min-height: 44px` cada botón.
 *
 * `top-0`, y esto ES una corrección: antes decía `top-14` porque la Torre vivía
 * dentro de `AppShell`, que pone su propia barra sticky de 56 px en móvil. La
 * Torre se mudó a `(consola)`, cuyo layout devuelve `children` a secas — sin
 * shell y sin barra. El `top-14` que sobrevivió a esa mudanza dejaba 56 px de
 * hueco por el que se veía pasar el contenido al hacer scroll.
 *
 * El segmentado NO lleva `grid-cols-N` fijo: se deriva de `HORIZONTES.length`.
 * Con `grid-cols-4` y tres horizontes quedaba una cuarta columna vacía y los
 * botones ocupaban tres cuartos del ancho.
 */
export function CabeceraSticky({ ahoraIso, frescura, horizonte, onCambiarHorizonte }: Props) {
  const atrasadas = frescura.filter((f) => f.estado === "atrasada").length;
  const caidas = frescura.filter((f) => f.estado === "caida").length;
  const partes = [`${frescura.length} fuentes`];
  if (caidas > 0) partes.push(`${caidas} caída${caidas === 1 ? "" : "s"}`);
  if (atrasadas > 0) partes.push(`${atrasadas} atrasada${atrasadas === 1 ? "" : "s"}`);

  return (
    <header className="sticky top-0 z-20 border-b-2 border-tc-chasis bg-tc-papel">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative inline-block size-[11px] shrink-0 bg-tc-tinta" aria-hidden="true">
            <span className="absolute top-0 right-0 size-[4px] bg-tc-papel" />
          </span>
          <span className="truncate text-[14px] font-extrabold text-tc-tinta">Torre de control</span>
        </div>
        <p className="tc-num shrink-0 text-[11px] text-tc-ink-600">
          {horaSantiago(ahoraIso)} · {partes.join(" · ")}
        </p>
      </div>
      <div
        className="grid border-t border-tc-ink-300"
        style={{ gridTemplateColumns: `repeat(${HORIZONTES.length}, minmax(0, 1fr))` }}
      >
        {HORIZONTES.map((h, i) => {
          const activo = horizonte === h.valor;
          return (
            <button
              key={h.valor}
              type="button"
              onClick={() => onCambiarHorizonte(h.valor)}
              aria-pressed={activo}
              className={[
                "min-h-[44px] py-[9px] text-[11px] font-extrabold tracking-[0.04em] uppercase",
                i > 0 ? "border-l border-tc-ink-300" : "",
                activo ? "bg-tc-tinta text-tc-papel" : "bg-tc-papel text-tc-tinta",
                FOCO_ANILLO,
              ].join(" ")}
            >
              {h.etiqueta}
            </button>
          );
        })}
      </div>
    </header>
  );
}
