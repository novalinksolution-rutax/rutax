"use client";

/**
 * Selector de comuna — multi-selección compuesta con `Popover` + `Checkbox`
 * ya disponibles en el repo, SIN dependencia nueva (§5.1, criterio §15).
 *
 * La lista no es el catálogo completo de la RM (serían ~52 filas casi todas
 * en cero) sino las comunas que HOY tienen al menos un pedido asignable, con
 * su conteo — la trae `listarComunasConAsignables` y `page.tsx` la pasa acá
 * ya resuelta.
 */

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ComunaOpcion {
  /** Nunca `null` acá — "sin comuna conocida" no es un valor de filtro válido (§5.1). */
  comuna: string;
  total: number;
}

interface Props {
  opciones: ComunaOpcion[];
  seleccionadas: readonly string[];
  onCambiar: (siguiente: string[]) => void;
}

export function SelectorComuna({ opciones, seleccionadas, onCambiar }: Props) {
  const [abierto, setAbierto] = useState(false);
  const marcadas = new Set(seleccionadas);
  // Prefijo único por INSTANCIA (no por comuna): `FiltrosBandeja` monta este
  // componente dos veces a la vez (fila de escritorio + `Sheet` móvil, una
  // oculta por CSS, ambas presentes en el DOM) — con un id estático, las dos
  // instancias generarían el mismo `id` de checkbox por comuna.
  const idInstancia = useId();

  function alternar(comuna: string) {
    const siguiente = new Set(marcadas);
    if (siguiente.has(comuna)) siguiente.delete(comuna);
    else siguiente.add(comuna);
    onCambiar([...siguiente]);
  }

  const etiquetaTrigger = seleccionadas.length > 0 ? `Comuna (${seleccionadas.length})` : "Comuna";

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="default" className="h-9" aria-expanded={abierto}>
          {etiquetaTrigger}
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {opciones.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">No hay comunas con pedidos asignables hoy.</p>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => onCambiar(opciones.map((o) => o.comuna))}
              >
                Seleccionar todas
              </button>
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground hover:underline"
                onClick={() => onCambiar([])}
              >
                Limpiar
              </button>
            </div>
            <ul className="max-h-72 overflow-y-auto p-1">
              {opciones.map((opcion) => {
                const marcado = marcadas.has(opcion.comuna);
                const idCheckbox = `${idInstancia}-comuna-${opcion.comuna}`;
                return (
                  <li key={opcion.comuna}>
                    <label
                      htmlFor={idCheckbox}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <span className="flex items-center gap-2">
                        <Checkbox
                          id={idCheckbox}
                          checked={marcado}
                          onCheckedChange={() => alternar(opcion.comuna)}
                        />
                        {opcion.comuna}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">{opcion.total}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
