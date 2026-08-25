"use client";

/**
 * Crear la contraseña nueva — y el enlace que ya no sirve.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * ⚠️ UN SOLO CAMPO, NO DOS
 * -----------------------------------------------------------------------------
 * **Repetir la contraseña es un ritual de cuando no se podía ver lo escrito.**
 * Con «Ver» a mano, el segundo campo no aporta una comprobación: aporta **un
 * lugar más donde equivocarse**, y su error más común —«no coinciden»— manda a
 * reescribir las dos.
 *
 * -----------------------------------------------------------------------------
 * «GUARDAR Y ENTRAR», NO «GUARDAR»
 * -----------------------------------------------------------------------------
 * Quien llega acá **ya se autenticó con el enlace del correo**. Devolverlo al
 * login después de cambiar la contraseña sería pedirle que se identifique dos
 * veces seguidas, con la contraseña que acaba de inventar y todavía no ha usado.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL AVISO DE LAS OTRAS SESIONES VA ANTES, NO DESPUÉS
 * -----------------------------------------------------------------------------
 * Cerrar la sesión de los otros aparatos es lo correcto —si alguien cambia su
 * contraseña porque sospecha que se metieron, no cerrarlas no arregla nada— pero
 * **es una consecuencia que se avisa antes de que ocurra**, no un hecho que se
 * cuenta después.
 *
 * -----------------------------------------------------------------------------
 * EL ENLACE VENCIDO NO ES UNA FALLA
 * -----------------------------------------------------------------------------
 * Va en tono **atención**, no en `fault`: **no se rompió nada, solo pasó el
 * tiempo**. Y las dos causas —venció, o ya se usó— van en un solo mensaje,
 * porque la acción es idéntica: pedir otro. Distinguirlas sería precisión que no
 * le sirve de nada a quien lo lee.
 */

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { LARGO_MINIMO, medirFuerza } from "@/lib/identidad/fuerza-contrasena";
import { VolverAEntrar } from "@/app/login/marco-puerta";
import { restablecerContrasena } from "./actions";

export function FormularioRestablecer({
  enlaceInvalido,
  email,
}: {
  enlaceInvalido: boolean;
  email?: string | null;
}) {
  const router = useRouter();
  const [contrasena, setContrasena] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fuerza = medirFuerza(contrasena);

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (guardando) return;
    setError(null);
    setGuardando(true);
    try {
      const resultado = await restablecerContrasena({ contrasena });
      if (resultado.ok) {
        // Ya autenticado por el enlace: entra directo.
        router.push("/");
        router.refresh();
        return;
      }
      setError(resultado.mensaje);
    } finally {
      setGuardando(false);
    }
  }

  if (enlaceInvalido) {
    return (
      <div className="w-full max-w-[400px]">
        <h1 className="font-heading text-2xl font-semibold text-fg">Este enlace ya no sirve</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          Los enlaces duran diez minutos, y solo se pueden usar una vez. Pide otro y te llega al tiro.
        </p>

        {/* Atención, no falla: no se rompió nada, solo pasó el tiempo. */}
        <div className="mt-5 border border-attention-line bg-attention-bg px-3 py-2 text-sm text-attention-fg">
          Tu contraseña sigue siendo la de antes.
        </div>

        <Button asChild className="mt-5 w-full pointer-coarse:h-13">
          <Link href="/recuperar-contrasena">Pedir otro enlace</Link>
        </Button>

        <VolverAEntrar />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[400px]">
      <h1 className="font-heading text-2xl font-semibold text-fg">Crea tu contraseña nueva</h1>
      {email && <p className="rx-num mt-1 font-mono text-xs text-fg-muted">{email}</p>}

      <form onSubmit={manejarEnvio} className="mt-7 space-y-4" aria-busy={guardando}>
        {error && (
          <div
            role="alert"
            className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
          >
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="contrasena">Contraseña nueva</Label>
            {fuerza.etiqueta && (
              <span
                aria-live="polite"
                className={cn(
                  "text-xs font-medium",
                  fuerza.pasos >= 3 ? "text-balanced-fg" : "text-attention-fg",
                )}
              >
                {fuerza.etiqueta}
              </span>
            )}
          </div>

          <div className="relative">
            <Input
              id="contrasena"
              type={verClave ? "text" : "password"}
              autoComplete="new-password"
              placeholder="••••••••••••"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              required
              minLength={LARGO_MINIMO}
              autoFocus
              readOnly={guardando}
              className="pr-16 pointer-coarse:h-12"
            />
            <button
              type="button"
              onClick={() => setVerClave((v) => !v)}
              aria-pressed={verClave}
              aria-controls="contrasena"
              className="absolute inset-y-0 right-0 px-3 text-sm font-medium text-fg-muted hover:text-fg"
            >
              {verClave ? "Ocultar" : "Ver"}
            </button>
          </div>

          {/* La barra es el mismo dato que la palabra, dicho en el espacio: se
              lee de reojo mientras se escribe, sin tener que leer. */}
          <div className="flex gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((paso) => (
              <span
                key={paso}
                className={cn(
                  "h-1 flex-1",
                  paso > fuerza.pasos
                    ? "bg-line-subtle"
                    : fuerza.pasos >= 3
                      ? "bg-balanced-fg"
                      : "bg-attention-fg",
                )}
              />
            ))}
          </div>

          {/* ⚠️ Dice el mínimo Y que no hacen falta símbolos raros. Lo segundo no
              es amabilidad: las reglas de composición producen `Rutax2026!` en
              vez de una frase larga, y esa es más fácil de adivinar. */}
          <p className="text-xs text-fg-subtle">
            Mínimo {LARGO_MINIMO} caracteres. No tiene que tener símbolos raros.
          </p>
        </div>

        <Button
          type="submit"
          className="w-full pointer-coarse:h-13"
          disabled={guardando || contrasena.length < LARGO_MINIMO}
        >
          {guardando ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              Guardando…
            </>
          ) : (
            "Guardar y entrar"
          )}
        </Button>

        <p className="text-center text-xs text-fg-subtle">
          Vamos a cerrar tu sesión en los otros aparatos donde hayas entrado.
        </p>
      </form>

      <VolverAEntrar />
    </div>
  );
}
