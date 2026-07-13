"use client";

/**
 * Banner persistente del modo soporte — gap 4, F3-B.
 *
 * Vive PEGADO arriba de todo el contenido de `/admin/couriers/[tenantId]/soporte`
 * (`sticky top-0`, con `-mx-6`/`px-6` para "sangrar" hasta los bordes del
 * `<main>` del backstage — ese layout no expone un slot de banner full-bleed
 * como `(tenant)/layout.tsx`, así que se logra el mismo efecto acá, por
 * página, sin tocar el layout compartido). Contador regresivo puramente
 * visual (recalculado en cliente desde `expiraEn`, sin volver a golpear al
 * servidor cada segundo); al llegar a 0 fuerza un `router.refresh()`, que
 * vuelve a correr `obtenerVistaSoporteTenant` en el servidor — como la cookie
 * ya expiró, `exigirSoporteActivo` lanza `NoHaySesionSoporte` y la página
 * redirige sola de vuelta al drill-down normal (ver `soporte/page.tsx`).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { accionTerminarSoporte } from "../soporte-actions";

const FORMATEADOR_HORA_SANTIAGO = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  hour: "2-digit",
  minute: "2-digit",
});

/** `mm:ss` restantes — nunca negativo (se satura en `0:00`). */
function formatearRestante(msRestante: number): string {
  const segundos = Math.max(0, Math.floor(msRestante / 1000));
  const mm = Math.floor(segundos / 60);
  const ss = segundos % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

interface Props {
  tenantId: string;
  nombreCourier: string;
  /** ISO 8601 — `SesionSoporte.expiraEn`. */
  expiraEn: string;
}

export function BannerSoporte({ tenantId, nombreCourier, expiraEn }: Props) {
  const router = useRouter();
  const expiraEnMs = new Date(expiraEn).getTime();

  const [msRestante, setMsRestante] = useState(() => expiraEnMs - Date.now());
  // Se dispara UNA vez al cruzar el umbral de "queda poco" — evita spamear al
  // lector de pantalla con un `aria-live` que cambiara cada segundo.
  const [avisoUrgente, setAvisoUrgente] = useState(false);

  useEffect(() => {
    const ACTUALIZA_CADA_MS = 1000;
    const UMBRAL_URGENTE_MS = 60_000;

    const intervalo = setInterval(() => {
      const restante = expiraEnMs - Date.now();
      setMsRestante(restante);

      if (restante <= UMBRAL_URGENTE_MS && restante > 0) {
        setAvisoUrgente(true);
      }

      if (restante <= 0) {
        clearInterval(intervalo);
        // La ventana ya expiró — refresca para que el servidor la corte.
        router.refresh();
      }
    }, ACTUALIZA_CADA_MS);

    return () => clearInterval(intervalo);
  }, [expiraEnMs, router]);

  const expirado = msRestante <= 0;
  const horaLimite = FORMATEADOR_HORA_SANTIAGO.format(new Date(expiraEnMs));

  return (
    <div
      role="region"
      aria-label="Modo soporte activo"
      className="sticky top-0 z-40 -mx-6 border-b-2 border-warning bg-warning-subtle px-6 py-2.5 text-warning-subtle-foreground shadow-sm"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>
            Viendo como <strong>{nombreCourier}</strong> · modo soporte (solo lectura) · termina a las{" "}
            {horaLimite}
          </span>
          <span className="tabular-nums text-xs opacity-80" aria-hidden="true">
            ({expirado ? "0:00" : formatearRestante(msRestante)})
          </span>
          {/* Aviso accesible: solo se anuncia una vez, al cruzar el minuto final. */}
          <span role="status" aria-live="polite" className="sr-only">
            {avisoUrgente && !expirado
              ? "Queda menos de un minuto para que termine el modo soporte."
              : ""}
          </span>
        </div>

        <form action={accionTerminarSoporte.bind(null, tenantId)} className="shrink-0">
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="w-fit border-warning bg-transparent text-warning-subtle-foreground hover:bg-warning-subtle"
          >
            Salir del modo soporte
          </Button>
        </form>
      </div>
    </div>
  );
}
