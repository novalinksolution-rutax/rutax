"use client";

/**
 * Orquestador del wizard: barra de progreso, navegación atrás y montaje del
 * paso actual. El wizard es OBLIGATORIO y secuencial; cada paso guarda su dato
 * antes de avanzar (el guardado vive en el paso). Al terminar el último, estampa
 * la marca de completitud y suelta al courier a su backoffice.
 *
 * Arranca en el primer paso pendiente: si el courier abandonó a mitad, retoma
 * donde estaba porque cada paso ya persistió lo suyo.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { accionCompletarPuestaEnMarcha } from "./actions";
import {
  PASOS_PUESTA_EN_MARCHA,
  type ClavePaso,
  type DatosInicialesPaso,
} from "./tipos";
import {
  PasoEmpresa,
  PasoTarifa,
  PasoPeriodicidad,
  PasoCobro,
  PasoRetiro,
  PasoZonas,
  PasoContacto,
  PasoEquipo,
} from "./pasos";

const ETIQUETA_CORTA: Record<ClavePaso, string> = {
  empresa: "Empresa",
  tarifa: "Tarifa",
  periodicidad: "Facturación",
  cobro: "Cobro",
  retiro: "Retiro",
  zonas: "Zonas",
  contacto: "Contacto",
  equipo: "Equipo",
};

export function Wizard({
  iniciales,
  indiceInicial,
}: {
  iniciales: DatosInicialesPaso;
  indiceInicial: number;
}) {
  const router = useRouter();
  const [indice, setIndice] = useState(indiceInicial);
  const [completando, iniciarCompletar] = useTransition();
  const [errorFinal, setErrorFinal] = useState<string | null>(null);

  const total = PASOS_PUESTA_EN_MARCHA.length;
  const clave = PASOS_PUESTA_EN_MARCHA[indice];
  const esUltimo = indice === total - 1;

  function avanzar() {
    setErrorFinal(null);
    if (!esUltimo) {
      setIndice((i) => Math.min(i + 1, total - 1));
    }
  }

  function retroceder() {
    setErrorFinal(null);
    setIndice((i) => Math.max(i - 1, 0));
  }

  function completar() {
    setErrorFinal(null);
    iniciarCompletar(async () => {
      const r = await accionCompletarPuestaEnMarcha();
      if (r.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setErrorFinal(r.mensaje);
      }
    });
  }

  function renderPaso() {
    switch (clave) {
      case "empresa":
        return <PasoEmpresa iniciales={iniciales.empresa} onListo={avanzar} />;
      case "tarifa":
        return <PasoTarifa iniciales={iniciales.tarifa} onListo={avanzar} />;
      case "periodicidad":
        return <PasoPeriodicidad iniciales={iniciales.periodicidad} onListo={avanzar} />;
      case "cobro":
        return <PasoCobro iniciales={iniciales.cobro} onListo={avanzar} />;
      case "retiro":
        return <PasoRetiro iniciales={iniciales.retiro} onListo={avanzar} />;
      case "zonas":
        return <PasoZonas iniciales={iniciales.zonas} onListo={avanzar} />;
      case "contacto":
        return <PasoContacto iniciales={iniciales.contacto} onListo={avanzar} />;
      case "equipo":
        return <PasoEquipo iniciales={iniciales.equipo} onListo={completar} />;
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">
            Paso {indice + 1} de {total} · {ETIQUETA_CORTA[clave]}
          </span>
          {indice > 0 ? (
            <button
              type="button"
              onClick={retroceder}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Atrás
            </button>
          ) : null}
        </div>
        <Progress value={((indice + 1) / total) * 100} />
      </div>

      {renderPaso()}

      {completando ? (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Terminando…
        </p>
      ) : null}

      {errorFinal ? (
        <Alert variant="destructive">
          <AlertDescription>{errorFinal}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
