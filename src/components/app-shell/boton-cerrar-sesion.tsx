"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * Botón de cierre de sesión — compartido por el portal del seller y la PWA del
 * conductor (el backoffice tiene su propia variante full-width en el AppShell).
 * Cierra la sesión de Supabase y vuelve a /login. Presentación pura.
 */
export function BotonCerrarSesion() {
  const router = useRouter();
  const [pending, start] = useTransition();

  function cerrarSesion() {
    start(async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cerrarSesion}
      loading={pending}
      className="text-muted-foreground hover:text-foreground"
    >
      <LogOut className="size-4" aria-hidden="true" />
      <span className="ml-1 hidden sm:inline">Cerrar sesión</span>
    </Button>
  );
}
