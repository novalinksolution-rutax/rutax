/**
 * Estado de carga del dashboard (UX_STRATEGY §6.1): skeleton que preserva el
 * layout final — la estructura aparece antes que el dato, sin "saltos".
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function CargandoDashboard() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-64" />
      <div>
        <Skeleton className="mb-3 h-4 w-16" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <Skeleton className="size-9 rounded-lg" />
              <Skeleton className="mt-3 h-7 w-20" />
              <Skeleton className="mt-2 h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div>
        <Skeleton className="mb-3 h-4 w-28" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-7 w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
