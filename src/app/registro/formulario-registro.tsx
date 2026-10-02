"use client";

/**
 * «Crea tu cuenta» — registro v2, paso 1.
 * =============================================================================
 * Solo identifica: Google, o correo + código de 6 dígitos. Nada de la empresa
 * (eso es `/registro/empresa`). Debajo de los botones va el aviso de términos,
 * sin casilla: pulsar cualquiera de los dos caminos anota la intención de
 * registro en el servidor (versiones vigentes + instante), que es la evidencia.
 *
 * El paso del código es el componente compartido `IngresaCodigo`, el mismo del
 * login, dentro de esta misma columna.
 */

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";

import { AvisoTerminos } from "@/components/identidad/aviso-terminos";
import { IconoGoogle } from "@/components/identidad/icono-google";
import { IngresaCodigo } from "@/components/identidad/ingresa-codigo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { iniciarLoginConGoogle } from "@/lib/supabase/iniciar-login-google";
import { createClient } from "@/lib/supabase/client";
import { enviarCodigoRegistro, iniciarIntencionRegistro, verificarCodigoRegistro } from "./actions";

/** Traduce `?error=` de `/auth/callback`. */
function errorDesdeUrl(codigo: string | undefined): { mensaje: string; conSalida: boolean } | null {
  switch (codigo) {
    case "correo_ocupado":
      return { mensaje: "Ese correo ya tiene una cuenta en Rutax. Usa otro.", conSalida: true };
    case "oauth_invalido":
      return { mensaje: "No pudimos completar el registro con Google. Intenta de nuevo.", conSalida: false };
    default:
      return null;
  }
}

export function FormularioRegistro({ errorInicial }: { errorInicial?: string }) {
  const router = useRouter();
  const [paso, setPaso] = useState<"correo" | "codigo">("correo");
  const [email, setEmail] = useState("");
  const [enviandoGoogle, setEnviandoGoogle] = useState(false);
  const [enviandoCodigo, setEnviandoCodigo] = useState(false);
  const [error, setError] = useState<{ mensaje: string; conSalida: boolean } | null>(() =>
    errorDesdeUrl(errorInicial),
  );
  const campoCorreo = useRef<HTMLInputElement>(null);
  const destino = useRef("/registro/empresa");
  const cargando = enviandoGoogle || enviandoCodigo;

  async function manejarGoogle() {
    if (cargando) return;
    setError(null);
    setEnviandoGoogle(true);
    try {
      await iniciarIntencionRegistro();
      const { error: errorOauth } = await iniciarLoginConGoogle(
        createClient(),
        `${window.location.origin}/auth/callback`,
      );
      if (errorOauth) {
        setError({ mensaje: "No pudimos conectar con Google. Intenta de nuevo.", conSalida: false });
        setEnviandoGoogle(false);
      }
      // Sin error el navegador ya va camino a Google.
    } catch {
      setError({ mensaje: "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.", conSalida: false });
      setEnviandoGoogle(false);
    }
  }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (cargando) return;
    setError(null);
    if (!email.trim() || !email.includes("@")) {
      setError({ mensaje: "Ingresa un correo válido.", conSalida: false });
      campoCorreo.current?.focus();
      return;
    }
    setEnviandoCodigo(true);
    try {
      const r = await enviarCodigoRegistro(email.trim());
      if (!r.ok) {
        setError({ mensaje: r.mensaje, conSalida: r.tipo === "correo_ocupado" });
        campoCorreo.current?.focus();
        return;
      }
      setPaso("codigo");
    } catch {
      setError({ mensaje: "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.", conSalida: false });
    } finally {
      setEnviandoCodigo(false);
    }
  }

  if (paso === "codigo") {
    const correo = email.trim().toLowerCase();
    return (
      <IngresaCodigo
        email={correo}
        onVerificar={async (codigo) => {
          const r = await verificarCodigoRegistro(correo, codigo);
          if (r.ok) {
            destino.current = r.destino;
            return { ok: true };
          }
          return { ok: false, mensaje: r.mensaje };
        }}
        onReenviar={async () => {
          const r = await enviarCodigoRegistro(correo);
          return { ok: r.ok, mensaje: r.mensaje };
        }}
        onExito={() => {
          router.push(destino.current);
          router.refresh();
        }}
        onUsarOtroCorreo={() => {
          setPaso("correo");
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="w-full max-w-[400px]">
      <h1 className="font-heading text-2xl font-semibold text-fg">Crea tu cuenta</h1>

      <div className="mt-7 space-y-4">
        {error ? (
          <div role="alert" className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg">
            <span className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{error.mensaje}</span>
            </span>
            {error.conSalida ? (
              <Link href="/login" className="mt-1.5 block font-medium underline underline-offset-4">
                Iniciar sesión ›
              </Link>
            ) : null}
          </div>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="w-full pointer-coarse:h-12"
          onClick={manejarGoogle}
          disabled={cargando}
        >
          {enviandoGoogle ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <IconoGoogle className="size-4" />
          )}
          {enviandoGoogle ? "Conectando con Google…" : "Continuar con Google"}
        </Button>

        <div className="flex items-center gap-3 text-xs text-fg-subtle">
          <span className="h-px flex-1 bg-line" />
          o con tu correo
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={manejarEnvio} noValidate className="space-y-4" aria-busy={enviandoCodigo}>
          <div className="space-y-1.5">
            <Label htmlFor="registro-correo">Correo</Label>
            <Input
              id="registro-correo"
              ref={campoCorreo}
              type="email"
              autoComplete="email"
              placeholder="tu@empresa.cl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              readOnly={cargando}
              className="pointer-coarse:h-12"
            />
          </div>
          <Button type="submit" className="w-full pointer-coarse:h-12" disabled={cargando}>
            {enviandoCodigo ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Enviando código…
              </>
            ) : (
              "Enviar código"
            )}
          </Button>
        </form>

        <AvisoTerminos />
      </div>

      <p className="mt-8 text-center text-sm text-fg-subtle">
        <Link href="/login" className="underline underline-offset-4 hover:text-fg pointer-coarse:py-3">
          Ya tengo cuenta
        </Link>
      </p>
    </div>
  );
}
