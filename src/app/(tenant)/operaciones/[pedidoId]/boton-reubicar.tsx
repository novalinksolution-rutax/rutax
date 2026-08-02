"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { accionReubicarPedido } from "./actions-geocoding";

/**
 * Botón para desatascar la ubicación de un pedido cuyo geocoding quedó
 * pendiente (o no resuelto). Re-dispara el job de geocoding vía Server Action.
 */
export function BotonReubicar({ pedidoId }: { pedidoId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const res = await accionReubicarPedido(pedidoId);
      if (!res.ok) {
        setError(res.mensaje ?? "No se pudo reintentar la ubicación.");
        return;
      }
      setEnviado(true);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={isPending || enviado}
        className="w-fit"
      >
        <MapPin className="size-3.5" aria-hidden="true" />
        {isPending ? "Reintentando…" : enviado ? "Ubicación solicitada" : "Reintentar ubicación"}
      </Button>
      {enviado && !error && (
        <p className="text-xs text-muted-foreground">
          Ubicación en proceso. Se resolverá en unos segundos; recarga para verla.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
