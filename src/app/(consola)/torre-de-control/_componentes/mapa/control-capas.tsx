"use client";

import type { CapaMapa, EstadoCapa } from "../../_fixture/estado-torre";
import { MAX_CAPAS_ACTIVAS } from "../../_fixture/estado-torre";
import { FOCO_ANILLO_FILA } from "../../_lib/estilos";

interface Props {
  capas: EstadoCapa[];
  activas: CapaMapa[];
  onAlternar: (capa: CapaMapa) => void;
}

/**
 * Control de capas (README §4, flotante arriba-izquierda del mapa).
 *
 * Implementa la regla de producto 2 — máximo 2 capas activas — y la implementa
 * como el handoff la especifica: al llegar al tope, las demás NO desaparecen ni
 * lanzan un error. Se atenúan a .42, cambian su glifo a `⊘`, exponen el motivo
 * y el click sobre ellas es un no-op explícito. Una capa que falla en silencio
 * deja al coordinador creyendo que la encendió.
 *
 * Hay dos motivos distintos por los que una capa puede estar bloqueada, y se
 * dicen distinto porque se resuelven distinto: el TOPE lo resuelve el usuario
 * apagando otra, y la FUENTE CAÍDA no la resuelve nadie desde aquí.
 */
export function ControlCapas({ capas, activas, onAlternar }: Props) {
  const enTope = activas.length >= MAX_CAPAS_ACTIVAS;

  return (
    <div className="w-[196px] border-2 border-tc-tinta bg-tc-papel">
      <div className="flex items-baseline justify-between border-b border-tc-ink-300 px-3 py-2">
        <span className="text-[9px] font-extrabold tracking-[0.14em] text-tc-tinta uppercase">
          Capas
        </span>
        <span className="tc-num text-[9px] text-tc-ink-600">
          {activas.length}/{MAX_CAPAS_ACTIVAS} capas
        </span>
      </div>

      <ul>
        {capas.map((capa) => {
          const activa = activas.includes(capa.id);
          const bloqueadaPorFuente = !capa.disponible;
          const bloqueadaPorTope = !activa && !bloqueadaPorFuente && enTope;
          const bloqueada = bloqueadaPorFuente || bloqueadaPorTope;
          const motivo = bloqueadaPorFuente
            ? capa.motivoNoDisponible
            : bloqueadaPorTope
              ? `Tope de ${MAX_CAPAS_ACTIVAS} capas alcanzado. Apaga una para encender esta.`
              : null;
          const glifo = activa ? "■" : bloqueada ? "⊘" : "□";

          return (
            <li key={capa.id}>
              <button
                type="button"
                // El click sobre una bloqueada es un no-op explícito, no un
                // `disabled`: el botón sigue siendo enfocable y anunciable, que
                // es lo que permite leer el motivo con lector de pantalla.
                onClick={() => {
                  if (!bloqueada) onAlternar(capa.id);
                }}
                aria-pressed={activa}
                aria-disabled={bloqueada}
                title={motivo ?? undefined}
                className={[
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] transition-colors",
                  activa
                    ? "bg-tc-tinta text-tc-papel"
                    : bloqueada
                      ? "cursor-not-allowed text-tc-tinta opacity-[.42]"
                      : "text-tc-tinta hover:bg-tc-inserto",
                  FOCO_ANILLO_FILA,
                ].join(" ")}
              >
                <span className="w-[10px] shrink-0 text-center" aria-hidden="true">
                  {glifo}
                </span>
                <span>{capa.etiqueta}</span>
                {motivo ? <span className="sr-only"> — {motivo}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {enTope ? (
        <p className="bg-tc-inserto px-3 py-1.5 text-[9.5px] leading-snug text-tc-tinta">
          Tope de {MAX_CAPAS_ACTIVAS} capas alcanzado. Apaga una para encender otra.
        </p>
      ) : null}
    </div>
  );
}
