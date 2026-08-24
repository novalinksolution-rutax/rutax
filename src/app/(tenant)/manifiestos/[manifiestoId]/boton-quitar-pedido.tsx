"use client";

/**
 * Quitar una parada del manifiesto — peldaño 2 de la escalera de fricción.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ HACÍA ANTES, Y POR QUÉ NO SERVÍA
 * -----------------------------------------------------------------------------
 * Una `×` que **se ejecutaba al primer clic**. A las 15:50, con treinta filas y
 * el dedo apurado, ese botón devuelve un pedido a la bandeja sin conductor y no
 * hay forma de deshacerlo desde acá — hay que ir a buscarlo a Operaciones y
 * volver a asignarlo, con la flota a punto de salir.
 *
 * Y no dejaba **una sola línea** en la bitácora: al día siguiente, ese pedido
 * suelto no tenía autor ni motivo. Por eso el motivo es obligatorio y se escribe
 * acá: lo va a leer quien mañana se pregunte por qué esa parada quedó afuera.
 *
 * -----------------------------------------------------------------------------
 * `router.refresh()` Y NO `window.location.reload()`
 * -----------------------------------------------------------------------------
 * La versión anterior recargaba la página entera. Recargar pierde el orden local
 * que el coordinador pueda tener sin guardar en el panel de ruta — o sea que
 * quitar una parada le borraba el reordenamiento a medio hacer.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { actionQuitarPedidoDeManifiesto } from "./actions";

interface Props {
  asignacionId: string;
  manifiestoId: string;
  nombreDestinatario: string;
  /** La dirección, que es lo que identifica la parada en esta pantalla. */
  direccion: string;
}

export function BotonQuitarPedido({
  asignacionId,
  manifiestoId,
  nombreDestinatario,
  direccion,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleQuitar() {
    setError(null);
    const formData = new FormData();
    formData.set("asignacionId", asignacionId);
    formData.set("manifiestoId", manifiestoId);
    formData.set("motivo", motivo);

    startTransition(async () => {
      const resultado = await actionQuitarPedidoDeManifiesto(formData);
      if (resultado?.error) {
        setError(resultado.error);
        return;
      }
      setAbierto(false);
      setMotivo("");
      router.refresh();
    });
  }

  return (
    <>
      {/* 48 px de área táctil: esta tabla se opera de pie en la bodega, con la
          tablet en una mano. El ícono sigue midiendo 16 px; lo que crece es la
          zona que responde al dedo. En pantalla grande baja a 36, que es la
          altura del resto de los controles de la fila. */}
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={`Quitar ${direccion} del manifiesto`}
        className="inline-flex size-12 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive sm:size-9"
      >
        <X className="size-4" aria-hidden="true" />
      </button>

      <Dialog open={abierto} onOpenChange={(a) => !a && !pending && setAbierto(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Quitar esta parada</DialogTitle>
          </DialogHeader>

          {/* La consecuencia escrita, con la parada nombrada: en una tabla de
              treinta filas, un «¿seguro?» no dice cuál se está sacando. */}
          <p className="text-sm leading-relaxed text-fg-muted">
            <strong className="font-medium text-fg">{direccion}</strong>
            {nombreDestinatario ? <> — {nombreDestinatario}</> : null} vuelve a la bandeja{" "}
            <strong className="font-medium text-fg">sin conductor</strong>. Nadie la lleva
            hasta que la asignes de nuevo.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor={`motivo-quitar-${asignacionId}`}>Motivo</Label>
            <Textarea
              id={`motivo-quitar-${asignacionId}`}
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="El bulto no llegó a la bodega."
            />
            <p className="text-xs text-fg-muted">
              Queda en la bitácora con tu nombre, junto a la parada.
            </p>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" disabled={pending} onClick={() => setAbierto(false)}>
              Volver
            </Button>
            <Button
              variant="destructive"
              disabled={pending || motivo.trim().length < 3}
              onClick={handleQuitar}
            >
              {pending ? "Quitando…" : "Quitar la parada"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
