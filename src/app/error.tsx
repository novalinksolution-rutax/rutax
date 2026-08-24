"use client";

/**
 * El boundary de la RAÍZ — la última red, no la primera.
 * =============================================================================
 *
 * ⚠️ **Ya no es el único, y ese era el defecto.** Un `error.tsx` en la raíz
 * reemplaza el árbol entero, así que hasta ahora cualquier falla se llevaba
 * también el `AppShell`: sidebar, avisos y barra inferior. El usuario se quedaba
 * sin ninguna forma de ir a otra pantalla justo cuando más falta le hacía.
 *
 * Ahora cada área tiene el suyo —`(tenant)`, `portal`, `admin`, `conductor`— y
 * éste queda para lo que ellos **no pueden** atrapar:
 *
 * · un error dentro del propio `layout` de un área (la sesión, el `AppShell`),
 *   porque un boundary no cubre a su propio layout;
 * · las rutas que no viven bajo ninguna de esas áreas — `/login`, `/tracking`,
 *   `/invitacion`, las legales, el sitio.
 *
 * En esos casos **no hay marco que preservar**, así que tampoco hay a dónde
 * mandar al usuario dentro de la aplicación: el panel va sin salida y con las
 * dos acciones que siempre sirven, reintentar y recargar.
 */

import { PanelError } from "@/components/ui/panel-error";

export default function ErrorApp({
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
      cuerpo="Tuvimos un problema al mostrar esta pantalla y ya quedó registrado. Reintenta; si vuelve a ocurrir, recarga la página."
    />
  );
}
