"use client";

/**
 * Bloquear / desbloquear el acceso de un seller autoservicio (RF-010
 * rediseño) — la palanca del courier sobre `identidad.seller_membresias`.
 *
 * NO borra la membresía: la marca `bloqueada` (trazable, con autor en
 * bitácora vía `bloquearSellerAction`/`desbloquearSellerAction`). El seller
 * sigue viendo su historial si algún día se le restaura el acceso.
 *
 * Ceremonia explícita (regla 37: nada de `window.confirm`) porque cortar el
 * acceso de un cliente es una decisión con consecuencia real, aunque sea
 * reversible.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { BotonConfirmado } from "@/components/ui/boton-confirmado";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { bloquearSellerAction, desbloquearSellerAction } from "./actions";

export function ControlMembresiaAutoservicio({
  sellerId,
  razonSocial,
  estadoInicial,
}: {
  sellerId: string;
  razonSocial: string;
  estadoInicial: "activa" | "bloqueada";
}) {
  const router = useRouter();
  const [estado, setEstado] = useState(estadoInicial);
  const [pendiente, startTransition] = useTransition();

  function bloquear() {
    startTransition(async () => {
      const r = await bloquearSellerAction(sellerId);
      if (!r.ok) {
        toast.error(r.mensaje);
        return;
      }
      setEstado("bloqueada");
      toast.success(`Bloqueaste el acceso de ${razonSocial}.`);
      router.refresh();
    });
  }

  function desbloquear() {
    startTransition(async () => {
      const r = await desbloquearSellerAction(sellerId);
      if (!r.ok) {
        toast.error(r.mensaje);
        return;
      }
      setEstado("activa");
      toast.success(`Restauraste el acceso de ${razonSocial}.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <DistintivoEstado
        tono={estado === "activa" ? "balanced" : "attention"}
        etiqueta={estado === "activa" ? "Puede entrar a su portal" : "Acceso bloqueado"}
      />
      {estado === "activa" ? (
        <BotonConfirmado
          etiqueta="Bloquear acceso"
          variant="outline"
          size="sm"
          varianteModal="destructive"
          titulo={`Vas a bloquear el acceso de ${razonSocial}`}
          consecuencia="Ya no va a poder entrar a su portal ni operar contigo. No se borra su cuenta ni su historial — puedes restaurarle el acceso cuando quieras."
          textoConfirmar="Bloquear acceso"
          cargando={pendiente}
          onConfirmar={bloquear}
        />
      ) : (
        <BotonConfirmado
          etiqueta="Restaurar acceso"
          variant="outline"
          size="sm"
          titulo={`Vas a restaurar el acceso de ${razonSocial}`}
          consecuencia="Va a poder volver a entrar a su portal y operar contigo con normalidad."
          textoConfirmar="Restaurar acceso"
          cargando={pendiente}
          onConfirmar={desbloquear}
        />
      )}
    </div>
  );
}
