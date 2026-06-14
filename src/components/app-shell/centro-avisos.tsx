"use client"

import Link from "next/link"
import { Bell } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Aviso, UrgenciaAviso } from "@/lib/avisos/obtener-avisos"

/**
 * CentroAvisos — notificaciones in-app (UX_STRATEGY §6.6, decisión "in-app, sin
 * email"). Recibe los avisos ya resueltos en el servidor (capacidad-aware) y los
 * presenta jerarquizados y accionables: conteo sobre la campana, lista con punto
 * de urgencia y acción directa por aviso.
 *
 * IMPORTANTE: el copy NUNCA promete correo (P6). Hoy todo es in-app.
 */

const COLOR_URGENCIA: Record<UrgenciaAviso, string> = {
  urgente: "bg-destructive",
  importante: "bg-warning",
  informativo: "bg-info",
}

export function CentroAvisos({ avisos = [] }: { avisos?: Aviso[] }) {
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
            <p className="text-sm font-medium text-foreground">Todo al día</p>
            <p className="max-w-[15rem] text-xs text-muted-foreground">
              Aquí verás reconexiones de Mercado Libre, folios bajos e incidencias
              sin gestionar cuando aparezcan.
            </p>
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {avisos.map((aviso) => (
              <li key={aviso.id}>
                <Link
                  href={aviso.href}
                  className="flex items-start gap-2.5 px-3 py-2.5 transition-colors duration-(--motion-fast) ease-out hover:bg-muted"
                >
                  <span
                    className={cn(
                      "mt-1 size-2 shrink-0 rounded-full",
                      COLOR_URGENCIA[aviso.urgencia],
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">{aviso.titulo}</span>
                    {aviso.descripcion ? (
                      <span className="text-xs text-muted-foreground">{aviso.descripcion}</span>
                    ) : null}
                    <span className="mt-0.5 text-xs font-medium text-primary">{aviso.accion}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
