"use client";

/**
 * Pedir el enlace, y la respuesta que no confirma nada.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL «SI» ES LA PALABRA QUE HACE TODO EL TRABAJO
 * -----------------------------------------------------------------------------
 * «**Si** ese correo tiene cuenta en Rutax, ya te llegó un enlace.» Una pantalla
 * pública **nunca confirma ni niega que un correo exista**, y ésta responde
 * exactamente lo mismo exista o no.
 *
 * Sin ese «si», el formulario se convierte en un oráculo: probando correos se
 * averigua cuáles están registrados, que es el primer paso de cualquiera que
 * quiera entrar por la fuerza.
 *
 * -----------------------------------------------------------------------------
 * EL TITULAR DICE EL RESULTADO, NO EL TRÁMITE
 * -----------------------------------------------------------------------------
 * «Cambia tu contraseña», no «Recuperar contraseña». Lo segundo describe lo que
 * hace el sistema; lo primero, lo que quiere quien está mirando.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL ENVIADO VA EN TONO `balanced`, NO EN `progress`
 * -----------------------------------------------------------------------------
 * Para el usuario **ya terminó lo que le tocaba**: escribió su correo y no hay
 * nada más que hacer acá. `progress` diría «esto sigue en curso» y lo dejaría
 * esperando delante de una pantalla que no va a cambiar.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VolverAEntrar } from "@/app/login/marco-puerta";
import { solicitarRecuperacionContrasena } from "./actions";

/**
 * Cuánto hay que esperar para pedir otro enlace.
 *
 * ⚠️ **Se muestra como cuenta atrás y no como «espera un momento»**: quien no ve
 * llegar el correo vuelve a pulsar, y un botón que no responde sin decir por qué
 * se lee como roto. Con el reloj a la vista, la espera es información.
 */
const SEGUNDOS_REENVIO = 60;

export function FormularioRecuperar() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restante, setRestante] = useState(0);

  useEffect(() => {
    if (restante <= 0) return;
    const id = window.setTimeout(() => setRestante((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [restante]);

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando || restante > 0) return;
    setError(null);
    setEnviando(true);
    try {
      const resultado = await solicitarRecuperacionContrasena(email);
      if (resultado.ok) {
        setEnviado(true);
        setRestante(SEGUNDOS_REENVIO);
        return;
      }
      // ⚠️ **El estado que faltaba.** Si el envío falla es problema nuestro, y
      // hay que decirlo así: sin esta frase, quien lo lee supone que escribió
      // mal el correo o que su cuenta no existe — y las dos son falsas.
      setError(
        "No pudimos mandar el correo. Fue un problema nuestro: tu contraseña sigue siendo la misma. Vuelve a intentar.",
      );
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className="w-full max-w-[400px]">
        <h1 className="font-heading text-2xl font-semibold text-fg">Revisa tu correo</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          {/* El «Si» inicial es la pieza de seguridad de esta pantalla. */}
          Si <span className="font-medium text-fg">{email}</span> tiene cuenta en Rutax, ya te
          llegó un enlace. Dura diez minutos.
        </p>

        <div className="mt-5 border border-balanced-line bg-balanced-bg px-3 py-2 text-sm text-balanced-fg">
          Si no lo ves, revisa el correo no deseado.{" "}
          {restante > 0 ? (
            <>
              Puedes pedir otro en{" "}
              <span className="rx-num font-mono tabular-nums">{formatearCuenta(restante)}</span>.
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEnviado(false);
                setError(null);
              }}
              className="font-medium underline underline-offset-4"
            >
              Pedir otro enlace
            </button>
          )}
        </div>

        <VolverAEntrar />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[400px]">
      <h1 className="font-heading text-2xl font-semibold text-fg">Cambia tu contraseña</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Escribe tu correo y te mandamos un enlace para crear una nueva.
      </p>

      <form onSubmit={manejarEnvio} className="mt-7 space-y-4" aria-busy={enviando}>
        {error && (
          <div
            role="alert"
            className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
          >
            {error}
          </div>
        )}

        {/* Un solo campo y una sola acción: si esta pantalla necesitara tres
            botones, estaría resolviendo dos problemas. */}
        <div className="space-y-1.5">
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="tu@correo.cl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            readOnly={enviando}
            className="pointer-coarse:h-12"
          />
        </div>

        <Button type="submit" className="w-full pointer-coarse:h-13" disabled={enviando}>
          {enviando ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              Mandando…
            </>
          ) : (
            "Mandarme el enlace"
          )}
        </Button>
      </form>

      <VolverAEntrar />
    </div>
  );
}

/** `0:47`. Los segundos siempre con dos dígitos: sin eso el ancho baila. */
function formatearCuenta(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
