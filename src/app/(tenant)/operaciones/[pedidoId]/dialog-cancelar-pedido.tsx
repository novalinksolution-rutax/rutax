"use client";

/**
 * Diálogo "Cancelar pedido" — rol interno (docs/arquitectura/edicion-y-
 * cancelacion-de-pedidos.md, tareas 13-14 de §11).
 *
 * Dos pasos, en el MISMO diálogo (sin round-trip adicional de preflight): el
 * preflight de dinero ya viaja dentro de `accionCancelarPedido` (§7.3) —
 * - Paso 1 "formulario": motivo obligatorio (≥10 caracteres). Al enviar,
 *   `confirmado=false`.
 * - Si el servidor responde `requiereConfirmacion` (D-A3: el preflight
 *   encontró líneas de dinero que NO se van a anular solas), el diálogo pasa
 *   al paso 2 "confirmar": muestra las advertencias y exige un clic explícito
 *   adicional (reenvía el MISMO motivo con `confirmado=true`).
 * - Si `anulacionAutomatica` era `true` desde el principio, el paso 1 ejecuta
 *   directo — un solo paso, como pide el diseño.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ItemPreflight } from "@/modules/dinero/preflight";
import { accionCancelarPedido } from "./actions-cancelacion";

const MOTIVO_MIN = 10;

interface Props {
  pedidoId: string;
}

type Paso = "formulario" | "confirmar";

export function DialogCancelarPedido({ pedidoId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paso, setPaso] = useState<Paso>("formulario");
  const [motivo, setMotivo] = useState("");
  const [advertencias, setAdvertencias] = useState<ItemPreflight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const motivoValido = motivo.trim().length >= MOTIVO_MIN;

  function reiniciar() {
    setPaso("formulario");
    setMotivo("");
    setAdvertencias([]);
    setError(null);
  }

  function manejarCambioAbierto(v: boolean) {
    if (isPending) return;
    setOpen(v);
    if (!v) reiniciar();
  }

  function enviar(confirmado: boolean) {
    setError(null);
    const formData = new FormData();
    formData.set("pedidoId", pedidoId);
    formData.set("motivo", motivo.trim());
    formData.set("confirmado", confirmado ? "true" : "false");

    startTransition(async () => {
      const resultado = await accionCancelarPedido(formData);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      if ("requiereConfirmacion" in resultado) {
        setAdvertencias(resultado.advertencias);
        setPaso("confirmar");
        return;
      }
      setOpen(false);
      reiniciar();
      toast.success("Pedido cancelado", {
        description: "El pedido quedó en estado Cancelado y se avisó en la bitácora.",
      });
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={manejarCambioAbierto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Cancelar pedido
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        {paso === "formulario" ? (
          <>
            <DialogHeader>
              <DialogTitle>Cancelar pedido</DialogTitle>
              <DialogDescription>
                El pedido pasará a estado Cancelado. No se puede revertir — si el destinatario
                todavía necesita el envío, habrá que crear uno nuevo.
              </DialogDescription>
            </DialogHeader>

            <form
              id="form-cancelar-pedido"
              onSubmit={(e) => {
                e.preventDefault();
                if (motivoValido) enviar(false);
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="motivo-cancelacion">Motivo de la cancelación</Label>
                <div
                  className="flex items-start gap-2 rounded-md bg-info-subtle px-3 py-2 text-xs text-info-subtle-foreground"
                  role="note"
                >
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>El seller podrá ver este motivo en el detalle de su pedido.</span>
                </div>
                <Textarea
                  id="motivo-cancelacion"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  disabled={isPending}
                  rows={4}
                  placeholder="El seller verá este motivo. Ej.: dirección duplicada, el cliente anuló la compra."
                  aria-describedby="motivo-cancelacion-ayuda"
                />
                <p id="motivo-cancelacion-ayuda" className="text-xs text-muted-foreground">
                  {motivo.trim().length}/{MOTIVO_MIN} caracteres mínimos
                  {motivoValido && <span className="ml-1 text-success">&#10003;</span>}
                </p>
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground"
                >
                  {error}
                </p>
              )}
            </form>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => manejarCambioAbierto(false)}
                disabled={isPending}
              >
                Volver
              </Button>
              <Button
                type="submit"
                form="form-cancelar-pedido"
                disabled={!motivoValido || isPending}
                loading={isPending}
              >
                Cancelar pedido
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning-subtle-foreground">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                </div>
                <div className="flex flex-col gap-2">
                  <DialogTitle>Confirma la cancelación</DialogTitle>
                  <DialogDescription>
                    El pedido se puede cancelar igual, pero revisa esto antes de confirmar:
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <ListaAdvertencias items={advertencias} />

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground"
              >
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPaso("formulario")}
                disabled={isPending}
              >
                Volver
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => enviar(true)}
                disabled={isPending}
                loading={isPending}
              >
                Confirmar cancelación
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ListaAdvertencias({ items }: { items: ItemPreflight[] }) {
  return (
    <div className="rounded-md bg-warning-subtle p-3 text-sm text-warning-subtle-foreground">
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={`${item.codigo}-${i}`} className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-medium">{item.titulo}</span>
              {item.detalle && <span className="block text-xs opacity-90">{item.detalle}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
