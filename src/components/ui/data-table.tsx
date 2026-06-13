import { cn } from "@/lib/utils"

/**
 * DataTable — "chrome" estandarizado para listados tabulares del backoffice
 * (DESIGN_SYSTEM §5). No es un motor de columnas: es la envoltura consistente
 * (tarjeta + barra de herramientas + pie de paginación) dentro de la cual se
 * compone una `Table`. Mantiene el ritmo visual idéntico entre pedidos,
 * liquidaciones, conciliación y cobranza sin imponer una API de columnas.
 *
 * Uso:
 *   <DataTable toolbar={<span>{total} pedidos</span>} footer={<Pagination … />}>
 *     <Table densidad="compact">…</Table>
 *   </DataTable>
 */
interface DataTableProps {
  /** Contenido de la barra superior (conteo, búsqueda, acciones masivas). */
  toolbar?: React.ReactNode
  /** Contenido del pie (típicamente <Pagination />). */
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function DataTable({ toolbar, footer, children, className }: DataTableProps) {
  return (
    <div
      data-slot="data-table"
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card shadow-xs",
        className
      )}
    >
      {toolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          {toolbar}
        </div>
      ) : null}
      {children}
      {footer ? <div className="border-t border-border px-4 py-3">{footer}</div> : null}
    </div>
  )
}
