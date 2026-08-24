"use client"

import * as React from "react"

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
 * EL CAJÓN TRANSVERSAL, QUE ES OTRA COSA QUE EL EXCLUIDO
 * ---------------------------------------------------------------------------
 * `excluido` está FUERA de los grupos: un pedido cancelado no está además
 * pendiente. `transversal` los CRUZA: «Con problemas», en períodos, cuenta tanto
 * uno cerrado con una excepción como uno ya facturado que el SII rechazó, así
 * que sus filas **ya están contadas** en los grupos de la izquierda.
 *
 * Meterlo entre los demás daba un número mayor que el total y dejaba la
 * declaración ilegible — «35 en los grupos de arriba» sobre 27 filas. Va después
 * del separador, no suma, y la barra dice que cruza.
 *
 * LOS CONTADORES CUENTAN SOBRE EL CONJUNTO FILTRADO
 * ---------------------------------------------------------------------------
 * No sobre la página visible. Si el coordinador filtró por comuna, los cajones
 * dicen cuántos hay en esa comuna, no cuántos hay en las 50 filas que alcanzó a
 * cargar. Un contador que cuenta la página es un contador que miente.
 */

/**
 * Cuántos cajones quedaron fuera de la vista.
 *
 * ⚠️ **Se mide con `IntersectionObserver` y no con aritmética de anchos.** Un
 * cálculo de «ancho total menos ancho visible partido por ancho de cajón» supone
 * que todos miden lo mismo, y no lo hacen: «Sin asignar» y «En ruta» tienen
 * etiquetas de largo distinto, y el conteo cambia el ancho de cada uno cuando
 * pasa de 8 a 128. El observador pregunta por lo que de verdad se ve.
 *
 * Vuelve a medir al desplazar y al cambiar el tamaño, porque las dos cosas
 * cambian la respuesta y ninguna dispara al observador por sí sola en todos los
 * navegadores.
 */
function useCajonesFuera() {
  const ref = React.useRef<HTMLDivElement>(null)
  const [fuera, setFuera] = React.useState(0)

  React.useEffect(() => {
    const tira = ref.current
    if (!tira) return

    const hijos = () => [...tira.children].filter((h) => h instanceof HTMLElement) as HTMLElement[]

    const medir = () => {
      // Sin desbordamiento no hay nada fuera: en escritorio la tira se envuelve
      // y todos se ven, aunque algunos queden en otra línea.
      if (tira.scrollWidth <= tira.clientWidth + 1) {
        setFuera(0)
        return
      }
      const borde = tira.getBoundingClientRect().right
      const invisibles = hijos().filter((h) => h.getBoundingClientRect().right > borde + 1).length
      setFuera(invisibles)
    }

    medir()
    tira.addEventListener("scroll", medir, { passive: true })
    const observador = new ResizeObserver(medir)
    observador.observe(tira)
    return () => {
      tira.removeEventListener("scroll", medir)
      observador.disconnect()
    }
  })

  return { ref, fuera }
}

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
  transversal,
  activo,
  onSeleccionar,
  total,
  className,
}: {
  cajones: Cajon[]
  /** El cajón que NO suma: `cancelado` en pedidos. Va tras el separador, en `inert`. */
  excluido?: Cajon
  /**
   * El cajón que CRUZA los grupos: «Con problemas», en períodos. Sus filas ya
   * están contadas a la izquierda, así que no suma — y no va en `inert`, porque
   * lo que agrupa sí está en juego.
   */
  transversal?: Cajon
  /** Clave del cajón activo, o `null` para «todos». */
  activo: string | null
  onSeleccionar: (clave: string | null) => void
  /** Total real del conjunto filtrado, incluido el excluido. */
  total: number
  className?: string
}) {
  const sumaCajones = cajones.reduce((acc, c) => acc + c.conteo, 0)
  const noCuadra = excluido !== undefined && sumaCajones !== total
  const { ref: refTira, fuera } = useCajonesFuera()

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2">
      <div
        ref={refTira}
        role="group"
        aria-label="Filtrar por estado"
        // ⚠️ **Con el dedo la tira NO se envuelve: se desplaza.** Envuelta, siete
        // cajones ocupan tres líneas y empujan la tabla fuera de la pantalla en
        // un teléfono — el coordinador pierde el listado para ganar un filtro que
        // usa una vez. Con el puntero sí se envuelve, porque ahí sobra el ancho y
        // una tira que se desplaza esconde opciones sin necesidad.
        className={cn(
          "flex items-stretch gap-1",
          "flex-wrap",
          "pointer-coarse:flex-nowrap pointer-coarse:overflow-x-auto pointer-coarse:pb-1",
          // Sin barra visible: en táctil el desplazamiento se descubre
          // empujando, y una barra de scroll sobre 6 px de alto no la ve nadie.
          "pointer-coarse:[scrollbar-width:none] pointer-coarse:[&::-webkit-scrollbar]:hidden",
        )}
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

        {excluido || transversal ? (
          <>
            {/* El separador es la señal de que lo que sigue no pertenece a la
                misma suma. Es un elemento de significado, no un adorno. */}
            <span
              aria-hidden="true"
              className="mx-1 w-px shrink-0 self-stretch bg-line-subtle"
            />
            {transversal ? (
              <BotonCajon
                etiqueta={transversal.etiqueta}
                conteo={transversal.conteo}
                activo={activo === transversal.clave}
                onClick={() => onSeleccionar(transversal.clave)}
              />
            ) : null}
            {excluido ? (
              <BotonCajon
                etiqueta={excluido.etiqueta}
                conteo={excluido.conteo}
                activo={activo === excluido.clave}
                onClick={() => onSeleccionar(excluido.clave)}
                inerte
              />
            ) : null}
          </>
        ) : null}
      </div>
      {/* «→ 2 más». No es un indicador de desplazamiento: es el **número** de
          cajones que quedaron fuera de la vista. Un borde difuminado avisa de que
          hay más; una cifra dice cuántos, que es lo que decide si vale la pena
          empujar la tira. */}
      {fuera > 0 ? (
        <span
          aria-hidden="true"
          className="rx-num hidden shrink-0 font-mono text-[10.5px] text-fg-subtle pointer-coarse:inline"
        >
          → {fuera} más
        </span>
      ) : null}
      </div>

      {/* La declaración de que la suma no cuadra, y por qué. Sin esto, alguien
          va a sumar los cajones, no le va a dar, y va a reportar un bug que no
          existe. */}
      {/* La aclaración del transversal solo si tiene contenido: «sus 0 ya están
          contados a la izquierda» es una explicación de nada. */}
      {noCuadra || (transversal && transversal.conteo > 0) ? (
        <p className="font-mono text-[10.5px] leading-snug text-fg-subtle">
          {noCuadra ? (
            <span className="block">
              {sumaCajones.toLocaleString("es-CL")} en los grupos de arriba ·{" "}
              {excluido!.conteo.toLocaleString("es-CL")} {excluido!.etiqueta.toLowerCase()} ·{" "}
              <span className="text-fg-muted">{total.toLocaleString("es-CL")} en total</span>
            </span>
          ) : null}
          {transversal && transversal.conteo > 0 ? (
            <span className="block">
              «{transversal.etiqueta}» cruza los estados:{" "}
              {transversal.conteo === 1
                ? "el suyo ya está contado"
                : `sus ${transversal.conteo.toLocaleString("es-CL")} ya están contados`}{" "}
              a la izquierda.
            </span>
          ) : null}
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
