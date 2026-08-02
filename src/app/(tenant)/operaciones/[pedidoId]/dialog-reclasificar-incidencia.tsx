"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIPOS_INCIDENCIA } from "@/modules/operacion/tipos";
import type { TipoIncidencia } from "@/modules/operacion/tipos";
import { traducirTipoIncidencia } from "@/lib/ui/traduccion-estados";
import { accionReclasificarIncidencia } from "./acciones-dinero";

interface Props {
  pedidoId: string;
  incidenciaId: string;
  tipoActual: TipoIncidencia;
}

export function DialogReclasificarIncidencia({ pedidoId, incidenciaId, tipoActual }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nuevoTipo, setNuevoTipo] = useState<TipoIncidencia>(tipoActual);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (nuevoTipo === tipoActual) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await accionReclasificarIncidencia(pedidoId, incidenciaId, nuevoTipo);
      if (!res.ok) {
        setError(res.mensaje ?? "Error al reclasificar.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Reclasificar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reclasificar incidencia</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Cambiar el tipo recalculará si esta incidencia afecta el cobro al seller y/o la
          liquidación del conductor, y regenerará las líneas automáticamente.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tipo_actual">Tipo actual</Label>
            <p id="tipo_actual" className="text-sm font-medium">
              {traducirTipoIncidencia(tipoActual)}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nuevo_tipo">Nuevo tipo</Label>
            <Select
              value={nuevoTipo}
              onValueChange={(v) => setNuevoTipo(v as TipoIncidencia)}
              disabled={isPending}
            >
              <SelectTrigger id="nuevo_tipo" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_INCIDENCIA.map((t) => (
                  <SelectItem key={t} value={t}>
                    {traducirTipoIncidencia(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {nuevoTipo !== tipoActual && (
            <p className="rounded-lg bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground">
              Las líneas de cobro/liquidación existentes se anularán y se regenerarán con la nueva
              clasificación. Esta acción queda en bitácora de auditoría.
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isPending}>
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isPending || nuevoTipo === tipoActual}>
              {isPending ? "Guardando..." : "Confirmar reclasificación"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
