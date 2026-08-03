"use client";

/**
 * Panel para guardar una marca operativa.
 *
 * Aparece cuando el coordinador ya clavó el punto en el mapa (`marcaProvisional`).
 * Hasta que se guarda, la marca vive solo en el estado del navegador y se dibuja
 * distinta; al guardar pasa a `contexto.marcas_operativas` y la ve el equipo.
 *
 * Se queda anclado abajo al centro, sobre el mapa y sin modal: el handoff pide
 * que el coordinador no pierda de vista el tablero mientras anota.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearMarcaOperativa } from "../acciones";
import { MAX_CARACTERES_NOTA } from "../_lib/marcas";
import { BOTON_OUTLINE, BOTON_SOLIDO, FOCO_ANILLO } from "../_lib/estilos";

interface Props {
  posicion: { long: number; lat: number };
  onCancelar: () => void;
  onGuardada: () => void;
}

export function PanelMarca({ posicion, onCancelar, onGuardada }: Props) {
  const [nota, setNota] = useState("");
  const [vigenteHasta, setVigenteHasta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, iniciarEnvio] = useTransition();
  const router = useRouter();

  const restantes = MAX_CARACTERES_NOTA - nota.length;

  function guardar() {
    setError(null);
    iniciarEnvio(async () => {
      const r = await crearMarcaOperativa({
        nota,
        lat: posicion.lat,
        long: posicion.long,
        vigenteHasta: vigenteHasta || undefined,
      });
      if (!r.ok) {
        setError(r.error ?? "No se pudo guardar la marca.");
        return;
      }
      onGuardada();
      router.refresh();
    });
  }

  return (
    <div
      role="dialog"
      aria-label="Guardar marca operativa"
      className="fixed bottom-6 left-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 border-2 border-tc-tinta bg-tc-papel p-4 shadow-tc-lg"
    >
      <p className="text-[9.5px] font-extrabold tracking-[0.1em] text-tc-tinta uppercase">
        Marca operativa
      </p>

      <label htmlFor="marca-nota" className="mt-2 block text-[11px] text-tc-ink-700">
        Qué está pasando en ese punto
      </label>
      <textarea
        id="marca-nota"
        value={nota}
        onChange={(e) => setNota(e.target.value.slice(0, MAX_CARACTERES_NOTA))}
        rows={2}
        autoFocus
        placeholder="Corte en Gran Avenida por obras"
        className={`mt-1 w-full resize-none border border-tc-ink-300 bg-tc-papel px-2 py-1.5 text-[12px] text-tc-tinta placeholder:text-tc-ink-600 ${FOCO_ANILLO}`}
      />
      <p className="mt-1 text-right text-[9.5px] text-tc-ink-600 tabular-nums">
        {restantes} caracteres
      </p>

      <label htmlFor="marca-hasta" className="mt-2 block text-[11px] text-tc-ink-700">
        Vigente hasta <span className="text-tc-ink-600">(opcional)</span>
      </label>
      <input
        id="marca-hasta"
        type="time"
        value={vigenteHasta}
        onChange={(e) => setVigenteHasta(e.target.value)}
        className={`mt-1 border border-tc-ink-300 bg-tc-papel px-2 py-1.5 text-[12px] text-tc-tinta tabular-nums ${FOCO_ANILLO}`}
      />

      {error ? (
        <p role="alert" className="mt-2 text-[11px] font-semibold text-tc-senal-text">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={enviando || nota.trim().length === 0}
          className={`${BOTON_SOLIDO} disabled:opacity-50`}
        >
          {enviando ? "Guardando…" : "Guardar marca"}
        </button>
        <button type="button" onClick={onCancelar} disabled={enviando} className={BOTON_OUTLINE}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
