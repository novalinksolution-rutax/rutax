"use client";

/**
 * Panel "Ver selección" (`Sheet` derecha) — agrupado por comuna (§6.3).
 * Cada fila con `[x]` individual para deseleccionar sin volver a la tabla.
 * `Con {conductor}` en tono advertencia si ya está asignado — el riesgo se
 * ve ANTES del diálogo de reasignación. `Fuera del filtro actual` en tono
 * neutro: la otra mitad de hacer visible lo invisible.
 */

import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { agruparSeleccionPorComuna, type PedidoSeleccionado } from "../_lib/seleccion";

interface Props {
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
  seleccion: ReadonlyMap<string, PedidoSeleccionado>;
  idsVisibles: ReadonlySet<string>;
  onQuitar: (pedidoId: string) => void;
  onVaciarTodo: () => void;
}

export function PanelSeleccion({ abierto, onOpenChange, seleccion, idsVisibles, onQuitar, onVaciarTodo }: Props) {
  const grupos = agruparSeleccionPorComuna(seleccion);
  const total = seleccion.size;

  return (
    <Sheet open={abierto} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Pedidos seleccionados</SheetTitle>
          <SheetDescription className="tabular-nums">{total} en total</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          {grupos.map((grupo) => (
            <div key={grupo.comuna ?? "__sin_comuna__"} className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {grupo.comuna ?? "Sin comuna conocida"}
              </h3>
              <ul className="space-y-2">
                {grupo.pedidos.map((pedido) => (
                  <li key={pedido.pedidoId} className="rounded-lg border border-border p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate font-mono text-sm font-medium">{pedido.codigoVisible}</p>
                        {pedido.sellerNombre && (
                          <p className="truncate text-xs text-muted-foreground">{pedido.sellerNombre}</p>
                        )}
                        {pedido.estado === "asignado" && (
                          <p className="flex items-center gap-1 text-xs text-warning-subtle-foreground">
                            <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                            Con {pedido.conductorActualNombre ?? "otro conductor"}
                          </p>
                        )}
                        {!idsVisibles.has(pedido.pedidoId) && (
                          <p className="text-xs text-muted-foreground">Fuera del filtro actual</p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Quitar ${pedido.codigoVisible} de la selección`}
                        onClick={() => onQuitar(pedido.pedidoId)}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border p-4">
          <Button type="button" variant="ghost" size="sm" onClick={onVaciarTodo} className="text-muted-foreground">
            Vaciar toda la selección
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
