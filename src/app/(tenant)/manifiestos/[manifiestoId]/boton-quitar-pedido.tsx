"use client";

/**
 * Botón "Quitar pedido" del manifiesto (solo en estado borrador).
 * Llama a la acción de desasignar y recarga la página.
 */

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { actionQuitarPedidoDeManifiesto } from "./actions";

interface Props {
  asignacionId: string;
  manifiestoId: string;
  nombreDestinatario: string;
}

export function BotonQuitarPedido({ asignacionId, manifiestoId, nombreDestinatario }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleQuitar() {
    setError(null);
    const formData = new FormData();
    formData.set("asignacionId", asignacionId);
    formData.set("manifiestoId", manifiestoId);

    startTransition(async () => {
      const resultado = await actionQuitarPedidoDeManifiesto(formData);
      if (resultado?.error) {
        setError(resultado.error);
      } else {
        window.location.reload();
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={handleQuitar}
        aria-label={`Quitar a ${nombreDestinatario} del manifiesto`}
        className="inline-flex items-center justify-center rounded-md border border-input p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors disabled:opacity-50"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
