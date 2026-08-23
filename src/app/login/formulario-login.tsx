"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/client";
import { traducirErrorLogin, type LecturaErrorLogin } from "@/lib/identidad/error-login";

export function FormularioLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);
  // ⚠️ Antes esto era un `string` y SIEMPRE decía lo mismo: «Email o contraseña
  // incorrectos». Daba igual que la cuenta estuviera suspendida, sin activar,
  // bloqueada por intentos o que el servicio no respondiera. Es la brecha #7, y
  // su daño real es que manda a la persona a arreglar lo único que no está mal.
  const [error, setError] = useState<LecturaErrorLogin | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    const supabase = createClient();

    let authError: { code?: string | null; status?: number | null; message?: string | null } | null =
      null;
    let sinRed = false;
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      authError = err;
    } catch {
      // El cliente LANZA cuando la petición no llega. Antes esto no se
      // capturaba: la excepción subía y el formulario quedaba «Ingresando…»
      // para siempre, sin decir nada.
      sinRed = true;
    }

    if (authError || sinRed) {
      setError(traducirErrorLogin(authError, sinRed));
      setCargando(false);
      return;
    }

    // El root "/" es un Server Component que lee la sesión y redirige
    // al área correcta según el tipo de usuario (interno/seller/conductor).
    router.push("/");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-semibold">Iniciar sesión</CardTitle>
        <CardDescription>Ingresa con tu correo y contraseña</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error.mensaje}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="tu@correo.cl"
                className="pl-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={cargando}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Contraseña</Label>
              <Link
                href="/recuperar-contrasena"
                className="text-sm text-brand underline-offset-4 hover:underline"
                tabIndex={cargando ? -1 : undefined}
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="pl-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={cargando}
              />
            </div>
          </div>

          {/* Cuando reintentar no ayuda —bloqueo por intentos, cuenta
              suspendida— el boton se apaga. Dejarlo activo invita justo a lo
              que empeora la situacion. */}
          <Button
            type="submit"
            className="w-full"
            disabled={cargando || (error?.reintentarNoAyuda ?? false)}
          >
            {cargando ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                Ingresando…
              </>
            ) : (
              "Ingresar"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
