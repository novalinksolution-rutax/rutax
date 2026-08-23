import { cn } from "@/lib/utils"

/**
 * FranjaModoPruebas — el rótulo de que nada de esto llega al SII.
 *
 * DECISIÓN 5 DEL TABLERO P4: **el modo de pruebas usa la trama, no un color.**
 * Un color propio habría sido un séptimo tono del sistema, y la trama diagonal
 * ya significa exactamente esto — «fuera de juego, no cuenta» — en la fila
 * cancelada. Es el mismo recurso, no uno nuevo.
 *
 * Y **aparece dos veces, nunca una**: en el marco de la sección y *dentro del
 * botón* que emite («Emitir en modo de pruebas»). El botón cambia de texto, no
 * solo de contexto — quien aprieta no está mirando el encabezado.
 *
 * Usa `rx-inert-row` y no `rx-inert`: la primera tiene el paso más ancho, que
 * es el que corresponde a una franja de ancho completo. La del distintivo queda
 * apretada y vibra.
 */
export function FranjaModoPruebas({
  /** Se ajusta al contenedor: el modal la lleva a sangre, la sección no. */
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "rx-inert-row flex flex-wrap items-center gap-2 border-b border-line px-5 py-2",
        className,
      )}
    >
      <span className="border border-line bg-bg px-1.5 py-1 font-mono text-[10px] font-semibold tracking-[0.1em] text-fg">
        MODO DE PRUEBAS
      </span>
      <span className="text-xs text-fg-muted">
        Nada de lo que emitas llega al SII todavía.
      </span>
      {children}
    </div>
  )
}
