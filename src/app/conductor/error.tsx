"use client";

/**
 * Falla en la vista del conductor.
 * =============================================================================
 *
 * ⚠️ **El copy de acá es distinto, y no por estilo.** Quien lo lee está **de pie
 * en la calle, con una mano, entre dos entregas**, y su primera pregunta no es
 * qué falló: es **si perdió lo que acaba de registrar**. Un «Algo salió mal»
 * genérico lo deja sin saberlo, y la reacción razonable —volver a marcar la
 * entrega por si acaso— es justo la que duplica registros.
 *
 * Así que lo primero que dice el panel es que su entrega ya está guardada.
 *
 * `compacto`: acá no hay sidebar que preservar ni pantalla ancha que centrar —el
 * panel es lo único que hay—, así que no se le pide media pantalla de alto.
 */

import { PanelError } from "@/components/ui/panel-error";

export default function ErrorConductor({
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
      compacto
      titulo="No pudimos mostrar esta pantalla"
      cuerpo="Lo que ya marcaste está guardado: esto solo falló al dibujar. Toca Reintentar y sigue con tu ruta."
      salida={{ href: "/conductor", texto: "Volver a mi ruta" }}
    />
  );
}
