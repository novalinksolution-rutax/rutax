/**
 * Estado de carga genérico del área del conductor (PWA, móvil).
 *
 * Sirve de fallback para las rutas del conductor que no tienen su propio
 * `loading.tsx` (p. ej. liquidaciones y el detalle de parada). Se muestra
 * dentro del shell del conductor (la cabecera se mantiene), así el conductor
 * ve estructura de inmediato aunque su red sea lenta.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function CargandoConductor() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <Skeleton className="h-6 w-40" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="mt-2 h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
