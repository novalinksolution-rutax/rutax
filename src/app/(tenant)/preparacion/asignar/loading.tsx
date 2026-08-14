/**
 * Esqueleto de "Asignar pedidos" — LA FORMA FINAL con `<Skeleton>`, nunca un
 * spinner (§12 del documento; mismo principio que `preparacion/loading.tsx`,
 * `torre-de-control/loading.tsx` y `operaciones/loading.tsx`). Breadcrumb,
 * título + subtítulo, cuatro filtros en fila, ocho filas de tabla,
 * paginación. Sin barra inferior — no hay selección posible antes de que
 * lleguen los datos.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function CargandoAsignarPedidos() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      {/* Breadcrumb */}
      <Skeleton className="h-4 w-48" />

      {/* Cabecera: título + subtítulo + indicador en vivo */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-5 w-20" />
      </div>

      {/* Cuatro filtros en fila */}
      <div className="flex flex-wrap items-end gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-44" />
          </div>
        ))}
      </div>

      {/* Tabla: ocho filas */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-4 border-b border-border bg-muted/40 px-4 py-2.5">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-28" />
        </div>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
        {/* Paginación */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <Skeleton className="h-3 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-7 w-20" />
          </div>
        </div>
      </div>
    </div>
  );
}
