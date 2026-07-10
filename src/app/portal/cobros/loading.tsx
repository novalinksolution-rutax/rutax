/**
 * Estado de carga de los cobros del seller (portal).
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function CargandoPortalCobros() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-xs">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-7 w-32" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <ul className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-8 w-24 rounded-lg" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
