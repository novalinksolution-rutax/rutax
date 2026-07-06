"use client";

/**
 * BotonCopiarTracking — copia al portapapeles la URL pública de seguimiento
 * (`/tracking/{tracking_token}`) para que el seller la comparta con el
 * comprador. Solo aplica a pedidos same-day (los Flex usan el seguimiento de
 * Mercado Libre).
 */

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BotonCopiarTracking({ trackingToken }: { trackingToken: string }) {
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState(false);

  async function copiar() {
    setError(false);
    const url = `${window.location.origin}/tracking/${trackingToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setError(true);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" size="sm" onClick={copiar}>
        {copiado ? (
          <>
            <Check className="size-3.5" aria-hidden="true" />
            Link copiado
          </>
        ) : (
          <>
            <Copy className="size-3.5" aria-hidden="true" />
            Copiar enlace de seguimiento
          </>
        )}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          No se pudo copiar. Cópialo manualmente desde la barra de direcciones.
        </p>
      )}
    </div>
  );
}
