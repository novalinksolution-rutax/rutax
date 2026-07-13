"use client";

/**
 * Sección "Cobro automático" de Mi plan — la única con acción. Aísla el
 * estado de auto-cobro en un client component para que el resto de la
 * pantalla (secciones 1-3 y 5) siga siendo Server Component puro.
 *
 * Estados del mandato (ver `superficie-courier.ts` / `EstadoMandato`):
 *  - `sin_mandato`/`cancelado`/`fallido` → botón "Activar" (redirige a Fintoc).
 *  - `pendiente` → informativo, sin acción (esperando confirmación del banco).
 *  - `activo` → botón "Desactivar" con diálogo de confirmación.
 *
 * TODO copy: textos pendientes de pulido por `copywriter` (marcados `// COPY`).
 */

import { useState, useTransition } from "react";
import { Landmark, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DialogConfirmacionDinero } from "@/components/ui/dialog-confirmacion-dinero";
import { BADGE_ESTADO_MANDATO, TEXTO_ESTADO_MANDATO } from "@/lib/ui/traduccion-estados";
import { activarAutoCobroAction, desactivarAutoCobroAction } from "./actions";
import type { EstadoMandato } from "@/modules/plataforma/tipos";

interface Props {
  mandatoEstado: EstadoMandato;
}

// COPY: un mensaje por estado del mandato — nunca alarmante.
const MENSAJE_POR_ESTADO: Record<EstadoMandato, string> = {
  sin_mandato:
    "Activa el cobro automático para que Rutax cobre tu plan cada período, sin que tengas que pagar a mano.",
  pendiente: "Estamos confirmando el mandato con tu banco. Puede tardar unos minutos.",
  activo: "Rutax cobra tu plan automáticamente cada período — no necesitas hacer nada.",
  cancelado: "El cobro automático está desactivado. Actívalo de nuevo cuando quieras.",
  fallido: "Hubo un problema al activar el cobro automático. Puedes intentarlo de nuevo.",
};

export function BloqueCobroAutomatico({ mandatoEstado }: Props) {
  const [estado, setEstado] = useState<EstadoMandato>(mandatoEstado);
  const [error, setError] = useState<string | null>(null);
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [pendingActivar, startActivar] = useTransition();
  const [pendingDesactivar, startDesactivar] = useTransition();

  function activar() {
    setError(null);
    startActivar(async () => {
      const resultado = await activarAutoCobroAction();
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      // Redirige en el cliente a la página hospedada de Fintoc — el courier
      // vuelve aquí cuando termine (o cancele) el enrolamiento del mandato.
      window.location.href = resultado.urlEnrolamiento;
    });
  }

  function desactivar() {
    setError(null);
    startDesactivar(async () => {
      const resultado = await desactivarAutoCobroAction();
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      setDialogoAbierto(false);
      setEstado("cancelado");
    });
  }

  const puedeActivar = estado === "sin_mandato" || estado === "cancelado" || estado === "fallido";

  return (
    <section aria-labelledby="cobro-automatico-titulo" className="rounded-xl border bg-card p-5 shadow-sm">
      <h2
        id="cobro-automatico-titulo"
        className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Cobro automático
      </h2>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Landmark className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-foreground">Cobro automático</p>
              <Badge variant={BADGE_ESTADO_MANDATO[estado]}>{TEXTO_ESTADO_MANDATO[estado]}</Badge>
            </div>
            <p className="max-w-md text-sm text-muted-foreground">{MENSAJE_POR_ESTADO[estado]}</p>
          </div>
        </div>

        <div className="shrink-0">
          {puedeActivar ? (
            <Button onClick={activar} loading={pendingActivar}>
              {/* COPY */}
              Activar cobro automático
            </Button>
          ) : null}
          {estado === "activo" ? (
            <Button variant="outline" onClick={() => setDialogoAbierto(true)}>
              Desactivar
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-4">
          <ShieldAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DialogConfirmacionDinero
        open={dialogoAbierto}
        onOpenChange={setDialogoAbierto}
        titulo="Desactivar el cobro automático"
        // COPY
        consecuencia="Si desactivas el cobro automático, deberás pagar tu plan manualmente cada período para seguir usando Rutax."
        onConfirmar={desactivar}
        cargando={pendingDesactivar}
        textoConfirmar="Desactivar"
      />
    </section>
  );
}
