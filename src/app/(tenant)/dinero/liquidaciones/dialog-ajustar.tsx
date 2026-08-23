"use client";

/**
 * Dialog de ajuste manual de liquidación (F16 — bono/penalización).
 *
 * Solo disponible mientras la liquidación está en `borrador`.
 * El monto final = monto_total_clp + bono - penalización se muestra en tiempo
 * real para que el dueño vea el impacto antes de confirmar.
 */

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { accionAjustarLiquidacion } from "./actions";
import { MINIMO_MOTIVO_AJUSTE } from "@/modules/dinero/acciones";

interface Props {
  liquidacionId: string;
  montoBaseClp: number;
  bonoActual: number;
  penalizacionActual: number;
  notaActual: string | null;
}

export function DialogAjustarLiquidacion({
  liquidacionId,
  montoBaseClp,
  bonoActual,
  penalizacionActual,
  notaActual,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bono, setBono] = useState(String(bonoActual));
  const [penalizacion, setPenalizacion] = useState(String(penalizacionActual));
  const [nota, setNota] = useState(notaActual ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const bonoNum = Math.max(0, Math.round(Number(bono) || 0));
  const penalizacionNum = Math.max(0, Math.round(Number(penalizacion) || 0));
  const montoFinal = (montoBaseClp ?? 0) + bonoNum - penalizacionNum;
  // Con los dos en cero se está LIMPIANDO un ajuste anterior, no aplicando uno:
  // ahí el motivo no se exige, o no habría forma de dejar la liquidación limpia.
  const hayAjuste = bonoNum > 0 || penalizacionNum > 0;
  const motivoListo = nota.trim().length >= MINIMO_MOTIVO_AJUSTE;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const resultado = await accionAjustarLiquidacion(
        liquidacionId,
        bonoNum,
        penalizacionNum,
        nota.trim() || null,
      );
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Ajustar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajuste manual de liquidación</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Monto base (entregas)</span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {formatearCLP(montoBaseClp)}
              </span>
            </div>
            {bonoNum > 0 && (
              <div className="flex items-center justify-between text-success">
                <span>+ Bono</span>
                <span className="font-mono tabular-nums">+{formatearCLP(bonoNum)}</span>
              </div>
            )}
            {penalizacionNum > 0 && (
              <div className="flex items-center justify-between text-destructive">
                <span>− Penalización</span>
                <span className="font-mono tabular-nums">−{formatearCLP(penalizacionNum)}</span>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2 font-semibold">
              <span>Total a pagar</span>
              <span className="font-mono tabular-nums text-foreground">
                {formatearCLP(montoFinal)}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bono">Bono (CLP)</Label>
              <Input
                id="bono"
                type="number"
                min={0}
                step={1}
                value={bono}
                onChange={(e) => setBono(e.target.value)}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">Ej. bono on-time, rendimiento</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="penalizacion">Penalización (CLP)</Label>
              <Input
                id="penalizacion"
                type="number"
                min={0}
                step={1}
                value={penalizacion}
                onChange={(e) => setPenalizacion(e.target.value)}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">Ej. fallo evitable, daño</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nota">
              Motivo {hayAjuste ? <span className="text-fault-fg">·&nbsp;obligatorio</span> : null}
            </Label>
            <Textarea
              id="nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej.: tomó 6 paradas extra el 14-08 cubriendo la ruta de J. Tapia."
              rows={2}
              maxLength={500}
            />
            {/* Regla 24: un motivo escrito por un interno que un externo va a
                leer se declara como tal en el formulario. Acá el externo es el
                conductor, y lo ve en su liquidación y en su PDF. */}
            <p className="text-xs text-fg-muted">
              <strong className="text-fg">El conductor lee esto</strong> en su liquidación y en su
              PDF. No es una nota interna.
            </p>
            {hayAjuste && !motivoListo ? (
              <p className="text-xs text-attention-fg">
                Faltan {MINIMO_MOTIVO_AJUSTE - nota.trim().length} caracteres.
              </p>
            ) : null}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              {/* «Volver» y no «Cancelar»: en este dominio cancelar es cancelar
                  un pedido (regla 59). */}
              <Button type="button" variant="outline" disabled={isPending}>
                Volver
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={isPending || (hayAjuste && !motivoListo)}
              tabIndex={hayAjuste && !motivoListo ? -1 : undefined}
            >
              {isPending ? "Guardando..." : "Guardar el ajuste"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
