/**
 * Estado de carga de la lista de pedidos del seller (portal).
 * Skeleton que preserva la estructura (encabezado + filas) para no "saltar".
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function CargandoPortalPedidos() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-48" />
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <Skeleton className="h-4 w-24" />
        </div>
        <ul className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
