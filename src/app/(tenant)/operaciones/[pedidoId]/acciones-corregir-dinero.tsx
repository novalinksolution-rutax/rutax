"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { accionAnularCobroPedido, accionAnularLiquidacionPedido } from "./acciones-dinero";

type Accion = (pedidoId: string, motivo: string) => Promise<{ ok: boolean; mensaje?: string }>;

function DialogAnular({
  pedidoId,
  titulo,
  descripcion,
  accion,
  etiquetaBoton,
}: {
  pedidoId: string;
  titulo: string;
  descripcion: string;
  accion: Accion;
  etiquetaBoton: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await accion(pedidoId, motivo);
      if (!r.ok) {
        setError(r.mensaje ?? "No se pudo completar la acción.");
        return;
      }
      setOpen(false);
      setMotivo("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setError(null); setOpen(v); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">{etiquetaBoton}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="motivo-anulacion">Motivo (queda en la bitácora)</Label>
            <Textarea
              id="motivo-anulacion"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: el fallido no es responsabilidad del seller; no corresponde cobrar."
              required
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={isPending}>Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Anulando…" : "Confirmar anulación"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Acciones de corrección manual del dinero de un pedido (B2). Cada botón se
 * muestra solo si la línea correspondiente es anulable (la página ya evaluó el
 * estado del período/liquidación y el RBAC del usuario).
 */
export function AccionesCorregirDinero({
  pedidoId,
  puedeAnularCobro,
  puedeAnularLiquidacion,
}: {
  pedidoId: string;
  puedeAnularCobro: boolean;
  puedeAnularLiquidacion: boolean;
}) {
  if (!puedeAnularCobro && !puedeAnularLiquidacion) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Corregir:</span>
      {puedeAnularCobro && (
        <DialogAnular
          pedidoId={pedidoId}
          titulo="Anular el cobro de este pedido"
          descripcion="La línea de cobro al seller se anulará y no se incluirá en la factura del período (solo si el período sigue abierto)."
          accion={accionAnularCobroPedido}
          etiquetaBoton="Anular cobro"
        />
      )}
      {puedeAnularLiquidacion && (
        <DialogAnular
          pedidoId={pedidoId}
          titulo="Anular la liquidación de este pedido"
          descripcion="La línea de liquidación al conductor se anulará y no se pagará (solo si la liquidación está en borrador)."
          accion={accionAnularLiquidacionPedido}
          etiquetaBoton="Anular liquidación"
        />
      )}
    </div>
  );
}
