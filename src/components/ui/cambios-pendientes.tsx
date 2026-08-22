"use client"

import { ArrowUp } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * FranjaCambiosPendientes y MarcadorFilaActualizada — las dos mitades de la
 * tabla que se actualiza sola sin moverle el suelo a quien está trabajando.
 *
 * LA REGLA, Y ES MIXTA SEGÚN EL TIPO DE CAMBIO
 * ---------------------------------------------------------------------------
 * No es «refrescar todo» ni «no refrescar nada». Son dos comportamientos
 * distintos para dos cosas distintas:
 *
 * · **Lo que YA está en pantalla se actualiza en su lugar**, con una señal breve
 *   de que cambió. Un pedido que pasa de «asignado» a «en ruta» cambia ahí
 *   mismo: no se mueve de fila, no empuja nada, y el marcador dice qué pasó.
 *
 * · **Lo que ENTRARÍA nuevo no se inserta solo.** Se acumula, se cuenta y se
 *   anuncia en esta franja. El usuario decide cuándo incorporarlo.
 *
 * POR QUÉ, EN CONCRETO
 * ---------------------------------------------------------------------------
 * Porque el coordinador está seleccionando treinta filas de doscientas para
 * asignarlas antes de las 16:00. Si entran pedidos nuevos y la lista se reordena
 * bajo el dedo, pierde la selección o toca la equivocada. Insertar filas solo
 * mientras alguien selecciona es la forma más cara de ser servicial.
 *
 * Con «reducir movimiento» activado el marcador no pulsa: **sostiene el borde
 * tres segundos**. La señal no desaparece, cambia de forma.
 */

export function FranjaCambiosPendientes({
  cantidad,
  onIncorporar,
  compacta = false,
  className,
}: {
  /** Cuántos cambios se acumularon sin insertarse. */
  cantidad: number
  onIncorporar: () => void
  /** Versión corta para 390 px, donde no cabe la frase completa. */
  compacta?: boolean
  className?: string
}) {
  if (cantidad === 0) return null

  return (
    <div
      // `status` y no `alert`: es información, no una interrupción. Un lector de
      // pantalla lo anuncia cuando termina lo que está diciendo, sin cortar.
      role="status"
      aria-live="polite"
      className={cn(
        "sticky top-0 z-10 flex items-center justify-between gap-3",
        "border border-progress-line bg-progress-bg px-3 py-2",
        "rounded-ctrl text-[12.5px] leading-none text-progress-fg",
        className
      )}
    >
      <span className="flex items-center gap-2">
        <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
        {compacta ? (
          <>
            <span className="rx-num font-medium tabular-nums">{cantidad}</span> nuevos
          </>
        ) : (
          <>
            <span className="rx-num font-medium tabular-nums">
              {cantidad.toLocaleString("es-CL")}
            </span>{" "}
            {cantidad === 1 ? "pedido nuevo desde que empezaste" : "pedidos nuevos desde que empezaste"}
          </>
        )}
      </span>

      <button
        type="button"
        onClick={onIncorporar}
        className={cn(
          "shrink-0 rounded-ctrl px-2 py-1 font-medium underline underline-offset-2",
          "transition-colors duration-quick hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rx-focus)]"
        )}
      >
        {compacta ? "Mostrar" : "Mostrarlos"}
      </button>
    </div>
  )
}

/**
 * MarcadorFilaActualizada — envuelve una fila que acaba de cambiar en su lugar.
 *
 * Dura 8 segundos: lo suficiente para que alguien que estaba mirando otra parte
 * de la pantalla lo alcance al volver, y no tanto como para que la tabla quede
 * permanentemente encendida en una operación con cientos de cambios por hora.
 *
 * ⚠️ El borde va en el costado izquierdo, no en un fondo: teñir la fila entera
 * competiría con el distintivo de estado, que es lo que hay que leer.
 */
export function MarcadorFilaActualizada({
  activo,
  children,
  className,
}: {
  activo: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-actualizada={activo ? "" : undefined}
      className={cn(
        "border-l-2 transition-colors",
        // `duration-base` en condiciones normales; con movimiento reducido el
        // token cae a 0 ms y el borde simplemente aparece y se sostiene.
        "duration-base ease-standard",
        activo ? "border-l-[var(--rx-accent)]" : "border-l-transparent",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * Cuánto dura la señal de una fila actualizada, en milisegundos.
 * Vive acá y no en cada pantalla para que las 5 que la usan no se desincronicen.
 */
export const DURACION_MARCADOR_FILA = 8_000
