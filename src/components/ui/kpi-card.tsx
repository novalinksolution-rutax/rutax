import type { LucideIcon } from "lucide-react"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * KpiCard — patrón D de Retell (dashboard analítico): número grande centrado en
 * un panel inset sutil, con label arriba-izquierda, tendencia opcional e hint al
 * pie. Es el bloque canónico de las métricas del dashboard del courier y del
 * overview del admin — reemplaza las cards inline dispares por un ritmo único.
 *
 * El valor se pasa ya formateado (usa <MontoCLP> para dinero, o el número/texto
 * que corresponda) para no acoplar el KPI a un formato.
 */
export function KpiCard({
  label,
  valor,
  hint,
  icono: Icono,
  tendencia,
  accion,
  className,
}: {
  label: string
  valor: React.ReactNode
  hint?: string
  icono?: LucideIcon
  tendencia?: "sube" | "baja" | "estable"
  /** Acción opcional al pie (enlace/botón), p. ej. "Asignar ahora". */
  accion?: React.ReactNode
  className?: string
}) {
  const IconoTendencia = tendencia === "sube" ? TrendingUp : tendencia === "baja" ? TrendingDown : Minus
  const colorTendencia =
    tendencia === "sube"
      ? "text-success-subtle-foreground"
      : tendencia === "baja"
        ? "text-destructive"
        : "text-muted-foreground"

  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-xs", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {Icono ? <Icono className="size-4" aria-hidden="true" /> : null}
          {label}
        </span>
        {tendencia ? <IconoTendencia className={cn("size-4", colorTendencia)} aria-hidden="true" /> : null}
      </div>
      <div className="rounded-lg bg-muted/50 py-5 text-center">
        <p className="font-mono text-3xl leading-none font-semibold tabular-nums text-foreground">{valor}</p>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {accion ? <div>{accion}</div> : null}
    </div>
  )
}
