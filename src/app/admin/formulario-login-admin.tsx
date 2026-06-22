"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { iniciarSesionAdmin } from "./acciones-sesion";

/**
 * Formulario de acceso al backstage. Envía el secreto por POST (Server Action),
 * NUNCA por query param. El secreto no se persiste en el cliente: la sesión la
 * mantiene una cookie httpOnly que este componente nunca lee.
 */
export function FormularioLoginAdmin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const resultado = await iniciarSesionAdmin(formData);
      if (!resultado.ok) {
        setError(resultado.mensaje ?? "Credenciales inválidas.");
        return;
      }
      // Sesión establecida (cookie httpOnly): re-renderiza el layout, que ahora
      // mostrará el contenido del backstage en vez de este formulario.
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-8 shadow-sm"
      >
        <div className="space-y-2 text-center">
          <Shield className="mx-auto size-9 text-primary" aria-hidden="true" />
          <h1 className="font-semibold">Acceso restringido</h1>
          <p className="text-sm text-muted-foreground">
            Este panel requiere el secreto de super-admin de Rutax.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="secreto">Secreto</Label>
          <Input
            id="secreto"
            name="secreto"
            type="password"
            autoComplete="off"
            autoFocus
            required
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Verificando…" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
