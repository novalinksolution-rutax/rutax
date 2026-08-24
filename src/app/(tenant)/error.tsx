"use client";

/**
 * Falla dentro del área del courier — **con el marco intacto**.
 * =============================================================================
 *
 * Éste es el boundary que importa. Vive **dentro** de `(tenant)/layout.tsx`, así
 * que cuando una pantalla revienta el `AppShell` sigue en pie: el coordinador
 * conserva el sidebar, el centro de avisos y la barra inferior del teléfono, y
 * se va a Manifiestos con un clic en vez de quedarse encerrado.
 *
 * Sin esto, el boundary de la raíz sustituía el árbol completo y **una pantalla
 * caída se llevaba la navegación entera**. A las 16:00, con el despacho
 * saliendo, eso no es un error de una pantalla: es la aplicación caída.
 */

import { PanelError } from "@/components/ui/panel-error";

export default function ErrorTenant({
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
      cuerpo="El resto de Rutax sigue funcionando y nada de lo que ya guardaste se perdió. Reintenta, o usa el menú para ir a otra pantalla."
      salida={{ href: "/dashboard", texto: "Ir al panel" }}
    />
  );
}
