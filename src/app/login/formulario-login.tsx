"use client";

/**
 * El formulario de la puerta.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * LO QUE SE JUEGA ACÁ, Y NO ES EL ESTILO
 * -----------------------------------------------------------------------------
 * Un login falla de seis maneras distintas y **cinco de ellas no son culpa de
 * la contraseña**. La peor consecuencia de confundirlas es concreta: alguien con
 * la contraseña correcta la cambia porque la pantalla le dijo que estaba mal.
 *
 * La distinción que sostiene todo el archivo: **«no coinciden» culpa a la
 * credencial; «no pudimos validar» nos culpa a nosotros.** El texto vive en
 * `traducirErrorLogin`, que las separa y además dice cuándo reintentar no ayuda.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ MIENTRAS CARGA, LOS CAMPOS QUEDAN `readOnly`, NO `disabled`
 * -----------------------------------------------------------------------------
 * Un campo deshabilitado **se atenúa y deja de leerse**, así que quien está
 * esperando pierde de vista el correo que acaba de escribir — y si la cosa
 * tarda, no puede ni comprobar si lo escribió bien. `readOnly` impide editar y
 * conserva el contraste. Además un `disabled` se cae del orden de tabulación, y
 * el foco salta a cualquier parte.
 *
 * -----------------------------------------------------------------------------
 * ACCESIBILIDAD, QUE EN UN LOGIN SE NOTA
 * -----------------------------------------------------------------------------
 * · el foco entra solo en el correo;
 * · `autocomplete` declarado, para que el gestor de contraseñas funcione;
 * · el error se anuncia al lector de pantalla (`role="alert"`) **y el foco
 *   vuelve al primer campo con problema** — sin eso, quien navega con teclado se
 *   entera del error y se queda al final del formulario;
 * · «Ver» es un **botón con estado**, no un ícono mudo: dice si la contraseña
 *   está a la vista, que es justo lo que alguien no puede comprobar mirando.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { traducirErrorLogin, type LecturaErrorLogin } from "@/lib/identidad/error-login";

/** Pasado esto, entrar dejó de parecer normal y hay que decirlo. */
const MS_TARDANZA = 4000;

export function FormularioLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [tarda, setTarda] = useState(false);
  // ⚠️ Antes esto era un `string` y SIEMPRE decía lo mismo: «Email o contraseña
  // incorrectos». Daba igual que la cuenta estuviera suspendida, sin activar,
  // bloqueada por intentos o que el servicio no respondiera. Es la brecha #7, y
  // su daño real es que manda a la persona a arreglar lo único que no está mal.
  const [error, setError] = useState<LecturaErrorLogin | null>(null);

  const campoCorreo = useRef<HTMLInputElement>(null);
  const campoClave = useRef<HTMLInputElement>(null);

  // «Está tardando más de lo normal» aparece **sin quitar el estado de carga**:
  // no es un error ni un fallo, es una espera que se alargó.
  useEffect(() => {
    if (!cargando) return;
    const id = window.setTimeout(() => setTarda(true), MS_TARDANZA);
    // El aviso se apaga desde el manejador del envío, no acá: escribir estado
    // dentro de un efecto por el mero hecho de que otro estado cambió es lo que
    // `react-hooks/set-state-in-effect` prohíbe, y con razón — obliga a un
    // render extra para deshacer algo que el evento ya sabía.
    return () => window.clearTimeout(id);
  }, [cargando]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setTarda(false);
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
      const lectura = traducirErrorLogin(authError, sinRed);
      setError(lectura);
      setCargando(false);
      // ⚠️ **Solo se limpia la contraseña; el correo se queda.** Borrar los dos
      // obliga a reescribir lo que estaba bien, y en un teléfono eso es la mitad
      // del trabajo. Y el foco vuelve al campo que hay que corregir.
      setPassword("");
      setVerClave(false);
      campoClave.current?.focus();
      return;
    }

    // El root "/" es un Server Component que lee la sesión y redirige
    // al área correcta según el tipo de usuario (interno/seller/conductor).
    router.push("/");
    router.refresh();
  }

  return (
    <div className="w-full max-w-[400px]">
      <h1 className="font-heading text-2xl font-semibold text-fg">Entra a tu operación</h1>
      {/* ⚠️ El tablero dice «La plataforma de despacho y liquidación **de tu
          courier**». Se recortan el complemento y el artículo (decisión del
          usuario, 24-08-2026).
          Lo del complemento encaja con que ésta sea **una puerta y no tres**:
          por acá entran el equipo del courier, sus sellers y sus conductores, y
          a un seller «tu courier» le nombra a su proveedor, no a él. Sin él la
          frase describe el producto sin suponer quién mira.
          Y sin el artículo deja de ser una afirmación de categoría —«LA
          plataforma»— para ser lo que corresponde bajo un titular: una etiqueta
          de qué es esto. */}
      <p className="mt-1 text-sm text-fg-muted">
        Plataforma de despacho y liquidación.
      </p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-4" aria-busy={cargando}>
        {error && (
          // `role="alert"` y no un `<Alert>` decorativo: el error tiene que
          // anunciarse solo a quien no lo ve aparecer.
          <div
            role="alert"
            className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
          >
            {error.mensaje}
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

        <div className="space-y-1.5">
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
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

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="password">Contraseña</Label>
            {/* En escritorio vive junto a la etiqueta; en táctil baja al pie,
                centrado — con el pulgar, un enlace chico pegado a una etiqueta
                es un error de toque esperando. */}
            <Link
              href="/recuperar-contrasena"
              className="text-sm text-brand underline-offset-4 hover:underline pointer-coarse:hidden"
              tabIndex={cargando ? -1 : undefined}
            >
              ¿La olvidaste?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              ref={campoClave}
              type={verClave ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              readOnly={cargando}
              className="pr-16 pointer-coarse:h-12"
            />
            {/* Botón con estado, no un ícono mudo: `aria-pressed` dice si la
                contraseña está a la vista, que es lo que alguien no puede
                comprobar mirando su propia pantalla. */}
            <button
              type="button"
              onClick={() => setVerClave((v) => !v)}
              aria-pressed={verClave}
              aria-controls="password"
              className="absolute inset-y-0 right-0 px-3 text-sm font-medium text-fg-muted hover:text-fg"
            >
              {verClave ? "Ocultar" : "Ver"}
            </button>
          </div>
        </div>

        {/* Cuando reintentar no ayuda —bloqueo por intentos, cuenta
            suspendida— el botón se apaga. Dejarlo activo invita justo a lo
            que empeora la situación. */}
        <Button
          type="submit"
          className="w-full pointer-coarse:h-13"
          disabled={cargando || (error?.reintentarNoAyuda ?? false)}
        >
          {cargando ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              Entrando…
            </>
          ) : (
            "Entrar"
          )}
        </Button>

        {tarda && (
          <p aria-live="polite" className="text-center text-xs text-fg-muted">
            Está tardando más de lo normal.
          </p>
        )}

        <Link
          href="/recuperar-contrasena"
          className="hidden text-center text-sm text-brand underline-offset-4 hover:underline pointer-coarse:block"
        >
          ¿Olvidaste tu contraseña?
        </Link>
      </form>

      {/* ⚠️ El tablero pone acá «¿Tu courier todavía no usa Rutax? Agenda una
          demostración». Se cambia (decisión del usuario, 24-08-2026): por esta
          puerta entran también sellers y conductores, y a ellos esa frase les
          afirma algo que no les consta y les ofrece algo que no les toca.
          Lo que queda le sirve a los tres y no supone quién eres. */}
      <p className="mt-8 text-center text-sm text-fg-subtle">
        <Link href="/" className="underline underline-offset-4 hover:text-fg">
          Qué es Rutax
        </Link>
      </p>
    </div>
  );
}
