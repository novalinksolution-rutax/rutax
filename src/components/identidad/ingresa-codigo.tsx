"use client";

/**
 * El segundo paso del login sin contraseña (F1): "ingresa tu código".
 * =============================================================================
 * Compartido entre `/registro` (tras `enviarCodigoRegistro`) y `/login` (tras
 * `enviarCodigoLogin`) — misma pantalla, dos Server Actions distintas
 * inyectadas por quien lo usa (`onVerificar`/`onReenviar`), sin que este
 * componente sepa nada de registro ni de sesión.
 *
 * Preserva el patrón de accesibilidad del formulario de login que reemplaza:
 * `readOnly` (no `disabled`) mientras verifica, aviso de tardanza, error
 * anunciado con `role="alert"` y foco de vuelta al campo con problema.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MS_TARDANZA = 4000;
const SEGUNDOS_ESPERA_REENVIO = 30;

export interface ResultadoVerificacion {
  ok: boolean;
  mensaje?: string;
}

export interface IngresaCodigoProps {
  email: string;
  /** `verificarCodigoRegistro` o `verificarCodigoLogin`, ya con el correo aplicado. */
  onVerificar: (codigo: string) => Promise<ResultadoVerificacion>;
  /** `enviarCodigoRegistro` o `enviarCodigoLogin`, para "reenviar código". */
  onReenviar: () => Promise<ResultadoVerificacion>;
  /** Se llama tras una verificación exitosa (`ok: true`). */
  onExito: () => void;
  /** "No es tu correo" — vuelve al paso anterior. Opcional: el registro no lo necesita porque el correo ya quedó fijado en el borrador. */
  onUsarOtroCorreo?: () => void;
}

export function IngresaCodigo({
  email,
  onVerificar,
  onReenviar,
  onExito,
  onUsarOtroCorreo,
}: IngresaCodigoProps) {
  const idCodigo = useId();
  const idAyuda = `${idCodigo}-ayuda`;
  const idError = `${idCodigo}-error`;

  const [codigo, setCodigo] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [tarda, setTarda] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [estadoReenvio, setEstadoReenvio] = useState<"inicial" | "enviando" | "esperando">("inicial");
  const [mensajeReenvio, setMensajeReenvio] = useState<string | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);

  const campoCodigo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    campoCodigo.current?.focus();
  }, []);

  // «Está tardando más de lo normal» sin quitar el estado de carga: no es un
  // error, es una espera que se alargó.
  useEffect(() => {
    if (!verificando) return;
    const id = window.setTimeout(() => setTarda(true), MS_TARDANZA);
    return () => window.clearTimeout(id);
  }, [verificando]);

  async function verificar(valor: string) {
    if (verificando || valor.length !== 6) return;
    setError(null);
    setTarda(false);
    setVerificando(true);

    const resultado = await onVerificar(valor);

    if (!resultado.ok) {
      setError(resultado.mensaje ?? "El código no es válido o venció. Pide uno nuevo.");
      setVerificando(false);
      setCodigo("");
      campoCodigo.current?.focus();
      return;
    }

    onExito();
    // No se apaga `verificando`: la pantalla está en tránsito (redirigiendo),
    // y volver a `false` solo para reactivar los campos un instante confunde.
  }

  function manejarCambioCodigo(valor: string) {
    const soloDigitos = valor.replace(/\D/g, "").slice(0, 6);
    setCodigo(soloDigitos);
    if (soloDigitos.length === 6) {
      void verificar(soloDigitos);
    }
  }

  function manejarEnvio(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void verificar(codigo);
  }

  function iniciarEsperaReenvio() {
    setSegundosRestantes(SEGUNDOS_ESPERA_REENVIO);
    setEstadoReenvio("esperando");
    const intervalo = setInterval(() => {
      setSegundosRestantes((anterior) => {
        if (anterior <= 1) {
          clearInterval(intervalo);
          setEstadoReenvio("inicial");
          return 0;
        }
        return anterior - 1;
      });
    }, 1000);
  }

  async function manejarReenvio() {
    if (estadoReenvio !== "inicial") return;
    setEstadoReenvio("enviando");
    setMensajeReenvio(null);
    setError(null);

    const resultado = await onReenviar();
    setMensajeReenvio(resultado.mensaje ?? "Te enviamos un nuevo código. Dura 10 minutos.");
    iniciarEsperaReenvio();
    setCodigo("");
    campoCodigo.current?.focus();
  }

  const deshabilitadoReenvio = estadoReenvio !== "inicial";

  return (
    <div className="w-full max-w-[400px] space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-fg">Ingresa tu código</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Enviamos un código de 6 dígitos a <span className="font-medium text-fg">{email}</span>.
          Dura 10 minutos.
        </p>
      </div>

      <form onSubmit={manejarEnvio} className="space-y-4" aria-busy={verificando}>
        {error && (
          <div
            id={idError}
            role="alert"
            className="flex items-start gap-1.5 border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
          >
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={idCodigo}>Código de 6 dígitos</Label>
          <Input
            id={idCodigo}
            ref={campoCodigo}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            value={codigo}
            onChange={(e) => manejarCambioCodigo(e.target.value)}
            readOnly={verificando}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? idError : idAyuda}
            className="text-center font-mono text-lg tracking-[0.5em] pointer-coarse:h-12"
            autoFocus
          />
          <p id={idAyuda} className="sr-only">
            Ingresa los 6 dígitos que enviamos por correo. Se verifica automáticamente al completarlos.
          </p>
        </div>

        <Button type="submit" className="w-full pointer-coarse:h-12" disabled={verificando || codigo.length !== 6}>
          {verificando ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Verificando…
            </>
          ) : (
            "Verificar código"
          )}
        </Button>

        {tarda && (
          <p aria-live="polite" className="text-center text-xs text-fg-muted">
            Está tardando más de lo normal.
          </p>
        )}
      </form>

      <div className="space-y-2 text-center text-sm">
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={manejarReenvio}
          disabled={deshabilitadoReenvio}
          className="h-auto p-0"
        >
          {estadoReenvio === "esperando"
            ? `Reenviar código (espera ${segundosRestantes}s)`
            : estadoReenvio === "enviando"
              ? "Enviando…"
              : "¿No te llegó? Reenviar código"}
        </Button>
        {mensajeReenvio ? (
          <p role="status" className="text-xs text-fg-muted">
            {mensajeReenvio}
          </p>
        ) : null}
      </div>

      {onUsarOtroCorreo ? (
        <button
          type="button"
          onClick={onUsarOtroCorreo}
          className="block w-full text-center text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          Usar otro correo
        </button>
      ) : null}
    </div>
  );
}
