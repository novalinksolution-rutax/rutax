"use client";

/**
 * La fila de seller, entera pulsable.
 *
 * Existe porque `page.tsx` es un Server Component y abrir la vista previa
 * necesita un manejador de clic. Se aísla acá en vez de convertir la página
 * entera en cliente: el resto se sigue renderizando en el servidor.
 *
 * ⚠️ **El enlace del nombre NO se retira**, aunque ahora la fila entera abra el
 * panel. Son dos destinos distintos y los dos hacen falta: el panel es la mirada
 * rápida, el enlace lleva a la ficha completa y es lo único que da acceso por
 * teclado y clic medio. Por eso el manejador **se aparta cuando el clic cayó
 * sobre un control**.
 */

import type { ReactNode } from "react";

import { TableRow } from "@/components/ui/table";
import { useVistaPreviaLateral } from "@/components/ui/vista-previa-lateral";
import { cn } from "@/lib/utils";

export function FilaSeller({ sellerId, children }: { sellerId: string; children: ReactNode }) {
  const vistaPrevia = useVistaPreviaLateral();

  return (
    <TableRow
      onClick={(evento) => {
        if (
          (evento.target as HTMLElement).closest(
            "a,button,input,select,[role='button'],[role='menuitem']",
          )
        ) {
          return;
        }
        vistaPrevia?.abrir(sellerId);
      }}
      className={cn(
        vistaPrevia && "cursor-pointer",
        // La fila abierta se marca en el borde, no con fondo: la tabla ya está
        // atenuada y un fondo teñido no se distingue de nada.
        vistaPrevia?.id === sellerId &&
          "[&>td:first-child]:border-l-2 [&>td:first-child]:border-l-brand",
        "pointer-coarse:[&>td]:h-row-touch",
      )}
    >
      {children}
    </TableRow>
  );
}
