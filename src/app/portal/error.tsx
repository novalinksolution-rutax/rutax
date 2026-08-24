"use client";

/**
 * Falla dentro del portal del seller, con su marco intacto.
 *
 * ⚠️ El copy **no menciona a Rutax**: para el seller la relación es con su
 * courier, y el nombre de nuestro software no le dice nada (regla 42, la misma
 * que decide la marca de las pantallas sin sesión).
 */

import { PanelError } from "@/components/ui/panel-error";

export default function ErrorPortal({
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
      cuerpo="Tus pedidos y tus cobros están a salvo: lo que falló fue mostrarte esta pantalla. Reintenta, o vuelve a tus pedidos desde el menú."
      salida={{ href: "/portal/pedidos", texto: "Ver mis pedidos" }}
    />
  );
}
