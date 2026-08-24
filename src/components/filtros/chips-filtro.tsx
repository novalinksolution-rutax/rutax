"use client";

/**
 * Los filtros como chips.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ CAMBIA RESPECTO A UNA FILA DE SELECTS
 * -----------------------------------------------------------------------------
 * Una fila de cinco `select` ocupa el mismo espacio esté filtrando o no, y **no
 * se distingue de un vistazo lo que está puesto de lo que se podría poner**: hay
 * que leer los cinco valores para saber si alguno dice algo distinto de «Todos».
 *
 * Con chips, lo aplicado y lo disponible son **dos formas distintas**:
 *
 * · **aplicado** — chip sólido, `Seller · Vega Norte ×`. Se lee sin buscar, y la
 *   × lo quita sin abrir nada.
 * · **disponible** — chip de borde punteado, `+ Conductor`. Ocupa poco, dice qué
 *   más se puede acotar, y al tocarlo aparece su control.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ NI LA URL A LA VISTA NI UN BOTÓN DE COMPARTIR
 * -----------------------------------------------------------------------------
 * El tablero dibuja la dirección escrita bajo los filtros, con el argumento de
 * que es lo que el coordinador le pega al supervisor por WhatsApp. **Se retira
 * entero** (decisión del usuario, 24-08-2026): los filtros viven en la URL para
 * que la vista **se pueda guardar y volver atrás**, no para compartirla. Ese es
 * su trabajo, y lo hace sin ocupar un solo píxel.
 *
 * Añadirle una línea de `?seller=…&comuna=…` —o incluso un botón— es cobrarle
 * espacio permanente a la pantalla más usada del producto por un gesto que no
 * ocurre. Quien de verdad necesite el enlace lo tiene en la barra del navegador.
 */

import * as React from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ChipFiltro {
  clave: string;
  /** «Seller», «Comuna». Va antes del punto medio. */
  etiqueta: string;
  /**
   * Lo que está filtrando, ya legible («Vega Norte», «Ñuñoa, Maipú»).
   * `null` = no aplicado: se dibuja como chip disponible.
   */
  valor: string | null;
  /** El control que aparece al abrir el chip. El mismo, aplicado o no. */
  control: React.ReactNode;
  /**
   * Quitar el filtro. `undefined` en los que **no se pueden quitar** —la fecha
   * siempre está puesta— y entonces el chip no lleva ×.
   */
  onQuitar?: () => void;
}

export function ChipsFiltro({
  chips,
  onLimpiarTodo,
  className,
}: {
  chips: ChipFiltro[];
  onLimpiarTodo?: () => void;
  className?: string;
}) {
  const aplicados = chips.filter((c) => c.valor !== null);
  const disponibles = chips.filter((c) => c.valor === null);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
          Filtros
        </span>

        {aplicados.map((c) => (
          <ChipAplicado key={c.clave} chip={c} />
        ))}
        {disponibles.map((c) => (
          <ChipDisponible key={c.clave} chip={c} />
        ))}

        {onLimpiarTodo && aplicados.some((c) => c.onQuitar) ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onLimpiarTodo}
            className="h-7 px-2 text-fg-muted"
          >
            Limpiar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Aplicado: sólido, con su valor y su ×. Al tocarlo se cambia; la × lo quita. */
function ChipAplicado({ chip }: { chip: ChipFiltro }) {
  return (
    <span className="inline-flex items-center border border-brand bg-accent-deep">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex min-h-7 items-center gap-1 px-2 text-sm hover:bg-bg-inset"
          >
            <span className="text-fg-muted">{chip.etiqueta}</span>
            <span aria-hidden="true" className="text-fg-subtle">
              ·
            </span>
            <span className="font-medium">{chip.valor}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          {chip.control}
        </PopoverContent>
      </Popover>

      {chip.onQuitar ? (
        <button
          type="button"
          onClick={chip.onQuitar}
          aria-label={`Quitar el filtro de ${chip.etiqueta.toLowerCase()}`}
          className="flex min-h-7 items-center px-1.5 text-fg-muted hover:bg-bg-inset hover:text-fg"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

/**
 * Disponible: borde punteado y un `+`.
 *
 * El punteado es lo que **distingue lo que está filtrando de lo que puede
 * filtrar** sin leer un solo valor. Con el mismo borde que los aplicados habría
 * que mirar cuál trae un valor detrás del punto medio, que es exactamente el
 * trabajo que los chips vienen a quitar.
 */
function ChipDisponible({ chip }: { chip: ChipFiltro }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-7 items-center gap-1 border border-dashed border-line px-2 text-sm text-fg-muted hover:border-line-strong hover:text-fg"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {chip.etiqueta}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        {chip.control}
      </PopoverContent>
    </Popover>
  );
}
