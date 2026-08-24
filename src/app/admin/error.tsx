"use client";

/** Falla dentro del backstage, con su marco intacto. */

import { PanelError } from "@/components/ui/panel-error";

export default function ErrorAdmin({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PanelError
      error={error}
      reset={reset}
      cuerpo="La falla es de esta pantalla, no de la plataforma: los couriers siguen operando. Reintenta o vuelve al índice."
      salida={{ href: "/admin", texto: "Ir al backstage" }}
    />
  );
}
