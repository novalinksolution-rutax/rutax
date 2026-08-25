"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Densidades de tabla (DESIGN_SYSTEM §5): `compact` para backoffice denso,
 * `comfortable` por defecto, `relaxed` para el portal del seller. La densidad
 * ajusta el alto de fila vía padding vertical de celdas y alto de encabezado.
 */
type DensidadTabla = "compact" | "comfortable" | "relaxed"

/**
 * ⚠️ **Subió un escalón el 25-08.** Con el lienzo topado en 1152 px la tabla
 * quedaba como una planilla al centro de la pantalla: apretada y lejos. Al
 * abrir los listados a ancho fluido, la densidad de antes dejaba filas
 * delgadas cruzando 1.600 px, que es peor — el ojo pierde el renglón a mitad
 * de camino.
 *
 * Cada fila gana ~8 px y el cuerpo pasa a 15 px (ver `Table`). Se pierden dos
 * o tres filas por pantalla; con 30 pedidos al día eso no cambia el trabajo, y
 * lo que se gana es que la tabla se lee de lejos.
 */
const DENSIDAD: Record<DensidadTabla, string> = {
  compact: "[&_td]:py-2 [&_th]:h-10",
  comfortable: "[&_td]:py-3 [&_th]:h-11",
  relaxed: "[&_td]:py-4 [&_th]:h-13",
}

function Table({
  className,
  densidad = "comfortable",
  ...props
}: React.ComponentProps<"table"> & { densidad?: DensidadTabla }) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        data-densidad={densidad}
        // `text-[15px]` y no `text-sm`: un punto más, que es lo que hace que
        // se lea de lejos sin cambiar la caja de nada.
        className={cn("w-full caption-bottom text-[15px]", DENSIDAD[densidad], className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors duration-(--motion-fast) ease-standard hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle text-xs font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
