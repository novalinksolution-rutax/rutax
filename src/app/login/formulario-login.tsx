"use client";

/**
 * El formulario de la puerta — F1, login sin contraseña.
 * =============================================================================
 * Se retira la contraseña entera (`signInWithPassword`, el botón "Ver", los
 * enlaces a `/recuperar-contrasena`, que ya no existe). Quedan dos caminos:
 *
 *   1. **"Continuar con Google"** — principal, directo (`signInWithOAuth`, sin
 *      guardar nada antes: a diferencia de `/registro`, acá no hay borrador
 *      que fijar).
 *   2. **Código de 6 dígitos por correo** — fallback, con `enviarCodigoLogin` +
 *      `verificarCodigoLogin` (`./actions`). El paso de "ingresa tu código" es
 *      el componente compartido `IngresaCodigo`, el mismo que usa `/registro`.
 *
 * -----------------------------------------------------------------------------
 * LO QUE SE CONSERVA DEL FORMULARIO ANTERIOR, Y NO ES ESTILO
 * -----------------------------------------------------------------------------
 * · el foco entra solo en el correo;
 * · mientras carga, el campo queda `readOnly` (no `disabled`): un campo
 *   deshabilitado se atenúa y se cae del orden de tabulación — quien está
 *   esperando pierde de vista lo que escribió;
 * · el error se anuncia con `role="alert"` y, cuando hay una salida que sí
 *   funciona (p. ej. crear una cuenta nueva), se ofrece como enlace;
 * · "está tardando más de lo normal" aparece sin quitar el estado de carga.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { IconoGoogle } from "@/components/identidad/icono-google";
import { IngresaCodigo } from "@/components/identidad/ingresa-codigo";
import { enviarCodigoLogin, verificarCodigoLogin } from "./actions";
import { iniciarLoginConGoogle } from "@/lib/supabase/iniciar-login-google";

/** Pasado esto, entrar dejó de parecer normal y hay que decirlo. */
const MS_TARDANZA = 4000;

interface ErrorLogin {
  mensaje: string;
  /** La salida que SÍ funciona, cuando existe (p. ej. crear cuenta nueva). */
  salida?: { href: string; texto: string };
}

/** Traduce `?error=` de `/auth/callback` a algo legible. Regla 45: ni confirma ni niega más de lo que el propio backend ya decidió. */
function errorDesdeUrl(codigo: string | undefined): ErrorLogin | null {
  switch (codigo) {
    case "oauth_invalido":
      return { mensaje: "No pudimos completar el inicio de sesión con Google. Intenta de nuevo." };
    case "sin_cuenta":
      return {
        mensaje: "No encontramos una cuenta con ese correo de Google.",
        salida: { href: "/registro", texto: "Crear una cuenta de courier" },
      };
    case "enlace_invalido":
      return { mensaje: "Este enlace no es válido o ya se usó. Vuelve a intentar desde aquí." };
    case "activacion_fallida":
      return {
        mensaje: "No pudimos activar tu cuenta. Intenta de nuevo o pide ayuda a quien te invitó.",
      };
    case "cuenta_suspendida":
      return {
        mensaje: "Esta cuenta fue dada de baja. Contacta a quien administra tu courier.",
      };
    default:
      return null;
  }
}

export function FormularioLogin({ errorInicial }: { errorInicial?: string }) {
  const router = useRouter();
  const idEmail = useId();

  const [paso, setPaso] = useState<"correo" | "codigo">("correo");
  const [email, setEmail] = useState("");
  const [enviandoGoogle, setEnviandoGoogle] = useState(false);
  const [enviandoCodigo, setEnviandoCodigo] = useState(false);
  const [tarda, setTarda] = useState(false);
  const [error, setError] = useState<ErrorLogin | null>(() => errorDesdeUrl(errorInicial));

  const campoCorreo = useRef<HTMLInputElement>(null);
  const cargando = enviandoGoogle || enviandoCodigo;

  // «Está tardando más de lo normal» sin quitar el estado de carga: no es un
  // error, es una espera que se alargó.
  useEffect(() => {
    if (!cargando) return;
    const id = window.setTimeout(() => setTarda(true), MS_TARDANZA);
    return () => window.clearTimeout(id);
  }, [cargando]);

  function validarCorreo(): boolean {
    if (!email.trim() || !email.includes("@")) {
      setError({ mensaje: "Ingresa un correo válido." });
      campoCorreo.current?.focus();
      return false;
    }
    return true;
  }

  async function manejarGoogle() {
    setError(null);
    setTarda(false);
    setEnviandoGoogle(true);

    try {
      const supabase = createClient();
      const { error: errorOauth } = await iniciarLoginConGoogle(
        supabase,
        `${window.location.origin}/auth/callback`,
      );

      if (errorOauth) {
        setError({ mensaje: "No pudimos conectar con Google. Intenta de nuevo." });
        setEnviandoGoogle(false);
        return;
      }
      // Sin error: el navegador ya está redirigiendo a Google. El estado de
      // carga se queda encendido a propósito — no hay a qué volver acá.
    } catch {
      setError({
        mensaje: "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.",
      });
      setEnviandoGoogle(false);
    }
  }

  async function manejarEnvioCodigo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setTarda(false);
    if (!validarCorreo()) return;

    setEnviandoCodigo(true);
    const resultado = await enviarCodigoLogin(email.trim());
    setEnviandoCodigo(false);

    if (!resultado.ok) {
      setError({ mensaje: resultado.mensaje });
      campoCorreo.current?.focus();
      return;
    }
    setPaso("codigo");
  }

  if (paso === "codigo") {
    const correo = email.trim();
    return (
      <IngresaCodigo
        email={correo}
        onVerificar={async (codigo) => {
          const resultado = await verificarCodigoLogin(correo, codigo);
          return resultado.ok ? { ok: true } : { ok: false, mensaje: resultado.mensaje };
        }}
        onReenviar={() => enviarCodigoLogin(correo)}
        onExito={() => {
          // El root "/" es un Server Component que lee la sesión y redirige
          // al área correcta según el tipo de usuario (interno/seller/conductor).
          router.push("/");
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
      <h1 className="font-heading text-2xl font-semibold text-fg">Entra a tu operación</h1>
      <p className="mt-1 text-sm text-fg-muted">Plataforma de despacho y liquidación.</p>

      <div className="mt-7 space-y-4">
        {error && (
          <div
            role="alert"
            className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
          >
            <span className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{error.mensaje}</span>
            </span>
            {error.salida && (
              <Link
                href={error.salida.href}
                className="mt-1.5 block font-medium underline underline-offset-4"
              >
                {error.salida.texto} ›
              </Link>
            )}
          </div>
        )}

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
          o con un código
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={manejarEnvioCodigo} className="space-y-4" aria-busy={enviandoCodigo}>
          <div className="space-y-1.5">
            <Label htmlFor={idEmail}>Correo</Label>
            <Input
              id={idEmail}
              ref={campoCorreo}
              type="email"
              autoComplete="email"
              placeholder="tu@correo.cl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              readOnly={cargando}
              // 48 px de alto con el dedo: es un campo que se llena de pie.
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
              "Enviar código por correo"
            )}
          </Button>
        </form>

        {tarda && (
          <p aria-live="polite" className="text-center text-xs text-fg-muted">
            Está tardando más de lo normal.
          </p>
        )}
      </div>

      <p className="mt-8 text-center text-sm text-fg-subtle">
        <Link href="/" className="underline underline-offset-4 hover:text-fg">
          Qué es Rutax
        </Link>
      </p>
    </div>
  );
}
