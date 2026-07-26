/**
 * Estado de carga de "Mi plan" (UX_STRATEGY §6.1): la ruta puede resolver a dos
 * pantallas distintas (Selector de planes o Mi plan) según si el tenant ya
 * tiene suscripción — este skeleton es neutro entre ambas: encabezado +
 * bloques de tarjeta, sin comprometerse con una tabla ni una grilla de precios
 * específica, para que no "salte" de forma distinta según qué pantalla resuelva.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function CargandoPlan() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  );
}
