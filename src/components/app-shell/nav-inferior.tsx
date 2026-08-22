"use client"

import Link from "next/link"

import { cn } from "@/lib/utils"
import { ICONOS, type ItemNav } from "./iconos-nav"

// ⚠️ `destinosMovil` NO se re-exporta desde acá. Este módulo lleva
// `"use client"`, y re-exportar a través de él volvería a convertir la función
// pura en una referencia de cliente — que es justo el bug que la separó.
// Los layouts de servidor importan de `./destinos-movil`.

/**
 * NavInferior — la barra de cuatro destinos del teléfono.
 *
 * POR QUÉ EXISTE
 * ---------------------------------------------------------------------------
 * Hoy, en 390 px, el backoffice y el portal tienen **una hamburguesa y nada
 * más**: cada cambio de pantalla son dos toques y un panel que tapa el
 * contenido. Y no es un caso raro — el coordinador trabaja de pie en la bodega
 * toda la mañana, con una mano ocupada. El tablero P1 lo dice sin rodeos: el
 * teléfono no es una reducción del escritorio.
 *
 * CUATRO, Y DERIVADOS DEL ROL
 * ---------------------------------------------------------------------------
 * Cuatro es el máximo que cabe con área táctil honesta en 390 px. Cuáles son
 * los cuatro **no es una constante**: los de quien coordina no son los de
 * Administración. Se eligen tomando los primeros cuatro de `PRIORIDAD` que la
 * persona pueda ver de verdad, así que la barra sale del mismo gating RBAC que
 * el sidebar y no de una lista aparte que se desincroniza.
 *
 * LO QUE NO ESTÁ ACÁ, Y ES A PROPÓSITO
 * ---------------------------------------------------------------------------
 * El resto de la navegación **no desaparece**: sigue completa en el panel de la
 * hamburguesa. Esta barra es un atajo a lo que se abre veinte veces al día, no
 * un recorte del producto.
 */

export function NavInferior({
  items,
  hrefActivo,
  className,
}: {
  items: ItemNav[]
  /** El href más específico que prefija el pathname, calculado por el shell. */
  hrefActivo: string | null
  className?: string
}) {
  if (items.length === 0) return null

  return (
    <nav
      aria-label="Navegación principal"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-background/95 backdrop-blur lg:hidden",
        "pb-[env(safe-area-inset-bottom)]",
        className
      )}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const Icono = item.icono ? ICONOS[item.icono as keyof typeof ICONOS] : undefined
        const activo = item.href === hrefActivo
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={activo ? "page" : undefined}
            className={cn(
              // 56 px de alto: es el mínimo con el que se acierta de pie y con
              // una mano. No baja aunque sobre espacio.
              "relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5",
              "text-[11px] font-medium leading-none transition-colors",
              activo ? "text-brand" : "text-muted-foreground"
            )}
          >
            {Icono ? <Icono className="size-5 shrink-0" aria-hidden="true" /> : null}
            <span className="max-w-full truncate">{item.etiquetaCorta ?? item.etiqueta}</span>
            {typeof item.contador === "number" && item.contador > 0 ? (
              <span
                className={cn(
                  "absolute top-1.5 right-[calc(50%-1.5rem)] min-w-4 rounded-full px-1",
                  "bg-fault-fg text-[9px] leading-4 font-semibold text-bg"
                )}
              >
                {item.contador > 9 ? "9+" : item.contador}
                <span className="sr-only"> sin gestionar</span>
              </span>
            ) : null}
            {/* El activo lleva además una regla arriba: en `sun` el color solo
                no alcanza, y el subrayado sobrevive al monocromo. */}
            {activo ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-3 top-0 h-0.5 rounded-b bg-brand"
              />
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
