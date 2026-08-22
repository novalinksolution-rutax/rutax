import * as React from "react"
import { AlertTriangle, ArrowRight, Check, Minus, Slash, XCircle } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { exigeTrama, type TonoEstado } from "@/lib/ui/tonos-estado"

/**
 * DistintivoEstado — el render canónico de un estado de dominio.
 *
 * Reemplaza a `BadgeEstado`, que queda como alias durante la migración. Es el
 * único componente del catálogo que se construye de cero en vez de re-estilarse,
 * y la razón está en el documento de costo: el modelo de datos del anterior no
 * soporta 29 vocabularios ni el eje múltiple.
 *
 * TRES SEÑALES, NO UNA
 * ---------------------------------------------------------------------------
 * El color nunca es el único portador de significado. Cada distintivo lleva:
 *   1. tono      — el color, que cambia solo entre los cuatro temas
 *   2. glifo     — la forma, que sobrevive al daltonismo y al monocromo
 *   3. etiqueta  — la palabra, que sobrevive a todo
 *
 * `inert` agrega una cuarta: la TRAMA diagonal. Es lo que hace que un pedido
 * cancelado se distinga de una celda vacía cuando no hay color — en la etiqueta
 * térmica, en una impresión, o para quien no distingue los grises.
 *
 * LA REGLA DE CONVIVENCIA
 * ---------------------------------------------------------------------------
 * Un pedido tiene a la vez estado de ciclo, situación de retiro, estado de
 * dirección y procedencia: son cuatro preguntas distintas. **Solo el ciclo usa
 * distintivo con color.** Cuatro distintivos de color en una misma fila no se
 * leen. Para los otros tres ejes están `GlifoDireccion` y `EtiquetaProcedencia`.
 */

const ICONO_TONO: Record<TonoEstado, LucideIcon> = {
  balanced: Check,
  progress: ArrowRight,
  attention: AlertTriangle,
  fault: XCircle,
  neutral: Minus,
  inert: Slash,
}

/**
 * Clases por tono. Van escritas literales y no compuestas en tiempo de
 * ejecución: Tailwind necesita ver la cadena completa para generarla.
 */
const CLASES_TONO: Record<TonoEstado, string> = {
  balanced: "bg-balanced-bg text-balanced-fg border-balanced-line",
  progress: "bg-progress-bg text-progress-fg border-progress-line",
  attention: "bg-attention-bg text-attention-fg border-attention-line",
  fault: "bg-fault-bg text-fault-fg border-fault-line",
  neutral: "bg-neutralst-bg text-neutralst-fg border-neutralst-line",
  inert: "rx-inert border-inert-line",
}

export function DistintivoEstado({
  tono,
  etiqueta,
  conGlifo = true,
  className,
}: {
  tono: TonoEstado
  /** Casi siempre una cadena. Acepta `ReactNode` porque se renderiza como hijo
   *  y algunos llamadores heredados pasan fragmentos con su propio marcado. */
  etiqueta: React.ReactNode
  /** El glifo solo se apaga donde el ancho no da — nunca por gusto. */
  conGlifo?: boolean
  className?: string
}) {
  const Icono = ICONO_TONO[tono]

  return (
    <span
      data-tono={tono}
      data-trama={exigeTrama(tono) ? "" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap border px-1.5 py-0.5",
        "rounded-badge font-sans text-[11.5px] font-medium leading-none",
        CLASES_TONO[tono],
        className
      )}
    >
      {conGlifo ? <Icono className="size-3 shrink-0" aria-hidden="true" /> : null}
      {etiqueta}
    </span>
  )
}

/**
 * EtiquetaProcedencia — de dónde entró el pedido: `SD`, `FLEX`, `SHOP`.
 *
 * Va en mono, con borde y **sin color**, a propósito: es un dato de
 * clasificación, no un juicio. Si llevara color competiría con el distintivo de
 * estado en la misma fila y ninguno de los dos se leería.
 *
 * No es decorativa: es la que decide si lo que el conductor registra en Rutax es
 * la prueba autoritativa o solo un registro informativo.
 */
export function EtiquetaProcedencia({
  procedencia,
  className,
}: {
  procedencia: "SD" | "FLEX" | "SHOP"
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap border border-line px-1 py-px",
        "rounded-badge font-mono text-[10.5px] font-medium leading-none tracking-wide",
        "text-fg-muted",
        className
      )}
    >
      {procedencia}
    </span>
  )
}

/**
 * GlifoDireccion — ¿sabemos dónde va este pedido?
 *
 * Es un glifo solo, sin etiqueta, delante del destinatario, con su leyenda en la
 * cabecera de la columna. Cuando la dirección está bien ubicada NO se muestra
 * nada: el silencio es el estado normal, y marcar lo normal gasta la señal.
 */
export function GlifoDireccion({
  estado,
  className,
}: {
  estado: "ubicada" | "por-revisar" | "sin-ubicar"
  className?: string
}) {
  if (estado === "ubicada") return null

  const esVieja = estado === "sin-ubicar"
  const Icono = esVieja ? XCircle : AlertTriangle

  return (
    <Icono
      className={cn("size-3.5 shrink-0", esVieja ? "text-fault-fg" : "text-attention-fg", className)}
      aria-label={esVieja ? "Sin ubicar hace más de 2 días" : "Dirección por revisar"}
    />
  )
}

/**
 * BanderaBloqueo — las dos banderas de una excepción de conciliación.
 *
 * `bloquea facturación` y `bloquea pago` son independientes entre sí: una
 * excepción puede impedir emitir la factura y aun así dejar pagar al conductor.
 *
 * Van **siempre con su rótulo visible**, encendidas o apagadas. Una bandera que
 * solo aparece cuando está encendida obliga a recordar cuáles existen, y estas
 * deciden si sale plata.
 */
export function BanderaBloqueo({
  rotulo,
  encendida,
  className,
}: {
  rotulo: string
  encendida: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-mono text-[9px] uppercase leading-none",
        "tracking-[0.1em]",
        encendida ? "text-fault-fg" : "text-fg-subtle",
        className
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          encendida ? "bg-fault-fg" : "bg-transparent ring-1 ring-line"
        )}
        aria-hidden="true"
      />
      {rotulo}
      <span className="sr-only">{encendida ? ": activa" : ": inactiva"}</span>
    </span>
  )
}
