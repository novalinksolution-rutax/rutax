"use client";

import { useState } from "react";

/**
 * Los diálogos de acción de un período traen su propio botón. Para abrirlos
 * desde el menú ⋯ de la ficha lateral, aceptan además `abierto` +
 * `onAbiertoChange`: si llegan, manda el que llama y el botón propio no se
 * dibuja. La lógica, la confirmación y los permisos del diálogo no cambian.
 */
export interface AbiertoControlable {
  abierto?: boolean;
  onAbiertoChange?: (abierto: boolean) => void;
}

export function useAbiertoControlable({ abierto, onAbiertoChange }: AbiertoControlable) {
  const [interno, setInterno] = useState(false);
  const controlado = abierto !== undefined;
  return {
    controlado,
    abierto: controlado ? abierto : interno,
    setAbierto: (v: boolean) => (controlado ? onAbiertoChange?.(v) : setInterno(v)),
  };
}
