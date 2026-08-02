import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Pagination — paginación presentacional para tablas de gran volumen
 * (DESIGN_SYSTEM §5). Pensada para listados de Server Components paginados por
 * URL: recibe la página actual, el total de páginas y un constructor de href.
 * Muestra siempre el total ("1–50 de 1.240" si se entrega `resumen`).
 */
interface PaginationProps {
  pagina: number
  totalPaginas: number
  /** Construye el href de una página dada (preserva filtros de la URL). */
  hrefPagina: (pagina: number) => string
  /** Texto de resumen opcional, p. ej. "320 pedidos" o "1–25 de 320". */
  resumen?: React.ReactNode
}

function BotonPagina({
  href,
  habilitado,
  children,
  "aria-label": ariaLabel,
}: {
  href: string
  habilitado: boolean
  children: React.ReactNode
  "aria-label": string
}) {
  if (!habilitado) {
    return (
      <Button variant="outline" size="sm" disabled aria-label={ariaLabel}>
        {children}
      </Button>
    )
  }
  return (
    <Button asChild variant="outline" size="sm" aria-label={ariaLabel}>
      <Link href={href}>{children}</Link>
    </Button>
  )
}

export function Pagination({ pagina, totalPaginas, hrefPagina, resumen }: PaginationProps) {
  return (
    <nav
      className="flex items-center justify-between gap-3"
      aria-label="Paginación"
    >
      <span className="text-xs text-muted-foreground tabular-nums">
        {resumen ?? `Página ${pagina} de ${totalPaginas}`}
      </span>
      <div className="flex items-center gap-2">
        <BotonPagina
          href={hrefPagina(pagina - 1)}
          habilitado={pagina > 1}
          aria-label="Página anterior"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Anterior
        </BotonPagina>
        <BotonPagina
          href={hrefPagina(pagina + 1)}
          habilitado={pagina < totalPaginas}
          aria-label="Página siguiente"
        >
          Siguiente
          <ChevronRight className="size-4" aria-hidden="true" />
        </BotonPagina>
      </div>
    </nav>
  )
}
