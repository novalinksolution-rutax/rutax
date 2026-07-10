/**
 * Estado de carga de las liquidaciones de conductores (área del courier).
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function CargandoLiquidaciones() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <Skeleton className="h-4 w-28" />
        </div>
        <ul className="divide-y divide-border">
          {Array.from({ length: 7 }).map((_, i) => (
            <li key={i} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-32" />
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
