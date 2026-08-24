/**
 * La carga de Pedidos, mientras llegan las cifras.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ESTE ESQUELETO DURA MUY POCO, Y ES A PROPÓSITO
 * -----------------------------------------------------------------------------
 * `page.tsx` solo espera la consulta **de cifras**, que es barata; la lista se
 * pasa como promesa y se suspende dentro de su propio `<Suspense>`. Así que la
 * secuencia real es:
 *
 * 1. esto, un instante;
 * 2. **los cajones con sus números de verdad** y la tabla en esqueleto;
 * 3. las filas.
 *
 * El coordinador sabe cuánto hay antes de ver una sola fila, que es lo que pide
 * el tablero. Si `page.tsx` esperara las dos consultas, esta pantalla se
 * quedaría acá hasta que llegara la más lenta.
 *
 * -----------------------------------------------------------------------------
 * PULSO DE OPACIDAD, NO BRILLO QUE BARRE
 * -----------------------------------------------------------------------------
 * El destello que recorre un bloque es la convención, y acá está mal: esta
 * consola se mira **diez horas seguidas**, y un brillo que cruza la pantalla
 * cada segundo y medio persigue la vista. El pulso dice lo mismo sin llamar.
 *
 * Y los altos son **los reales**, así que nada salta al llegar los datos — que
 * es justo el defecto que un esqueleto viene a evitar y el que casi todos
 * terminan causando.
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function CargandoOperaciones() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando los pedidos…</span>

      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-44" />
      </div>

      {/* Barra de cajones: siete bloques, los mismos que va a haber. */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-28" />
        ))}
      </div>

      {/* Chips de filtro */}
      <div className="flex flex-wrap gap-1.5">
        {[64, 120, 96, 88].map((ancho, i) => (
          <Skeleton key={i} className="h-7" style={{ width: ancho }} />
        ))}
      </div>

      {/* Filas, con el alto real. */}
      <div className="border border-line">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex h-row-desktop items-center gap-3 border-b border-line px-4 last:border-b-0 pointer-coarse:h-row-touch motion-safe:animate-pulse"
          >
            <Skeleton className="h-5 w-20 shrink-0" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="ml-auto hidden h-4 w-24 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
