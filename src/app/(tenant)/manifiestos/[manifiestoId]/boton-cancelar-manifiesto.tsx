"use client";

/**
 * Cancelar el manifiesto — peldaño 2 de la escalera de fricción.
 *
 * -----------------------------------------------------------------------------
 * QUÉ CAMBIÓ, Y NO ES EL DIÁLOGO
 * -----------------------------------------------------------------------------
 * Era una confirmación de sí/no sobre un diálogo escrito a mano. Lo que faltaba
 * no era el marcado: era **el motivo**. Cancelar un manifiesto devuelve todas sus
 * paradas a la bandeja sin conductor, y quien mire mañana por qué esos pedidos
 * quedaron sueltos necesita leer la razón, no deducirla.
 *
 * Y detrás faltaban dos cosas peores, que se arreglaron en la acción: **no
 * comprobaba ninguna capacidad** —hacía un `update` con `service_role`, que se
 * salta RLS— y **no dejaba bitácora**.
 *
 * El diálogo pasa a los componentes del sistema en vez de su marcado propio: el
 * overlay a mano no atrapaba el foco ni cerraba con Escape.
 */

import { useState, useTransition } from "react";
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
import { actionCancelarManifiesto } from "../actions";

interface Props {
  manifiestoId: string;
  /** Cuántas paradas vuelven a la bandeja. La consecuencia, en número. */
  paradas: number;
}

export function BotonCancelarManifiesto({ manifiestoId, paradas }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCancelar() {
    setError(null);
    const formData = new FormData();
    formData.set("manifiestoId", manifiestoId);
    formData.set("motivo", motivo);

    startTransition(async () => {
      const resultado = await actionCancelarManifiesto(formData);
      if (resultado?.error) setError(resultado.error);
      // Con éxito, la acción redirige a /manifiestos.
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-fault-line text-fault-fg hover:bg-fault-bg"
        onClick={() => setAbierto(true)}
      >
        Cancelar el manifiesto
      </Button>

      <Dialog open={abierto} onOpenChange={(a) => !a && !pending && setAbierto(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar el manifiesto</DialogTitle>
          </DialogHeader>

          {/* La consecuencia, en número y antes de apretar. «Los pedidos quedarán
              disponibles» no dice cuántos ni que se quedan sin conductor. */}
          <p className="text-sm leading-relaxed text-fg-muted">
            {paradas > 0 ? (
              <>
                Sus{" "}
                <strong className="font-medium text-fg">
                  {paradas} {paradas === 1 ? "parada vuelve" : "paradas vuelven"}
                </strong>{" "}
                a la bandeja <strong className="font-medium text-fg">sin conductor</strong>, y
                hay que volver a asignarlas antes de las 16:00.
              </>
            ) : (
              <>El manifiesto queda cancelado. No tiene paradas que devolver.</>
            )}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="motivo-cancelar">Motivo</Label>
            <Textarea
              id="motivo-cancelar"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="El conductor se reportó enfermo y no hay reemplazo."
            />
            <p className="text-xs text-fg-muted">
              Queda en la bitácora con tu nombre. Lo va a leer quien mañana se pregunte por qué
              esos pedidos quedaron sueltos.
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
              onClick={handleCancelar}
            >
              {pending ? "Cancelando…" : "Cancelar el manifiesto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
