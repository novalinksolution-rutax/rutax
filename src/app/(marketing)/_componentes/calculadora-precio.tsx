"use client";

import { useState } from "react";

import { Slider } from "@/components/ui/slider";
import { formatearCLP, formatearMiles } from "@/lib/ui/formato-moneda";

import { PRECIO_POR_ENVIO_CLP } from "../_lib/precio";

const MIN = 500;
const MAX = 40_000;

export function CalculadoraPrecio() {
  const [envios, setEnvios] = useState(3_000);

  return (
    <div className="grid gap-4 rounded-ctrl border border-line bg-bg-raised p-5">
      <div className="flex items-baseline justify-between gap-3">
        <label id="calc-envios" className="text-[15px] font-semibold">
          Envíos al mes
        </label>
        <output htmlFor="calc-slider" className="rx-num font-mono text-lg font-semibold">
          {formatearMiles(envios)}
        </output>
      </div>
      <Slider
        id="calc-slider"
        aria-labelledby="calc-envios"
        min={MIN}
        max={MAX}
        step={500}
        value={[envios]}
        onValueChange={([v]) => setEnvios(v ?? MIN)}
      />
      <div className="-mt-2 flex justify-between font-mono text-[11.5px] text-fg-subtle">
        <span>{formatearMiles(MIN)}</span>
        <span>{formatearMiles(MAX)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t-2 border-line-strong pt-3 font-semibold">
        <span>Al mes, + IVA</span>
        <span className="rx-num font-mono text-[26px] tracking-tight">
          {formatearCLP(envios * PRECIO_POR_ENVIO_CLP)}
        </span>
      </div>
    </div>
  );
}
