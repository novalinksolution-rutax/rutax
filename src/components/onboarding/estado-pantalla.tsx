"use client";

/**
 * Bloques reutilizables de "estado de pantalla" — criterio transversal #5 del
 * documento de UX ("todo estado vacío lleva una acción clara hacia adelante")
 * y #6 ("todo error responde qué puedo hacer ahora"). Centralizar esto evita
 * que cada pantalla reinvente su propio "no hay nada que mostrar" o su propio
 * mensaje de error genérico.
 */

import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EstadoVacioProps {
  icono?: ReactNode;
  titulo: string;
  descripcion?: string;
  accion?: ReactNode;
  className?: string;
}

export function EstadoVacio({ icono, titulo, descripcion, accion, className }: EstadoVacioProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="text-muted-foreground">{icono ?? <Inbox className="size-8" aria-hidden="true" />}</div>
      <div className="space-y-1">
        <p className="font-medium text-foreground">{titulo}</p>
        {descripcion ? <p className="text-sm text-muted-foreground">{descripcion}</p> : null}
      </div>
      {accion ? <div className="mt-1">{accion}</div> : null}
    </div>
  );
}

interface EstadoErrorProps {
  titulo?: string;
  descripcion: string;
  onReintentar?: () => void;
  reintentando?: boolean;
  className?: string;
}

/** Mensaje de error con botón de reintento de un clic — sin tecnicismos (criterio #6 y #7). */
export function EstadoError({
  titulo = "No pudimos cargar esta información",
  descripcion,
  onReintentar,
  reintentando = false,
  className,
}: EstadoErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center",
        className,
      )}
    >
      <AlertTriangle className="size-8 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{titulo}</p>
        <p className="text-sm text-muted-foreground">{descripcion}</p>
      </div>
      {onReintentar ? (
        <Button variant="outline" size="sm" onClick={onReintentar} disabled={reintentando}>
          <RefreshCw className={cn("size-4", reintentando && "animate-spin")} aria-hidden="true" />
          {reintentando ? "Reintentando…" : "Reintentar"}
        </Button>
      ) : null}
    </div>
  );
}

interface EstadoCargandoProps {
  mensaje?: string;
  className?: string;
}

export function EstadoCargando({ mensaje = "Cargando…", className }: EstadoCargandoProps) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground", className)}>
      <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
      {mensaje}
    </div>
  );
}
