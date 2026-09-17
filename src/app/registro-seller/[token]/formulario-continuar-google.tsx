"use client";

/**
 * Landing pública del enlace permanente de un courier (RF-010 rediseño) —
 * el botón de Google.
 * =============================================================================
 * Mismo patrón EXACTO que `formulario-alta-empresa.tsx::manejarGoogle`: primero
 * se guarda el borrador (acá, `iniciarRegistroSellerAction`, que fija el
 * `tenantId` del enlace en una cookie firmada) y LUEGO se dispara
 * `signInWithOAuth`. El resto —resolver la identidad, decidir si arranca el
 * wizard o si ya es seller de este mismo courier— lo hace `/auth/callback`.
 *
 * Solo Google: a diferencia de `/registro` (que también ofrece código por
 * correo), acá no hay un segundo camino — el visitante no está creando una
 * cuenta desde cero, se está sumando a un courier que ya conoce, y Google es
 * el atajo de un clic que el enlace promete.
 */

import { useState, type FormEvent } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { IconoGoogle } from "@/components/identidad/icono-google";
import { createClient } from "@/lib/supabase/client";
import { iniciarRegistroSellerAction } from "./actions";

/** Traduce `?error=` que puede mandar `/auth/callback` de vuelta a esta landing. */
function errorDesdeUrl(codigo: string | undefined): string | null {
  switch (codigo) {
    case "correo_ocupado":
      return "Esa cuenta de Google ya es otra cosa en Rutax (conductor, equipo interno, u otra sesión de plataforma) y no puede registrarse como seller. Usa otra cuenta de Google.";
    case "enlace_invalido":
      return "Este enlace no es válido o ya no está activo. Pídele a tu courier que te comparta uno nuevo.";
    default:
      return null;
  }
}

export function FormularioContinuarGoogle({
  token,
  errorInicial,
}: {
  token: string;
  errorInicial?: string;
}) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(() => errorDesdeUrl(errorInicial));

  async function manejarGoogle(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setError(null);
    setEnviando(true);

    try {
      const resultado = await iniciarRegistroSellerAction(token);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        setEnviando(false);
        return;
      }

      const supabase = createClient();
      const { error: errorOAuth } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });

      if (errorOAuth) {
        setError("No pudimos conectar con Google. Intenta de nuevo.");
        setEnviando(false);
      }
      // Sin error: el navegador ya está redirigiendo a Google.
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
      setEnviando(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-5 border border-line bg-bg-raised p-6">
      <div className="space-y-1.5 text-center">
        <h1 className="font-heading text-xl leading-tight font-semibold">Súmate como seller</h1>
        <p className="text-sm leading-relaxed text-fg-muted">
          Entra con tu cuenta de Google y completa tus datos — quedas activo al instante, sin
          esperar aprobación.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" aria-hidden="true" />
          <AlertTitle>No pudimos continuar</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={enviando}
        onClick={manejarGoogle}
      >
        {enviando ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <IconoGoogle className="size-4" />
        )}
        {enviando ? "Conectando con Google…" : "Continuar con Google"}
      </Button>

      <p className="text-center text-xs text-fg-subtle">
        Al continuar vas a poder revisar y aceptar el tratamiento de tus datos en el siguiente
        paso.
      </p>
    </div>
  );
}
