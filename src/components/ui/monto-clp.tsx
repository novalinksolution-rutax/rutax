import { cn } from "@/lib/utils"
import { formatearCLP, formatearAjuste } from "@/lib/ui/formato-moneda"

/**
 * MontoCLP — presentación canónica de dinero en la UI (regla Rutax): fuente
 * mono con `tabular-nums` para que las columnas de montos alineen, negativo en
 * rojo, `null` como "—". Envuelve `formato-moneda.ts` (única fuente del formato);
 * NO reimplementa el formateo.
 *
 * - `monto` null/undefined → "—" muted.
 * - `conSigno` → usa `formatearAjuste` (+/-, verde/rojo) para ajustes de líneas.
 * - `enfasis` → peso semibold (para totales y saldos destacados).
 */
export function MontoCLP({
  monto,
  conSigno = false,
  enfasis = false,
  className,
}: {
  monto: number | null | undefined
  conSigno?: boolean
  enfasis?: boolean
  className?: string
}) {
  const base = cn("font-mono tabular-nums", enfasis && "font-semibold", className)

  if (monto === null || monto === undefined) {
    return <span className={cn(base, "text-muted-foreground")}>—</span>
  }

  if (conSigno) {
    const { texto, esNegativo, esPositivo } = formatearAjuste(monto)
    return (
      <span
        className={cn(
          base,
          esNegativo && "text-destructive",
          esPositivo && "text-success-subtle-foreground",
        )}
      >
        {texto}
      </span>
    )
  }

  return <span className={cn(base, monto < 0 && "text-destructive")}>{formatearCLP(monto)}</span>
}
