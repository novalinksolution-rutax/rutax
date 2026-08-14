"use client";

/**
 * Aviso "Mostrando X de Y…" con el toggle "Seleccionar los Y" ↔ "Los Y…
 * Deseleccionar todos" (§6.4). Puramente presentacional — controlado desde
 * `bandeja-asignar.tsx`, que es quien sabe resolver TODOS los ids del
 * filtro (`seleccion-completa.ts`) y quien decide cuándo el toggle cambia de
 * lado.
 *
 * Solo aparece si el total filtrado excede la página actual (`page.tsx`
 * decide si renderizar este componente en absoluto).
 */

import { Button } from "@/components/ui/button";

interface Props {
  mostrados: number;
  total: number;
  seleccionCompleta: boolean;
  cargando: boolean;
  onSeleccionarTodo: () => void;
  onDeseleccionarTodo: () => void;
}

export function AvisoTruncamiento({
  mostrados,
  total,
  seleccionCompleta,
  cargando,
  onSeleccionarTodo,
  onDeseleccionarTodo,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
      {seleccionCompleta ? (
        <>
          <span className="text-muted-foreground tabular-nums">
            Los {total} pedidos de este filtro están seleccionados.
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onDeseleccionarTodo} disabled={cargando}>
            Deseleccionar todos
          </Button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground tabular-nums">
            Mostrando {mostrados} de {total} pedidos que cumplen este filtro.
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onSeleccionarTodo} loading={cargando}>
            Seleccionar los {total}
          </Button>
        </>
      )}
    </div>
  );
}
