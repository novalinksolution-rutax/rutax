"use client";

import { useState } from "react";

import { Slider } from "@/components/ui/slider";
import { formatearCLP, formatearMiles } from "@/lib/ui/formato-moneda";

import { costoMensual } from "../_lib/precio";

const MIN = 100;
const MAX = 40_000;

/** Calcula el mes con los tramos graduados y el mínimo (`_lib/precio.ts`). */
export function CalculadoraPrecio() {
  const [entregas, setEntregas] = useState(5_000);
  const { total, aplicaMinimo, promedio } = costoMensual(entregas);

  return (
    <div className="grid gap-4 rounded-ctrl border border-line bg-bg-raised p-5">
      <div className="flex items-baseline justify-between gap-3">
        <label id="calc-entregas" className="text-[15px] font-semibold">
          Entregas al mes
        </label>
        <output htmlFor="calc-slider" translate="no" className="rx-num font-mono text-lg font-semibold">
          {formatearMiles(entregas)}
        </output>
      </div>
      <Slider
        id="calc-slider"
        aria-labelledby="calc-entregas"
        min={MIN}
        max={MAX}
        step={100}
        value={[entregas]}
        onValueChange={([v]) => setEntregas(v ?? MIN)}
      />
      <div className="-mt-2 flex justify-between font-mono text-[11.5px] text-fg-subtle">
        <span>{formatearMiles(MIN)}</span>
        <span>{formatearMiles(MAX)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-[14.5px] text-fg-muted">
        {/* Bajo 500 entregas el mes no alcanza el mínimo: se dice, en vez de mostrar un promedio inflado. */}
        {/* `key`: React reemplaza el elemento en vez de editar un texto que el traductor pudo envolver. */}
        <span key={aplicaMinimo ? "minimo" : "promedio"}>{aplicaMinimo ? "Se cobra el mínimo mensual" : "Promedio por entrega"}</span>
        {/* `translate="no"`: el traductor de Chrome congela la cifra en su
            primera versión y deja de seguir al deslizador. */}
        {aplicaMinimo ? null : (
          <span translate="no" className="rx-num font-mono text-fg">
            {formatearCLP(promedio)}
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t-2 border-line-strong pt-3 font-semibold">
        <span>Al mes, + IVA</span>
        <span translate="no" className="rx-num font-mono text-[26px] tracking-tight">
          {formatearCLP(total)}
        </span>
      </div>
    </div>
  );
}
