import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * TableSkeleton — estado de carga de una tabla (principio 7 de Rutax + patrón F
 * de Retell): filas skeleton con el MISMO layout que la data real, nunca un
 * spinner suelto. Se compone dentro de <DataTable> mientras llega la data.
 *
 * `anchos` define el ancho relativo de cada columna (fracciones de grid); su
 * longitud fija el número de columnas. `filas` fija cuántas filas fantasma.
 */
export function TableSkeleton({
  anchos = [3, 2, 2, 1],
  filas = 6,
  className,
}: {
  anchos?: number[]
  filas?: number
  className?: string
}) {
  const columnas = anchos.map((a) => `${a}fr`).join(" ")

  return (
    <div className={cn("divide-y divide-border", className)} aria-hidden="true">
      {/* Encabezado fantasma */}
      <div className="grid items-center gap-4 px-4 py-2.5" style={{ gridTemplateColumns: columnas }}>
        {anchos.map((_, i) => (
          <Skeleton key={i} className="h-3 w-16" />
        ))}
      </div>
      {/* Filas fantasma */}
      {Array.from({ length: filas }).map((_, fila) => (
        <div key={fila} className="grid items-center gap-4 px-4 py-3" style={{ gridTemplateColumns: columnas }}>
          {anchos.map((_, col) => (
            <Skeleton key={col} className={cn("h-4", col === 0 ? "w-full max-w-40" : "w-full max-w-24")} />
          ))}
        </div>
      ))}
    </div>
  )
}
