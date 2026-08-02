"use client";

import Link from "next/link";
import type { FrescuraFuente, Horizonte } from "../_fixture/estado-torre";
import { minutosPrimeTorre } from "../_lib/formato";
import { FOCO_ANILLO } from "../_lib/estilos";
import { HORIZONTES } from "../_lib/horizontes";

interface Props {
  courierNombre: string;
  horizonte: Horizonte;
  frescura: FrescuraFuente[];
  /** Destino del control de salida: la consola vive fuera del shell de `(tenant)`. */
  hrefSalida: string;
  onCambiarHorizonte: (h: Horizonte) => void;
  onAbrirPaleta: () => void;
}

/**
 * R1 · Barra superior (README §4, 52 px). Marca · horizonte · frescura ·
 * comandos. La frescura no es un ícono de estado: es la edad en minutos,
 * siempre visible.
 */
export function R1BarraSuperior({
  courierNombre,
  horizonte,
  frescura,
  hrefSalida,
  onCambiarHorizonte,
  onAbrirPaleta,
}: Props) {
  return (
    <header className="flex h-[var(--tc-h-barra)] shrink-0 items-stretch bg-tc-papel">
      {/* Marca */}
      <div className="flex items-center gap-2.5 border-r border-tc-ink-300 py-0 pr-[18px] pl-5">
        <span className="relative inline-block size-[13px] shrink-0 bg-tc-tinta" aria-hidden="true">
          <span className="absolute top-0 right-0 size-[5px] bg-tc-papel" />
        </span>
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-extrabold tracking-[-0.01em] text-tc-tinta">
            Torre de control
          </span>
          <span className="text-[11px] font-normal text-tc-ink-600">{courierNombre}</span>
        </span>
      </div>

      {/* Horizonte */}
      <div
        className="flex items-center border-r border-tc-ink-300 px-4"
        role="group"
        aria-label="Horizonte temporal"
      >
        <div className="flex border border-tc-ink-300">
          {HORIZONTES.map((h, i) => {
            const activo = horizonte === h.valor;
            return (
              <button
                key={h.valor}
                type="button"
                onClick={() => onCambiarHorizonte(h.valor)}
                aria-pressed={activo}
                className={[
                  "px-[12px] py-[6px] text-[11.5px] font-extrabold tracking-[0.04em] uppercase transition-colors",
                  i > 0 ? "border-l border-tc-ink-300" : "",
                  activo
                    ? "bg-tc-tinta text-tc-papel"
                    : "bg-tc-papel text-tc-tinta hover:bg-tc-inserto",
                  FOCO_ANILLO,
                ].join(" ")}
              >
                {h.etiqueta}
                <span className="ml-1 text-[8.5px] font-semibold opacity-50">{h.tecla}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Frescura */}
      <div className="flex flex-1 items-center gap-4 overflow-x-auto px-4">
        <span className="shrink-0 text-[8.5px] font-extrabold tracking-[0.16em] text-tc-ink-600 uppercase">
          Frescura
        </span>
        {frescura.map((f) => (
          <CeldaFrescura key={f.id} fuente={f} />
        ))}
      </div>

      {/* Comandos */}
      <div className="flex items-center border-l border-tc-ink-300 px-4">
        <button
          type="button"
          onClick={onAbrirPaleta}
          className={`flex items-center gap-2 border border-tc-ink-300 px-3 py-1.5 text-[11px] text-tc-tinta transition-colors hover:border-tc-tinta ${FOCO_ANILLO}`}
        >
          Comandos <kbd className="text-[9px] font-semibold">⌘K</kbd>
        </button>
      </div>

      {/* Salida.
          La consola vive fuera del shell de `(tenant)`: no hay sidebar que la
          devuelva al resto del producto, así que la vuelta la ofrece ella misma.
          Va al final de la barra y en peso normal — es una salida, no una acción
          del tablero, y no debe competir con el horizonte ni con los comandos. */}
      <div className="flex items-center border-l border-tc-ink-300 px-4">
        <Link
          href={hrefSalida}
          className={`flex items-center gap-1.5 px-1 py-1.5 text-[11px] text-tc-ink-700 transition-colors hover:text-tc-tinta ${FOCO_ANILLO}`}
        >
          <span aria-hidden="true">←</span> Salir de la consola
        </Link>
      </div>
    </header>
  );
}

function CeldaFrescura({ fuente }: { fuente: FrescuraFuente }) {
  const esCaida = fuente.estado === "caida";
  const esAtrasada = fuente.estado === "atrasada";
  const glifo = esCaida ? "✕" : esAtrasada ? "▲" : "·";

  return (
    <span
      className={[
        "flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[9px] tracking-wide uppercase",
        esCaida
          ? "font-extrabold text-tc-senal-text"
          : esAtrasada
            ? "border border-tc-ink-300 font-extrabold text-tc-tinta"
            : "font-normal text-tc-ink-600",
      ].join(" ")}
      title={fuente.motivo ?? undefined}
    >
      <span aria-hidden="true">{glifo}</span>
      <span>{fuente.nombre}</span>
      {/* Sin `actualizadoEn` la fuente NUNCA se actualizó con éxito, así que no
          tiene edad que mostrar. Se imprime «—» y no «0′»: un cero al lado del
          nombre se lee como dato recién llegado, que es lo contrario de lo que
          pasa. (El contrato declara `actualizadoEn` no-nulo; la columna es
          nullable justamente por este caso, y el composer lo trae vacío.) */}
      <span className="tc-num">
        {fuente.actualizadoEn ? minutosPrimeTorre(fuente.edadMinutos) : "—"}
      </span>
      {fuente.motivo ? <span className="sr-only"> — {fuente.motivo}</span> : null}
    </span>
  );
}
