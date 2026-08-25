"use client";

/**
 * Cerrar sesión — la salida que esta pantalla no tenía.
 * =============================================================================
 *
 * 🐞 **El conductor entraba por `/login` y quedaba atrapado.** La pantalla le
 * dice que su trabajo está en la app, y hasta hoy **no había ninguna forma de
 * salir**: sin barra lateral, sin menú de cuenta, sin botón. Si se equivocaba de
 * cuenta —o si el teléfono era prestado— la sesión se quedaba abierta y la única
 * salida real era borrar las cookies del navegador.
 *
 * No es un detalle de comodidad: **es una sesión ajena que no se puede cerrar en
 * un teléfono que puede no ser suyo.**
 *
 * ⚠️ Va en `outline` y no en el botón principal de la pantalla: lo que uno viene
 * a hacer acá es entender que tiene que abrir la app, no cerrar sesión. Es la
 * salida, no la acción.
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

export function BotonCerrarSesion() {
  const router = useRouter();
  const [cerrando, iniciar] = useTransition();

  return (
    <Button
      variant="outline"
      className="w-full pointer-coarse:h-12"
      disabled={cerrando}
      onClick={() =>
        iniciar(async () => {
          // Mismo camino que el menú de cuenta del backoffice: el cliente de
          // Supabase borra la sesión y el `refresh` obliga al servidor a
          // reevaluar, para que el guard de esta página no la devuelva desde
          // el caché del router.
          const { createClient } = await import("@/lib/supabase/client");
          await createClient().auth.signOut();
          router.push("/login");
          router.refresh();
        })
      }
    >
      <LogOut className="size-4" aria-hidden="true" />
      {cerrando ? "Cerrando…" : "Cerrar sesión"}
    </Button>
  );
}
