"use client";

/**
 * "Copiar enlace" — la salida manual cuando el correo de invitación no llega.
 *
 * El enlace se arma ACÁ, en el cliente, con `window.location.origin`: es el
 * único valor que no puede estar mal configurado. El servidor entrega solo el
 * token (ver `actions.ts` para por qué se pide bajo demanda y no se renderiza
 * con la lista).
 *
 * Si el portapapeles no está disponible —contexto no seguro, permiso denegado,
 * navegador viejo— NO se pierde el enlace: se muestra en un campo de solo
 * lectura, ya seleccionado, para copiarlo a mano. Un botón de copiar que falla
 * y no deja nada a la vista dejaría al courier igual de bloqueado que antes.
 */

import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { obtenerInvitacionPendienteSeller } from "./actions";

interface Props {
  sellerId: string;
  razonSocial: string;
}

export function BotonCopiarInvitacion({ sellerId, razonSocial }: Props) {
  const [cargando, setCargando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  /** Solo se llena si el portapapeles falló — es el plan B visible. */
  const [enlaceVisible, setEnlaceVisible] = useState<string | null>(null);

  async function manejarClic() {
    if (cargando) return;
    setCargando(true);
    setEnlaceVisible(null);

    const resultado = await obtenerInvitacionPendienteSeller(sellerId);
    setCargando(false);

    if (!resultado.ok) {
      toast.error(resultado.mensaje);
      return;
    }

    const enlace = `${window.location.origin}/invitacion/${resultado.token}`;

    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
      toast.success(`Enlace de ${razonSocial} copiado — mándaselo a ${resultado.email}.`, {
        description: "Es de un solo uso: quien lo abra entra como este seller.",
      });
    } catch {
      setEnlaceVisible(enlace);
      toast.warning("No pudimos copiarlo solo — cópialo del campo de abajo.");
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        onClick={manejarClic}
        disabled={cargando}
        aria-label={`Copiar enlace de invitación de ${razonSocial}`}
      >
        {cargando ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : copiado ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
        {copiado ? "Copiado" : "Copiar enlace"}
      </Button>

      {enlaceVisible ? (
        <input
          readOnly
          autoFocus
          value={enlaceVisible}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full min-w-0 rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
          aria-label={`Enlace de invitación de ${razonSocial}`}
        />
      ) : null}
    </div>
  );
}
