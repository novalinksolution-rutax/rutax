"use client"

import { cn } from "@/lib/utils"

/**
 * BarraCajones — la barra de grupos de estado con su contador, que encabeza los
 * listados del producto (pedidos, asignar, conciliación, períodos, liquidaciones,
 * portal y backstage: 15 pantallas).
 *
 * LO QUE LA HACE DISTINTA DE UNAS PESTAÑAS
 * ---------------------------------------------------------------------------
 * Unas pestañas parten un contenido en vistas. Esto es otra cosa: es un filtro
 * con memoria de cuántos hay en cada lado, y **tiene un cajón que queda fuera de
 * la suma a propósito**.
 *
 * En pedidos, `cancelado` no pertenece a ningún grupo operativo: no está
 * pendiente, no está en ruta y no se entregó. Si se sumara con los demás, el
 * total de la barra no cuadraría con el total de la tabla y nadie sabría por qué.
 * Entonces va **después de un separador, en tono `inert`**, y la barra declara
 * el total real.
 *
 * ⚠️ **La interfaz no puede mentir sobre esto.** Que la suma de los cajones no dé
 * el total es correcto, y hay que decirlo — no esconderlo.
 *
 * LOS CONTADORES CUENTAN SOBRE EL CONJUNTO FILTRADO
 * ---------------------------------------------------------------------------
 * No sobre la página visible. Si el coordinador filtró por comuna, los cajones
 * dicen cuántos hay en esa comuna, no cuántos hay en las 50 filas que alcanzó a
 * cargar. Un contador que cuenta la página es un contador que miente.
 */

export interface Cajon {
  /** Clave del grupo, la que viaja en la URL. */
  clave: string
  etiqueta: string
  /** Sobre el conjunto filtrado completo, nunca sobre la página. */
  conteo: number
}

export function BarraCajones({
  cajones,
  excluido,
  activo,
  onSeleccionar,
  total,
  className,
}: {
  cajones: Cajon[]
  /** El cajón que NO suma: `cancelado` en pedidos. Va tras el separador, en `inert`. */
  excluido?: Cajon
  /** Clave del cajón activo, o `null` para «todos». */
  activo: string | null
  onSeleccionar: (clave: string | null) => void
  /** Total real del conjunto filtrado, incluido el excluido. */
  total: number
  className?: string
}) {
  const sumaCajones = cajones.reduce((acc, c) => acc + c.conteo, 0)
  const noCuadra = excluido !== undefined && sumaCajones !== total

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        role="group"
        aria-label="Filtrar por estado"
        className="flex flex-wrap items-stretch gap-1"
      >
        <BotonCajon
          etiqueta="Todos"
          conteo={total}
          activo={activo === null}
          onClick={() => onSeleccionar(null)}
        />

        {cajones.map((c) => (
          <BotonCajon
            key={c.clave}
            etiqueta={c.etiqueta}
            conteo={c.conteo}
            activo={activo === c.clave}
            onClick={() => onSeleccionar(c.clave)}
          />
        ))}

        {excluido ? (
          <>
            {/* El separador es la señal de que lo que sigue no pertenece a la
                misma suma. Es un elemento de significado, no un adorno. */}
            <span
              aria-hidden="true"
              className="mx-1 w-px shrink-0 self-stretch bg-line-subtle"
            />
            <BotonCajon
              etiqueta={excluido.etiqueta}
              conteo={excluido.conteo}
              activo={activo === excluido.clave}
              onClick={() => onSeleccionar(excluido.clave)}
              inerte
            />
          </>
        ) : null}
      </div>

      {/* La declaración de que la suma no cuadra, y por qué. Sin esto, alguien
          va a sumar los cajones, no le va a dar, y va a reportar un bug que no
          existe. */}
      {noCuadra ? (
        <p className="font-mono text-[10.5px] leading-none text-fg-subtle">
          {sumaCajones.toLocaleString("es-CL")} en los grupos de arriba ·{" "}
          {excluido!.conteo.toLocaleString("es-CL")} {excluido!.etiqueta.toLowerCase()} ·{" "}
          <span className="text-fg-muted">{total.toLocaleString("es-CL")} en total</span>
        </p>
      ) : null}
    </div>
  )
}

function BotonCajon({
  etiqueta,
  conteo,
  activo,
  onClick,
  inerte = false,
}: {
  etiqueta: string
  conteo: number
  activo: boolean
  onClick: () => void
  inerte?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        // Alto de objetivo táctil: esta barra se opera con el dedo en la bodega.
        "inline-flex min-h-target-min items-center gap-2 border px-3 py-1.5",
        "rounded-ctrl text-[13.5px] leading-none transition-colors duration-quick",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rx-focus)]",
        activo
          ? "border-[var(--rx-accent)] bg-accent-deep text-fg font-medium"
          : "border-line bg-bg-raised text-fg-muted hover:text-fg",
        // El excluido lleva su trama incluso apagado: es lo que dice, sin leer
        // el número, que ese cajón no juega en la misma suma.
        inerte && !activo && "rx-inert"
      )}
    >
      {etiqueta}
      <span
        className={cn(
          "rx-num text-[11.5px] tabular-nums",
          activo ? "text-fg" : "text-fg-subtle"
        )}
      >
        {conteo.toLocaleString("es-CL")}
      </span>
    </button>
  )
}
