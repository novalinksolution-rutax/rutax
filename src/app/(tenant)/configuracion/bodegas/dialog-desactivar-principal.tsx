"use client";

/**
 * Diálogo de consecuencia para desactivar la bodega PRINCIPAL — siempre
 * aparece (a diferencia de desactivar una bodega cualquiera, que es de un
 * clic). Con alternativas: elige el reemplazo y promueve+desactiva en una
 * sola acción. Sin alternativas: avisa que el seller/courier va a quedar sin
 * bodega principal ni activas, y permite seguir igual.
 */

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { accionDesactivarBodega, accionPromoverYDesactivar, type BodegaFila, type TipoBodega } from "./actions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bodega: BodegaFila;
  tipo: TipoBodega;
  alternativas: { id: string; nombre: string }[];
  onDesactivada: () => void;
}

export function DialogDesactivarPrincipal({
  open,
  onOpenChange,
  bodega,
  tipo,
  alternativas,
  onDesactivada,
}: Props) {
  const [nuevaPrincipalId, setNuevaPrincipalId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hayAlternativas = alternativas.length > 0;

  function alCambiarApertura(v: boolean) {
    if (isPending) return;
    if (!v) {
      setNuevaPrincipalId("");
      setError(null);
    }
    onOpenChange(v);
  }

  function confirmar() {
    setError(null);
    startTransition(async () => {
      const resultado = hayAlternativas
        ? await accionPromoverYDesactivar(tipo, bodega.id, nuevaPrincipalId)
        : await accionDesactivarBodega(tipo, bodega.id);

      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setNuevaPrincipalId("");
      onOpenChange(false);
      onDesactivada();
    });
  }

  return (
    <Dialog open={open} onOpenChange={alCambiarApertura}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Desactivar bodega principal</DialogTitle>
          <DialogDescription>
            {hayAlternativas
              ? `«${bodega.nombre}» es la bodega principal. Elige cuál será la nueva antes de desactivarla.`
              : `«${bodega.nombre}» es tu única bodega activa. Al desactivarla, ${
                  tipo === "seller" ? "este seller" : "tu courier"
                } quedará sin bodega principal ni bodegas activas hasta que agregues otra.`}
          </DialogDescription>
        </DialogHeader>

        {hayAlternativas && (
          <div className="space-y-1.5">
            <Label htmlFor="nueva-principal">Nueva bodega principal</Label>
            <Select value={nuevaPrincipalId} onValueChange={setNuevaPrincipalId} disabled={isPending}>
              <SelectTrigger id="nueva-principal" className="w-full">
                <SelectValue placeholder="Selecciona una bodega" />
              </SelectTrigger>
              <SelectContent>
                {alternativas.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
          <Button
            type="button"
            variant={hayAlternativas ? "default" : "destructive"}
            loading={isPending}
            disabled={hayAlternativas && !nuevaPrincipalId}
            onClick={confirmar}
          >
            {hayAlternativas ? "Promover y desactivar" : "Desactivar de todos modos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
