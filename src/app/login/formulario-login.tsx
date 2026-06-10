"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/client";

export function FormularioLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError("Email o contraseña incorrectos. Verifica tus datos e intenta de nuevo.");
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
              <AlertDescription>{error}</AlertDescription>
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
            <Label htmlFor="password">Contraseña</Label>
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

          <Button type="submit" className="w-full" disabled={cargando}>
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
