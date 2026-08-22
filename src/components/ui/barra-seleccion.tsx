"use client"

import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * BarraSeleccion — la barra persistente que aparece cuando hay filas
 * seleccionadas, y desde donde se dispara la acción en bloque.
 *
 * Es el patrón con más consecuencia económica del producto: es la carrera contra
 * el despacho de las 16:00. El coordinador filtra, selecciona treinta pedidos y
 * los asigna de una vez.
 *
 * TRES COSAS QUE NO SON OBVIAS Y SIN ELLAS NO SIRVE
 * ---------------------------------------------------------------------------
 *
 * 1 · LA COMPOSICIÓN, NO SOLO EL CONTEO.
 *    «30 seleccionados» no alcanza para decidir. Lo que el coordinador necesita
 *    saber antes de asignar es de qué están hechos esos 30: cuántas comunas,
 *    cuántos sellers, cuántos ya son de otro conductor. Un conteo solo obliga a
 *    abrir el panel de revisión para todo; la composición deja decidir sin
 *    abrirlo.
 *
 * 2 · CONGELA EL REFRESCO MIENTRAS HAY SELECCIÓN.
 *    La tabla se actualiza sola. Si entran pedidos nuevos y la lista se reordena
 *    con treinta filas marcadas, el coordinador pierde la selección o —peor—
 *    asigna la equivocada sin notarlo. Mientras esta barra está visible, **lo
 *    que entra se acumula y se anuncia, no se inserta.** De eso se encarga
 *    `FranjaCambiosPendientes`.
 *
 * 3 · VIVE ABAJO, NO ARRIBA.
 *    En tablet y teléfono la mano está abajo. Y en escritorio, anclarla abajo
 *    evita que tape la cabecera de la tabla justo cuando se está eligiendo.
 */

export interface ParteComposicion {
  /** `4 comunas`, `2 sellers`, `6 de otro conductor` */
  etiqueta: string
  /** Marca las partes que exigen una confirmación extra antes de actuar. */
  alerta?: boolean
}

export function BarraSeleccion({
  cantidad,
  composicion,
  onLimpiar,
  children,
  className,
}: {
  cantidad: number
  /** De qué está hecha la selección. Sin esto hay que abrir el panel para todo. */
  composicion?: ParteComposicion[]
  onLimpiar: () => void
  /** Las acciones en bloque. La primaria va al final, que es donde cae el pulgar. */
  children: React.ReactNode
  className?: string
}) {
  if (cantidad === 0) return null

  return (
    <div
      role="region"
      aria-label={`${cantidad} seleccionados`}
      className={cn(
        "sticky bottom-0 z-20 flex flex-wrap items-center gap-3",
        // El orden importa: `border-line` pinta los cuatro lados, así que la
        // regla de acento va DESPUÉS o se la come.
        "border border-b-0 border-line border-t-2 border-t-[var(--rx-accent)]",
        "bg-bg-raised px-4 py-3",
        className
      )}
    >
      {/* La regla de acento de 2px arriba es el único subrayado del sistema.
          Sustituye a la sombra, que no existe. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-baseline gap-2 leading-none">
          <span className="rx-num text-[19px] font-semibold text-fg tabular-nums">
            {cantidad.toLocaleString("es-CL")}
          </span>
          <span className="text-[13.5px] text-fg-muted">
            {cantidad === 1 ? "seleccionado" : "seleccionados"}
          </span>
        </p>

        {composicion && composicion.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] leading-none">
            {composicion.map((parte, i) => (
              <span key={parte.etiqueta} className="flex items-center gap-2">
                {i > 0 ? <span aria-hidden="true" className="text-fg-subtle">·</span> : null}
                <span className={parte.alerta ? "text-attention-fg" : "text-fg-subtle"}>
                  {parte.etiqueta}
                </span>
              </span>
            ))}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onLimpiar}
          className={cn(
            "inline-flex min-h-target-min items-center gap-1.5 rounded-ctrl px-3",
            "text-[13.5px] text-fg-muted transition-colors duration-quick hover:text-fg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rx-focus)]"
          )}
        >
          <X className="size-4" aria-hidden="true" />
          Quitar selección
        </button>
        {children}
      </div>
    </div>
  )
}
