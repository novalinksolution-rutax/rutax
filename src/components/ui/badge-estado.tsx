import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { BadgeVariante } from "@/lib/ui/traduccion-estados"

/**
 * BadgeEstado — render canónico de un estado de dominio (pedido, DTE, incidencia,
 * período, liquidación, conciliación…). Combina el patrón de Retell "punto de
 * color + texto" con las variantes semánticas de `<Badge>`. El color NUNCA es el
 * único portador de significado: el texto traducido siempre acompaña (a11y).
 *
 * La variante y el texto vienen de `lib/ui/traduccion-estados.ts` (única fuente):
 *   <BadgeEstado variante={BADGE_ESTADO_PEDIDO[p.estado]} texto={traducirEstadoPedido(p.estado)} />
 */

/** Color del punto por variante de Badge (coincide con el token de estado). */
const PUNTO_POR_VARIANTE: Record<BadgeVariante, string> = {
  default: "bg-primary",
  secondary: "bg-muted-foreground",
  destructive: "bg-destructive",
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  error: "bg-destructive",
  neutral: "bg-muted-foreground",
  outline: "bg-foreground",
}

export function BadgeEstado({
  variante,
  texto,
  conPunto = true,
  className,
}: {
  variante: BadgeVariante
  texto: string
  conPunto?: boolean
  className?: string
}) {
  return (
    <Badge variant={variante} className={className}>
      {conPunto ? (
        <span className={cn("size-1.5 shrink-0 rounded-full", PUNTO_POR_VARIANTE[variante])} aria-hidden="true" />
      ) : null}
      {texto}
    </Badge>
  )
}
