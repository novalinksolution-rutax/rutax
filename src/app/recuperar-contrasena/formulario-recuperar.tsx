"use client";

/**
 * Paso 1 de 2 — "¿Olvidaste tu contraseña?".
 *
 * El estado de éxito NO dice "te enviamos un correo": dice "si existe una
 * cuenta con ese correo, te enviamos…". La diferencia no es de estilo — es lo
 * que impide que la pantalla confirme qué correos están registrados.
 */

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, Loader2, Mail, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { solicitarRecuperacionContrasena } from "./actions";

export function FormularioRecuperar() {
  const idBase = useId();

  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setError(null);
    setEnviando(true);
    try {
      const resultado = await solicitarRecuperacionContrasena(email);
      if (resultado.ok) {
        setEnviado(true);
        return;
      }
      setError(resultado.mensaje);
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <Card className="w-full max-w-sm text-center">
        <CardHeader className="items-center space-y-1">
          <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="size-6" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">Revisa tu correo</CardTitle>
          <CardDescription>
            Si existe una cuenta con <span className="font-medium text-foreground">{email}</span>, te enviamos un
            enlace para crear una contraseña nueva. Vence en 1 hora.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            ¿No llega? Revisa la carpeta de spam antes de volver a pedirlo.
          </p>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/login">Volver a iniciar sesión</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center space-y-1 text-center">
        <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="size-6" aria-hidden="true" />
        </div>
        <CardTitle className="text-xl">Recuperar contraseña</CardTitle>
        <CardDescription>Te enviaremos un enlace para crear una nueva.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={manejarEnvio} className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={`${idBase}-email`}>Correo electrónico</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id={`${idBase}-email`}
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="tu@correo.cl"
                className="pl-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={enviando}
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={enviando}>
            {enviando ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                Enviando…
              </>
            ) : (
              "Enviarme el enlace"
            )}
          </Button>

          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">
              <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
              Volver a iniciar sesión
            </Link>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
