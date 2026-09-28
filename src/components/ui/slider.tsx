"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Deslizador — base de shadcn, ajustada al sistema: pulgar cuadrado con el radio
 * de control (3 px) y relleno de acento. Solo horizontal y de un valor: es lo
 * único que se usa, y el `data-horizontal:` del registro no existe en este
 * Tailwind.
 */
function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex h-6 w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1 grow overflow-hidden bg-line"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-brand" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className={cn(
          "block size-5 rounded-ctrl border-2 border-brand bg-bg-raised",
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text"
        )}
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
