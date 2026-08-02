/**
 * Estado de carga del manifiesto del conductor (PWA, móvil, terreno).
 *
 * El conductor es el usuario de peor red del sistema; sin este skeleton veía
 * pantalla en blanco mientras el Server Component cargaba. Replica la forma
 * real (encabezado + banner + cards de parada) para que no haya salto de
 * layout al llegar los datos.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function CargandoManifiesto() {
  return (
    <div className="space-y-4 pb-24" aria-busy="true" aria-live="polite">
      {/* Encabezado */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>

      {/* Banner permanente "usa la app de Flex" */}
      <Skeleton className="h-14 w-full rounded-lg" />

      {/* Lista de cards de parada */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-7 w-6" />
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            </div>
            <div className="mt-2 space-y-1.5">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
