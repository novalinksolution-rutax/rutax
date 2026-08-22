"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Interruptor — el control de encendido/apagado del sistema de diseño.
 *
 * Es el único componente del bloque 1 que se construye de cero: el producto no
 * tenía ninguno. Cubre 14 pantallas — banderas de conciliación, disponibilidad
 * del conductor, cobro automático, notificaciones.
 *
 * LO QUE LO SEPARA DE UN TOGGLE CUALQUIERA: LA ETIQUETA DE CONSECUENCIA
 * ---------------------------------------------------------------------------
 * Un interruptor sin consecuencia escrita obliga a adivinar qué pasa al tocarlo,
 * y en este producto lo que pasa suele ser plata: apagar el cobro automático
 * significa que nadie va a cobrar el mes que viene. Por eso `consecuencia` NO es
 * decorativa — declara, en presente, qué está ocurriendo ahora mismo por estar
 * encendido y qué ocurriría apagado.
 *
 *   <Interruptor
 *     etiqueta="Cobro automático"
 *     consecuencia={{
 *       encendido: "Te cobramos el plan el día 5 de cada mes.",
 *       apagado:   "Nadie te va a cobrar: tienes que pagar a mano cada mes.",
 *     }}
 *     checked={activo}
 *     onCheckedChange={setActivo}
 *   />
 *
 * DESHABILITADO CON MOTIVO, NO DESHABILITADO A SECAS
 * ---------------------------------------------------------------------------
 * Un control apagado sin explicación manda a la persona a buscar en otra
 * pantalla por qué no puede hacer algo. `motivoDeshabilitado` se muestra en
 * lugar de la consecuencia y va colgado por `aria-describedby`, así que el
 * lector de pantalla lo anuncia junto al control y no como texto suelto.
 *
 * EL COLOR NO ES LA ÚNICA SEÑAL
 * ---------------------------------------------------------------------------
 * Regla 5 del sistema. Acá las señales son tres y ninguna depende de la vista a
 * color: la POSICIÓN del pulgar, el TEXTO de consecuencia que cambia, y
 * `aria-checked` para quien no ve ninguna de las dos.
 *
 * NOTAS DE IMPLEMENTACIÓN QUE NO SON OBVIAS
 * ---------------------------------------------------------------------------
 * · **Sin sombras** (regla 4): el pulgar se separa del riel por contraste de
 *   fondo y borde, nunca por elevación.
 * · **El acento se usa como relleno**, que es uno de sus tres usos legítimos —
 *   fondo, borde y glifo. Va por `bg-primary`, que `rx-puente.css` ya repunta a
 *   `--rx-accent`; escribirlo así lo deja seguir al tema sin recalcular nada.
 * · **La duración sale de `--rx-dur-quick`**, que bajo `prefers-reduced-motion`
 *   vale `0ms` por definición en `rx-tokens.css`. No hace falta una consulta de
 *   medios acá: el token ya la trae.
 * · **`cargando` deshabilita pero no vacía**: el interruptor conserva su
 *   posición mientras el servidor responde, porque hacerlo saltar y volver es
 *   peor que esperar.
 */

export interface ConsecuenciaInterruptor {
  /** Qué está pasando AHORA por estar encendido. En presente. */
  encendido: string
  /** Qué pasaría —o pasa— estando apagado. En presente. */
  apagado: string
}

export function Interruptor({
  etiqueta,
  consecuencia,
  motivoDeshabilitado,
  cargando = false,
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  ...props
}: Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, "children"> & {
  /** Qué controla. Si no se pasa, el control queda solo y hay que darle `aria-label`. */
  etiqueta?: string
  /** Qué ocurre encendido y qué apagado. Obligatoria cuando la acción tiene consecuencia. */
  consecuencia?: ConsecuenciaInterruptor
  /** Por qué no se puede tocar. Reemplaza a la consecuencia y se anuncia con el control. */
  motivoDeshabilitado?: string
  /** El servidor todavía no confirma. Bloquea sin mover el pulgar. */
  cargando?: boolean
}) {
  const idGenerado = React.useId()
  const idControl = id ?? idGenerado
  const idDescripcion = `${idControl}-desc`

  const estaDeshabilitado = disabled || cargando || Boolean(motivoDeshabilitado)

  const descripcion = motivoDeshabilitado
    ? motivoDeshabilitado
    : consecuencia
      ? checked
        ? consecuencia.encendido
        : consecuencia.apagado
      : null

  const control = (
    <SwitchPrimitive.Root
      id={idControl}
      data-slot="interruptor"
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={estaDeshabilitado}
      aria-describedby={descripcion ? idDescripcion : undefined}
      aria-busy={cargando || undefined}
      className={cn(
        "peer relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border",
        "transition-colors duration-[var(--rx-dur-quick)] ease-[var(--rx-ease-standard)]",
        "outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Área táctil de 44 px sin agrandar el dibujo: el pseudoelemento crece,
        // el riel no. Es lo mismo que hace `checkbox.tsx`.
        "after:absolute after:-inset-x-2 after:-inset-y-3",
        "border-line bg-bg-sunken",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        !etiqueta && className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="interruptor-pulgar"
        className={cn(
          "pointer-events-none block size-3.5 rounded-full",
          "transition-transform duration-[var(--rx-dur-quick)] ease-[var(--rx-ease-standard)]",
          "translate-x-0.5 bg-fg-muted",
          "data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-primary-foreground"
        )}
      />
    </SwitchPrimitive.Root>
  )

  if (!etiqueta) return control

  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0 space-y-0.5">
        <label
          htmlFor={idControl}
          className={cn(
            "block text-sm font-medium text-fg",
            estaDeshabilitado && "opacity-50"
          )}
        >
          {etiqueta}
        </label>
        {descripcion ? (
          <p
            id={idDescripcion}
            className={cn(
              "text-xs",
              motivoDeshabilitado ? "text-attention-fg" : "text-fg-muted"
            )}
          >
            {descripcion}
          </p>
        ) : null}
      </div>
      <div className="pt-0.5">{control}</div>
    </div>
  )
}
