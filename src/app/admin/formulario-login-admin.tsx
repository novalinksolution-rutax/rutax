"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";
import { iniciarSesionAdmin } from "./acciones-sesion";
import { DistintivoBackstage } from "./distintivo-backstage";

/**
 * Formulario de acceso al backstage — F3-A: correo + contraseña vía Supabase
 * Auth REAL (`iniciarSesionAdmin`, `../acciones-sesion.ts`), el mismo
 * mecanismo que el login de usuarios internos (`src/app/login`). Envía las
 * credenciales por POST (Server Action), nunca por query param. La sesión la
 * mantiene la cookie SSR de Supabase (httpOnly) que este componente nunca lee.
 *
 * Este formulario NO maneja MFA — tras un login exitoso a nivel de
 * Auth+super-admin, `layout.tsx` decide si hace falta enrolamiento o step-up
 * y muestra la pantalla correspondiente (ver `PromptMfa` ahí). El mensaje de
 * error es siempre genérico ("Credenciales inválidas.", el mismo texto que ya
 * usa `iniciarSesionAdmin`): nunca se distingue si falló el correo o la
 * contraseña.
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
    // ⚠️ **Columna centrada y sin lienzo**, a diferencia del login del
    // backoffice: el lienzo de marca es de la puerta que abre nuestro cliente.
    // Acá entramos nosotros, y una pieza de marca en la puerta del backstage no
    // le habla a nadie.
    //
    // Y sin sombra (regla 4): la elevación es escalón de fondo más borde. La
    // tenía, con `shadow-sm`.
    <PantallaSinSesion marca={{ tipo: "rutax" }} distintivo={<DistintivoBackstage />}>
      <form
        onSubmit={handleSubmit}
        aria-busy={isPending}
        className="w-full max-w-sm space-y-4 border border-line bg-card p-8"
      >
        <div className="space-y-2 text-center">
          <h1 className="font-heading text-lg font-semibold text-fg">Entra al backstage</h1>
          {/* ⚠️ Dice **por qué** se pide el segundo factor, no que se pide. Que
              se pide ya se ve al pedirlo; lo que no se ve es que ésta es la
              única credencial del producto que abre la puerta de todos los
              couriers a la vez. */}
          <p className="text-sm text-fg-muted">
            Tu cuenta ve datos de todos los couriers, así que además del correo y la contraseña
            vamos a pedirte tu segundo factor.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="correo@ejemplo.com"
            autoComplete="username"
            autoFocus
            required
            disabled={isPending}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={isPending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "error-login-admin" : undefined}
          />
        </div>

        {error && (
          <p id="error-login-admin" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" loading={isPending}>
          {isPending ? "Verificando…" : "Entrar"}
        </Button>
      </form>
    </PantallaSinSesion>
  );
}
