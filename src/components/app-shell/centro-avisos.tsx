"use client"

import { Bell } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * CentroAvisos — ranura del app shell para las notificaciones in-app
 * (UX_STRATEGY §6.6, decisión "in-app, sin email"). En esta fase es el
 * contenedor + indicador; su contenido accionable (reconexión ML, folios,
 * morosidad, incidencias) se alimenta cuando se cableen sus fuentes.
 *
 * IMPORTANTE: el copy NUNCA promete correo (P6). Hoy todo es in-app.
 */
export function CentroAvisos() {
  // Placeholder: sin fuente de datos cableada aún. Cuando exista, derivar el
  // conteo de avisos no leídos y mostrar el badge sobre la campana.
  const avisos: { id: string; texto: string }[] = []
  const sinLeer = avisos.length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={sinLeer > 0 ? `Avisos (${sinLeer} sin leer)` : "Avisos"}
        >
          <Bell className="size-4" aria-hidden="true" />
          {sinLeer > 0 ? (
            <span
              className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground"
              aria-hidden="true"
            >
              {sinLeer > 9 ? "9+" : sinLeer}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2.5">
          <p className="font-heading text-sm font-medium text-foreground">Avisos</p>
        </div>
        {sinLeer === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
            <Bell className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">Sin avisos por ahora</p>
            <p className="max-w-[15rem] text-xs text-muted-foreground">
              Aquí verás reconexiones de Mercado Libre, folios bajos, morosidad e
              incidencias sin gestionar.
            </p>
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {avisos.map((aviso) => (
              <li
                key={aviso.id}
                className="px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                {aviso.texto}
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
