import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto de la Torre — **con la forma final, nunca un spinner de página**.
 *
 * Es uno de los cuatro estados de diseño de primera clase del módulo, no un
 * relleno: la pantalla se mira en dos minutos y varias veces al día, así que lo
 * que se ve mientras carga tiene que anticipar dónde va a estar cada cifra. Un
 * spinner centrado hace que todo salte de posición al llegar el dato.
 */
export default function CargandoTorre() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Las cuatro magnitudes, en su fila y con sus separadores. */}
      <div className="flex divide-x divide-border border-y border-border">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-1 space-y-2 px-4 py-3 first:pl-0 last:pr-0 sm:px-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>

      {/* Caja del mapa + panel, con la misma altura que tendrán. */}
      <div
        className="flex overflow-hidden rounded-lg border border-border"
        style={{ height: "max(420px, min(68vh, 720px))" }}
      >
        <Skeleton className="hidden flex-1 rounded-none lg:block" />
        <div className="w-full space-y-3 border-l border-border p-3 lg:w-[340px] lg:shrink-0">
          <Skeleton className="h-9 w-full" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1.5 px-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-52" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
