"use client"

import * as React from "react"
import { AlertTriangle } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * DialogConfirmacionDinero — confirmación de acción irreversible de dinero.
 *
 * Implementa DESIGN_SYSTEM §2 (principio 8), §4 (Modals) y UX_STRATEGY §6.5:
 *  - Describe la CONSECUENCIA en palabras (no pregunta "¿estás seguro?").
 *  - Previsualización opcional (resumen de lo que se va a comprometer).
 *  - Paso de confirmación explícito (checkbox) que habilita el botón final.
 *  - `Esc` y click-fuera DESHABILITADOS: solo se sale por un botón explícito.
 *  - Sin botón X de cierre.
 *
 * Es presentación pura: la acción y su estado de carga los controla el padre
 * (típicamente con `useTransition`). No conoce reglas de negocio.
 */
interface DialogConfirmacionDineroProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  titulo: string
  /** La consecuencia escrita, inequívoca (p. ej. irreversibilidad ante el SII). */
  consecuencia: React.ReactNode
  /** Previsualización/resumen de lo que se va a comprometer (líneas, monto, seller). */
  children?: React.ReactNode
  onConfirmar: () => void
  /** Estado de carga del padre: spinner in-situ + deshabilita. */
  cargando?: boolean
  textoConfirmar?: string
  textoCancelar?: string
  /** Variante del botón final. `destructive` para anulaciones. */
  variante?: "primary" | "destructive"
  /** Si se exige marcar un checkbox antes de habilitar el botón final. */
  requiereConfirmacionExplicita?: boolean
  etiquetaConfirmacion?: React.ReactNode
  /** Gate adicional del padre (p. ej. un motivo obligatorio aún vacío). */
  confirmDeshabilitado?: boolean
}

function DialogConfirmacionDinero({
  open,
  onOpenChange,
  titulo,
  consecuencia,
  children,
  onConfirmar,
  cargando = false,
  textoConfirmar = "Confirmar",
  textoCancelar = "Cancelar",
  variante = "primary",
  requiereConfirmacionExplicita = false,
  etiquetaConfirmacion,
  confirmDeshabilitado = false,
}: DialogConfirmacionDineroProps) {
  const [marcado, setMarcado] = React.useState(false)
  const idCheck = React.useId()

  // Reinicia el paso de confirmación al cerrar, ajustando estado en render
  // (patrón de React para "estado derivado de un prop") en vez de un effect.
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) setMarcado(false)
  }

  const habilitado =
    !cargando &&
    !confirmDeshabilitado &&
    (!requiereConfirmacionExplicita || marcado)

  return (
    <Dialog open={open} onOpenChange={cargando ? undefined : onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Punto irreversible: solo se sale por un botón explícito.
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                variante === "destructive"
                  ? "bg-destructive-subtle text-destructive-subtle-foreground"
                  : "bg-warning-subtle text-warning-subtle-foreground"
              )}
            >
              <AlertTriangle className="size-4" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-2">
              <DialogTitle>{titulo}</DialogTitle>
              <DialogDescription>{consecuencia}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {children ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {children}
          </div>
        ) : null}

        {requiereConfirmacionExplicita ? (
          <label
            htmlFor={idCheck}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm text-foreground"
          >
            <Checkbox
              id={idCheck}
              checked={marcado}
              onCheckedChange={(v) => setMarcado(v === true)}
              disabled={cargando}
              className="mt-0.5"
            />
            <span>{etiquetaConfirmacion ?? "Entiendo y confirmo esta acción."}</span>
          </label>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={cargando}
          >
            {textoCancelar}
          </Button>
          <Button
            variant={variante === "destructive" ? "destructive" : "default"}
            onClick={onConfirmar}
            disabled={!habilitado}
            loading={cargando}
          >
            {textoConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { DialogConfirmacionDinero }
