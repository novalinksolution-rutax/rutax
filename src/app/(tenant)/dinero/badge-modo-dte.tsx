/**
 * Badge de modo de emisión DTE — sandbox vs. producción (real).
 *
 * Hace inequívoco, en la UI, si la emisión de facturas/NC toca el SII de verdad
 * o es una simulación (auditoría §3.7/QW7). El modo se resuelve en el servidor
 * con `resolverModoDteTenant` y se pasa como prop; este componente es solo
 * presentación (sin hooks), así que lo pueden usar Server y Client Components.
 *
 * El énfasis visual (amarillo + ícono de alerta) va en el modo REAL, que es el
 * irreversible ante el SII; el sandbox se muestra neutro (operación segura).
 */

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ModoDte } from "@/modules/dinero/modo-dte";

export function BadgeModoDte({
  modo,
  className,
}: {
  modo: ModoDte;
  className?: string;
}) {
  if (modo === "real") {
    return (
      <Badge variant="warning" className={cn("gap-1", className)}>
        <AlertTriangle className="size-3" aria-hidden="true" />
        Emisión real · SII
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" className={className}>
      Modo sandbox · sin envío al SII
    </Badge>
  );
}
