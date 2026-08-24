"use client";

/**
 * Confirmar el manifiesto — peldaño 1 de la escalera de fricción.
 * =============================================================================
 *
 * Peldaño 1 y no 2: confirmar **no destruye nada**. Lo que hace es publicarle la
 * ruta al conductor, que hasta ese momento ve «tu ruta todavía no está lista».
 * No pide motivo; sí dice la consecuencia, que es la que se olvida: **después de
 * confirmar no se agregan ni se quitan paradas**.
 *
 * -----------------------------------------------------------------------------
 * QUÉ CAMBIÓ
 * -----------------------------------------------------------------------------
 * · El diálogo escrito a mano —`fixed inset-0` sin atrapar el foco y sin cerrar
 *   con Escape— pasa al `Dialog` del sistema.
 * · `window.location.reload()` pasa a `router.refresh()`. Recargar la página
 *   entera perdía el orden de ruta que el coordinador tuviera sin guardar en el
 *   panel de al lado.
 * · El botón usa el `Button` del sistema: el de antes traía `rounded-lg` propio,
 *   que contradice el radio del sistema, y era `inline-flex` sin ancho, así que
 *   en la columna de acciones no se alineaba con los demás.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { actionConfirmarManifiesto } from "../actions";

interface Props {
  manifiestoId: string;
  nombreConductor: string;
  totalPedidos: number;
  habilitado: boolean;
}

export function BotonConfirmarManifiesto({
  manifiestoId,
  nombreConductor,
  totalPedidos,
  habilitado,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirmar() {
    if (!habilitado) return;
    setError(null);
    const formData = new FormData();
    formData.set("manifiestoId", manifiestoId);

    startTransition(async () => {
      const resultado = await actionConfirmarManifiesto(formData);
      if (resultado?.error) {
        setError(resultado.error);
        return;
      }
      setExito(true);
      setAbierto(false);
      router.refresh();
    });
  }

  if (exito) {
    return (
      <p className="inline-flex items-center gap-2 border border-balanced-line bg-balanced-bg px-3 py-2 text-sm font-medium text-balanced-fg">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        Manifiesto confirmado
      </p>
    );
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        className="w-full justify-start"
        disabled={!habilitado || pending}
        onClick={() => setAbierto(true)}
        title={!habilitado ? "Agrega al menos una parada para confirmar" : undefined}
      >
        Confirmar manifiesto
      </Button>

      <Dialog open={abierto} onOpenChange={(a) => !a && !pending && setAbierto(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar el manifiesto</DialogTitle>
          </DialogHeader>

          <p className="text-sm leading-relaxed text-fg-muted">
            <strong className="font-medium text-fg">{nombreConductor}</strong> pasa a ver sus{" "}
            <strong className="font-medium text-fg">
              {totalPedidos} {totalPedidos === 1 ? "parada" : "paradas"}
            </strong>{" "}
            en la app. Desde ahí{" "}
            <strong className="font-medium text-fg">no se agregan ni se quitan paradas</strong>.
          </p>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" disabled={pending} onClick={() => setAbierto(false)}>
              Volver
            </Button>
            <Button disabled={pending} onClick={handleConfirmar}>
              {pending ? "Confirmando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
