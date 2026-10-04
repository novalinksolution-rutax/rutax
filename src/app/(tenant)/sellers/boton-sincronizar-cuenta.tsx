"use client";

/**
 * «Sincronizar ahora» de UNA cuenta de Mercado Libre.
 *
 * La sincronización es por cuenta (`solicitarSincronizacionMlSeller` recibe el
 * id de una conexión), así que el botón va en la fila de cada cuenta y no en el
 * título de la tarjeta: ahí se leía como «sincronizar todas», que no es lo que
 * hace. Sincronizar todas de una vez vive en el menú ⋯ del seller.
 *
 * Tras pedirla, el botón se enfría un minuto: el límite real contra machacar el
 * backend está en el servidor (el `id` del evento Inngest); esto solo evita el
 * doble toque.
 */

import { useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { solicitarSincronizacionMlSeller } from "./actions";

const VENTANA_ENFRIAMIENTO_MS = 60_000;

export function BotonSincronizarCuenta({ conexionId, etiqueta }: { conexionId: string; etiqueta: string }) {
  const [estado, setEstado] = useState<"listo" | "pidiendo" | "pedido">("listo");

  async function sincronizar() {
    if (estado !== "listo") return;
    setEstado("pidiendo");
    try {
      const r = await solicitarSincronizacionMlSeller(conexionId);
      if (!r.ok) {
        toast.error(r.mensaje);
        setEstado("listo");
        return;
      }
      toast.success(`Sincronizando ${etiqueta}.`);
      setEstado("pedido");
      setTimeout(() => setEstado("listo"), VENTANA_ENFRIAMIENTO_MS);
    } catch {
      toast.error("No pudimos sincronizar. Intenta de nuevo.");
      setEstado("listo");
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={sincronizar}
      disabled={estado !== "listo"}
      aria-label={`Sincronizar ${etiqueta}`}
      title={`Sincronizar ${etiqueta}`}
      className="size-11 shrink-0 md:size-8"
    >
      {estado === "pidiendo" ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : estado === "pedido" ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <RefreshCw className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}
