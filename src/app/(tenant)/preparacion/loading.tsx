/**
 * Esqueleto de "Preparación del día" — LA FORMA FINAL con `<Skeleton>`, nunca
 * un spinner (§11 del documento; mismo principio que
 * `torre-de-control/loading.tsx` y `operaciones/loading.tsx`). Replica las dos
 * columnas de escritorio; en móvil el grid colapsa a una sola, igual que la
 * pantalla real.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function CargandoPreparacion() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      {/* Cabecera: título + subtítulo + indicador en vivo */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-5 w-20" />
      </div>

      {/* Franja de 4 magnitudes */}
      <div className="flex divide-x divide-border border-y border-border">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-1 space-y-2 px-4 py-3 first:pl-0 last:pr-0 sm:px-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Columna izquierda: visitas de hoy */}
        <div className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-5 w-28" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          </div>
        </div>

        {/* Columna derecha: carga por comuna + asignación */}
        <div className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <div className="rounded-lg border border-border">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1.5 border-b border-border px-3 py-2.5 last:border-b-0">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-52" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-32 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
