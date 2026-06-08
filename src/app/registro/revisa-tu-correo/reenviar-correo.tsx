"use client";

/**
 * Acción secundaria "¿No te llegó? Reenviar correo" — discreta, throttled en
 * el cliente (deshabilita tras el envío por un tiempo breve; el throttle real
 * anti-abuso vive en servidor/infra). Botón de un clic, sin confirmaciones
 * intermedias (criterio transversal #7: acciones repetibles son de un clic).
 */

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reenviarCorreoActivacion } from "../actions";

const SEGUNDOS_ESPERA = 30;

export function ReenviarCorreo({ email }: { email: string }) {
  const [estado, setEstado] = useState<"inicial" | "enviando" | "esperando" | "error">("inicial");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);

  function iniciarEspera() {
    setSegundosRestantes(SEGUNDOS_ESPERA);
    setEstado("esperando");
    const intervalo = setInterval(() => {
      setSegundosRestantes((anterior) => {
        if (anterior <= 1) {
          clearInterval(intervalo);
          setEstado("inicial");
          return 0;
        }
        return anterior - 1;
      });
    }, 1000);
  }

  async function manejarClic() {
    if (estado === "enviando" || estado === "esperando") return;
    setEstado("enviando");
    setMensaje(null);

    const resultado = await reenviarCorreoActivacion(email);
    setMensaje(resultado.mensaje);

    if (resultado.ok) {
      iniciarEspera();
    } else {
      setEstado("error");
    }
  }

  const deshabilitado = estado === "enviando" || estado === "esperando";

  return (
    <div className="space-y-2 text-center">
      <Button variant="link" size="sm" onClick={manejarClic} disabled={deshabilitado} className="h-auto p-0">
        {estado === "enviando" ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="size-3.5" aria-hidden="true" />
        )}
        {estado === "esperando" ? `Reenviar correo (espera ${segundosRestantes}s)` : "¿No te llegó? Reenviar correo"}
      </Button>
      {mensaje ? (
        <p className="text-xs text-muted-foreground" role="status">
          {mensaje}
        </p>
      ) : null}
    </div>
  );
}
