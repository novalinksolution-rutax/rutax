import { cn } from "@/lib/utils"
import { formatearMiles } from "@/lib/ui/formato-moneda"

/**
 * CalcePago — el calce de un movimiento bancario, mostrado como RESTA.
 *
 * LA IDEA DEL PATRÓN
 * ---------------------------------------------------------------------------
 * El tablero B2b: **el calce se muestra como resta, no como estado.** Tres
 * líneas en mono —cuánto entró, cuánto se atribuye, cuánto queda— y es el mismo
 * `bloque de composición` de B2a puesto a trabajar en la dirección contraria.
 *
 * Hoy la pantalla de cobranza no muestra nada de esto: se elige un período de
 * una lista y se aprieta «Atribuir» **a ciegas**. Si el monto no calza, uno se
 * entera después, por el estado que quedó.
 *
 * LOS DOS CASOS RAROS TIENEN NOMBRE Y CONSECUENCIA ESCRITA
 * ---------------------------------------------------------------------------
 * No son estados inventados: son dos de los seis valores del eje de atribución.
 * · **Pago parcial** — queda un resto, y ese resto *sigue disponible* para otro
 *   período. Decirlo importa: sin eso parece plata perdida.
 * · **Pagó de más** — sobra, y el excedente *queda a favor del seller*, visible
 *   en su próximo período.
 */

export function CalcePago({
  /** Lo que entró al banco. */
  montoMovimiento,
  /** Lo que se le va a imputar al período elegido. */
  montoPeriodo,
  /** Cómo se llama el período, para la línea del medio. */
  etiquetaPeriodo,
  className,
}: {
  montoMovimiento: number
  montoPeriodo: number | null
  etiquetaPeriodo?: string
  className?: string
}) {
  // Sin período elegido no hay resta que mostrar: el movimiento entero queda
  // sin atribuir, y eso ya lo dice su estado.
  if (montoPeriodo === null) return null

  const imputado = Math.min(montoMovimiento, montoPeriodo)
  const resto = montoMovimiento - imputado
  const falta = montoPeriodo - imputado

  return (
    <div className={cn("border border-line bg-bg-sunken px-3 py-2.5", className)}>
      <p className="font-mono text-[11.5px] leading-relaxed text-fg-muted tabular-nums">
        {formatearMiles(montoMovimiento)} del movimiento
        <br />
        <span aria-hidden="true">− </span>
        <span className="sr-only">menos </span>
        {formatearMiles(imputado)} al período{etiquetaPeriodo ? ` ${etiquetaPeriodo}` : ""}
      </p>
      <p
        className={cn(
          "mt-2 border-t border-line-subtle pt-2 font-mono text-[13px] font-semibold tabular-nums",
          resto === 0 && falta === 0 ? "text-balanced-fg" : "text-attention-fg"
        )}
      >
        = {formatearMiles(resto)} sin atribuir
      </p>

      {resto === 0 && falta === 0 ? (
        <p className="mt-1.5 text-xs text-fg-muted">Calce exacto: el período queda pagado.</p>
      ) : falta > 0 ? (
        <p className="mt-1.5 text-xs text-fg-muted">
          Al período le seguirán faltando{" "}
          <strong className="text-fg">{formatearMiles(falta)}</strong>. El movimiento queda como{" "}
          <strong className="text-fg">pago parcial</strong>.
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-fg-muted">
          Sobran <strong className="text-fg">{formatearMiles(resto)}</strong>: el movimiento queda
          como <strong className="text-fg">pagó de más</strong> y el excedente sigue a favor del
          seller, visible en su próximo período.
        </p>
      )}
    </div>
  )
}
