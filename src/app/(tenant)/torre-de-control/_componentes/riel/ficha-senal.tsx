"use client";

import { useState } from "react";
import type { Senal } from "../../_fixture/estado-torre";
import { formatoVentanaCorta, horaSantiago } from "../../_lib/tiempo";
import { BOTON_OUTLINE, FOCO_ANILLO } from "../../_lib/estilos";

interface Props {
  senal: Senal;
  ahoraIso: string;
  fuentesAbiertas: boolean;
  onAlternarFuentes: () => void;
}

/**
 * Ficha de señal de prensa (README §4). "Una tarjeta por acontecimiento, no
 * por artículo": las 3 fuentes viven colapsadas tras "Ver las 3 fuentes".
 *
 * Nota de alcance: `marcaHumana` (confirmar/descartar) todavía no tiene un
 * endpoint — se guarda local, igual que `descartadas` de excepciones se
 * describe como "optimista" mientras el POST va detrás.
 */
export function FichaSenal({ senal, ahoraIso, fuentesAbiertas, onAlternarFuentes }: Props) {
  const [marca, setMarca] = useState<Senal["marcaHumana"]>(senal.marcaHumana);

  return (
    <article className="border-t border-tc-ink-300 px-3.5 py-3.5">
      <div className="mb-2 flex flex-wrap gap-1.5">
        <ChipOutline>confianza {Math.round(senal.confianza * 100)} %</ChipOutline>
        <ChipOutline>{senal.fuentes.length} medios</ChipOutline>
        <ChipOutline>{senal.pedidosEnRango} pedidos</ChipOutline>
      </div>

      <p className="text-[14px] leading-[1.2] font-extrabold text-tc-tinta">{senal.titulo}</p>
      <p className="mt-1.5 text-[11.5px] leading-[1.4] text-tc-ink-700">{senal.resumen}</p>

      <p className="mt-2 text-[10px] text-tc-ink-600">
        {senal.comunas.join(" · ")}
        {senal.ejesViales.length ? ` · ${senal.ejesViales.join(" · ")}` : ""}
        {senal.ventana ? ` · ${formatoVentanaCorta(senal.ventana, ahoraIso)}` : ""}
      </p>

      <button
        type="button"
        onClick={onAlternarFuentes}
        aria-expanded={fuentesAbiertas}
        className={`mt-2 text-[11px] font-semibold text-tc-tinta underline underline-offset-[3px] hover:text-tc-ink-700 ${FOCO_ANILLO}`}
      >
        Ver las {senal.fuentes.length} fuentes
      </button>

      {fuentesAbiertas ? (
        <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-tc-ink-300 pl-3">
          {senal.fuentes.map((f) => (
            <li key={f.url} className="text-[10.5px] text-tc-ink-700">
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer noopener"
                className={`font-semibold text-tc-tinta underline underline-offset-[3px] hover:text-tc-ink-700 ${FOCO_ANILLO}`}
              >
                {f.medio}
              </a>{" "}
              · {horaSantiago(f.publicadoEn)} · {f.titular}
            </li>
          ))}
        </ul>
      ) : null}

      {marca === null ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={BOTON_OUTLINE}
            onClick={() => setMarca("confirmada")}
          >
            Confirmar
          </button>
          <button
            type="button"
            className={BOTON_OUTLINE}
            onClick={() => setMarca("descartada")}
          >
            Descartar
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[10.5px] font-semibold text-tc-ink-600 uppercase">
          {marca === "confirmada" ? "Marcada como relevante" : "Marcada como no relevante"}
        </p>
      )}
    </article>
  );
}

function ChipOutline({ children }: { children: React.ReactNode }) {
  return (
    <span className="tc-num border border-tc-ink-300 px-1.5 py-0.5 text-[9.5px] font-semibold text-tc-ink-700 uppercase">
      {children}
    </span>
  );
}
