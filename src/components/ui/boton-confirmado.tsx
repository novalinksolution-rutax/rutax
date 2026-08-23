"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { ModalActoExplicito } from "@/components/ui/modal-acto-explicito"
import type { FilaResumen } from "@/components/ui/modal-acto-explicito"

/**
 * BotonConfirmado — un botón que abre la ceremonia en vez de un `confirm()`.
 *
 * POR QUÉ EXISTE
 * ---------------------------------------------------------------------------
 * Regla 37 del sistema: **ninguna acción se confirma con un diálogo nativo del
 * navegador.** El backstage tenía seis `window.confirm`, y no es un problema de
 * estética:
 *
 * · Un `confirm()` **no puede decir la consecuencia**. Cabe una pregunta y
 *   nada más, así que «¿Suspender la suscripción?» se lleva puesto todo lo que
 *   había que explicar — que sus sellers y conductores dejan de entrar hoy
 *   mismo, que los pedidos en ruta siguen, que no libera folios.
 * · Sus botones dicen «Aceptar» y «Cancelar» en el idioma del sistema
 *   operativo, no del producto — y acá «Cancelar» significa otra cosa.
 * · Bloquea el hilo y no puede mostrar un motivo, un monto ni un resumen.
 *
 * Es un envoltorio delgado sobre `ModalActoExplicito`: la ceremonia es la misma
 * que la de dinero, no una versión de segunda para uso interno.
 */
export function BotonConfirmado({
  etiqueta,
  variant = "outline",
  size = "sm",
  className,
  deshabilitado,
  peldano = 2,
  titulo,
  consecuencia,
  resumen,
  motivo,
  confirmacion,
  textoConfirmar,
  varianteModal = "primary",
  cargando = false,
  onConfirmar,
}: {
  etiqueta: React.ReactNode
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  className?: string
  deshabilitado?: boolean
  peldano?: 1 | 2 | 3
  /** Molde: «Vas a [acción] a [contraparte]». */
  titulo: string
  consecuencia: React.ReactNode
  resumen?: FilaResumen[]
  motivo?: React.ComponentProps<typeof ModalActoExplicito>["motivo"]
  confirmacion?: { frase: string; rotulo?: React.ReactNode }
  textoConfirmar: string
  varianteModal?: "primary" | "destructive"
  cargando?: boolean
  onConfirmar: () => void
}) {
  const [abierto, setAbierto] = React.useState(false)

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={deshabilitado}
        onClick={() => setAbierto(true)}
      >
        {etiqueta}
      </Button>

      <ModalActoExplicito
        open={abierto}
        onOpenChange={(o) => {
          if (cargando) return
          setAbierto(o)
        }}
        peldano={peldano}
        titulo={titulo}
        consecuencia={consecuencia}
        resumen={resumen}
        motivo={motivo}
        confirmacion={confirmacion}
        variante={varianteModal}
        cargando={cargando}
        textoConfirmar={textoConfirmar}
        onConfirmar={() => {
          setAbierto(false)
          onConfirmar()
        }}
      />
    </>
  )
}
