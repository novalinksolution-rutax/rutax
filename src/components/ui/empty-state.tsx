import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * EmptyState — estado vacío estandarizado (DESIGN_SYSTEM §9, UX_STRATEGY §6.4).
 *
 * Un empty state nunca es un muro: es una invitación o una explicación.
 * Distinguir los tres tipos vía `tono`:
 *  - "arranque"    → aún no hay datos; explica qué aparecerá y ofrece la acción.
 *  - "buen-estado" → no hay nada *porque todo está bien* (confianza, no ausencia).
 *  - "filtro"      → la búsqueda/filtro no arrojó; ofrece limpiar.
 *
 * El `tono` solo ajusta el color del ícono; el contenido lo decide quien lo usa.
 */
export type TonoEmptyState = "arranque" | "buen-estado" | "filtro"

const COLOR_ICONO: Record<TonoEmptyState, string> = {
  arranque: "text-muted-foreground",
  "buen-estado": "text-success",
  filtro: "text-muted-foreground",
}

interface EmptyStateProps extends React.ComponentProps<"div"> {
  icon?: LucideIcon
  titulo: string
  descripcion?: React.ReactNode
  /** Acción primaria (botón/enlace). Opcional — un "buen-estado" suele no llevar. */
  accion?: React.ReactNode
  tono?: TonoEmptyState
}

function EmptyState({
  icon: Icon,
  titulo,
  descripcion,
  accion,
  tono = "arranque",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      data-tono={tono}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      {Icon ? (
        <div
          className={cn(
            "flex size-11 items-center justify-center rounded-full bg-muted",
            tono === "buen-estado" && "bg-success-subtle"
          )}
        >
          <Icon className={cn("size-5", COLOR_ICONO[tono])} aria-hidden="true" />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="font-heading text-sm font-medium text-foreground">{titulo}</p>
        {descripcion ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{descripcion}</p>
        ) : null}
      </div>
      {accion ? <div className="mt-1">{accion}</div> : null}
    </div>
  )
}

export { EmptyState }
