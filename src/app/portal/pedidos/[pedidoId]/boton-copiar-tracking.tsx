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
  const [urlManual, setUrlManual] = useState<string | null>(null);

  async function copiar() {
    setUrlManual(null);
    const url = `${window.location.origin}/tracking/${trackingToken}`;
    // En el teléfono, la hoja de compartir del sistema lleva directo a
    // WhatsApp, que es por donde el seller le manda el enlace a su cliente.
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin portapapeles, el enlace a la vista para copiarlo a mano.
      setUrlManual(url);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" size="sm" onClick={copiar}>
        {copiado ? (
          <>
            <Check className="size-3.5" aria-hidden="true" />
            Enlace copiado
          </>
        ) : (
          <>
            <Copy className="size-3.5" aria-hidden="true" />
            Compartir enlace de seguimiento
          </>
        )}
      </Button>
      {urlManual && (
        <input
          readOnly
          value={urlManual}
          aria-label="Enlace de seguimiento"
          onFocus={(e) => e.currentTarget.select()}
          autoFocus
          className="rx-num w-full border border-line bg-bg-sunken px-2 py-1 text-xs"
        />
      )}
    </div>
  );
}
