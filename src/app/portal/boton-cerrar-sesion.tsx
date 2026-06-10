"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

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
      disabled={pending}
      className="text-muted-foreground hover:text-foreground"
    >
      <LogOut className="size-4" aria-hidden="true" />
      <span className="hidden sm:inline ml-1">Cerrar sesión</span>
    </Button>
  );
}
