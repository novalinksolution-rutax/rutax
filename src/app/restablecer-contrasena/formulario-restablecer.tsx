"use client";

/**
 * Paso 2 de 2 — "Crea tu contraseña nueva".
 *
 * Calca deliberadamente el medidor de fortaleza y las reglas de validación de
 * `/activar-cuenta`: es la misma decisión para la persona (elegir una clave),
 * y dos criterios distintos para lo mismo se sienten como un error.
 */

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { restablecerContrasena } from "./actions";

interface Props {
  /** `true` si `/auth/confirm` no pudo validar el enlace — token inválido/usado/vencido. */
  enlaceInvalido: boolean;
}

export function FormularioRestablecer({ enlaceInvalido }: Props) {
  const router = useRouter();
  const idBase = useId();

  const [contrasena, setContrasena] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [errores, setErrores] = useState<{ contrasena?: string; confirmacion?: string }>({});
  const [enviando, setEnviando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);

  if (enlaceInvalido) {
    return (
      <Card className="w-full max-w-sm text-center">
        <CardHeader className="items-center space-y-1">
          <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted">
            <ShieldAlert className="size-6 text-warning" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">Este enlace ya no es válido</CardTitle>
          <CardDescription>
            Los enlaces de recuperación vencen en 1 hora y sirven una sola vez. Pide uno nuevo para continuar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full">
            <Link href="/recuperar-contrasena">Pedir un enlace nuevo</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">Volver a iniciar sesión</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const fortaleza = calcularFortaleza(contrasena);

  function validar(): boolean {
    const nuevos: typeof errores = {};
    if (contrasena.length < 8) nuevos.contrasena = "La contraseña debe tener al menos 8 caracteres.";
    if (contrasena !== confirmacion) nuevos.confirmacion = "Las contraseñas no coinciden.";
    setErrores(nuevos);
    return Object.keys(nuevos).length === 0;
  }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setErrorServidor(null);
    if (!validar()) return;

    setEnviando(true);
    try {
      const resultado = await restablecerContrasena({ contrasena });
      if (resultado.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      setErrorServidor(resultado.mensaje);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center space-y-1 text-center">
        <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="size-6" aria-hidden="true" />
        </div>
        <CardTitle className="text-xl">Crea tu contraseña nueva</CardTitle>
        <CardDescription>Con esta contraseña entrarás a Rutax de aquí en adelante.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={manejarEnvio} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${idBase}-contrasena`}>Contraseña nueva</Label>
            <Input
              id={`${idBase}-contrasena`}
              type="password"
              autoComplete="new-password"
              autoFocus
              value={contrasena}
              onChange={(e) => {
                setContrasena(e.target.value);
                setErrores((a) => ({ ...a, contrasena: undefined }));
              }}
              aria-invalid={Boolean(errores.contrasena)}
            />
            {contrasena ? (
              <div className="space-y-1">
                <div className="flex h-1.5 gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`h-full flex-1 rounded-full ${i < fortaleza.nivel ? fortaleza.color : "bg-muted"}`}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{fortaleza.etiqueta}</p>
              </div>
            ) : null}
            {errores.contrasena ? <p className="text-sm text-destructive">{errores.contrasena}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idBase}-confirmacion`}>Confirma tu contraseña</Label>
            <Input
              id={`${idBase}-confirmacion`}
              type="password"
              autoComplete="new-password"
              value={confirmacion}
              onChange={(e) => {
                setConfirmacion(e.target.value);
                setErrores((a) => ({ ...a, confirmacion: undefined }));
              }}
              aria-invalid={Boolean(errores.confirmacion)}
            />
            {errores.confirmacion ? <p className="text-sm text-destructive">{errores.confirmacion}</p> : null}
          </div>

          {errorServidor ? (
            <Alert variant="destructive">
              <AlertDescription>{errorServidor}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" className="w-full" disabled={enviando}>
            {enviando ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
            {enviando ? "Guardando…" : "Guardar y entrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function calcularFortaleza(valor: string): { nivel: number; etiqueta: string; color: string } {
  let puntos = 0;
  if (valor.length >= 8) puntos += 1;
  if (valor.length >= 12) puntos += 1;
  if (/[A-Z]/.test(valor) && /[a-z]/.test(valor)) puntos += 1;
  if (/[0-9]/.test(valor) || /[^A-Za-z0-9]/.test(valor)) puntos += 1;

  if (puntos <= 1) return { nivel: 1, etiqueta: "Débil — agrega más caracteres", color: "bg-destructive" };
  if (puntos === 2) return { nivel: 2, etiqueta: "Regular", color: "bg-warning" };
  if (puntos === 3) return { nivel: 3, etiqueta: "Buena", color: "bg-warning" };
  return { nivel: 4, etiqueta: "Fuerte", color: "bg-success" };
}
