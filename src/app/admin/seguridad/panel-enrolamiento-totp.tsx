"use client";

/**
 * Enrolamiento de un segundo factor TOTP (Google Authenticator, Authy, 1Password,
 * etc.) para el backstage de Rutax — F3-A.
 *
 * Reutilizado en DOS lugares:
 * 1. `layout.tsx` (inline, `autoIniciar`) — la ÚNICA superficie que un
 *    super-admin sin ningún factor puede alcanzar: apenas entra ya está
 *    generando su QR, sin un clic extra.
 * 2. `/admin/seguridad` (`autoIniciar={false}`) — gestión voluntaria para un
 *    admin que YA tiene AAL2 y quiere agregar/reconfigurar un factor (p. ej.
 *    perdió el teléfono). Aquí NO se auto-inicia: cada `iniciarEnrolamientoTotp()`
 *    crea un factor TOTP nuevo en Supabase (sin verificar hasta el paso 2), así
 *    que solo se pide bajo demanda para no acumular factores huérfanos cada vez
 *    que un admin visita la pantalla por curiosidad.
 *
 * El QR (`qrCodeSvg`) que devuelve `iniciarEnrolamientoTotp()` YA viene como
 * data URI (`data:image/svg+xml;utf-8,<svg>...`) — lo arma el propio SDK de
 * Supabase (`@supabase/auth-js`) antes de que este componente lo reciba, así
 * que basta un `<img src>` plano, sin decodificar ni envolver en Image de Next
 * (que no acepta bien data URIs SVG).
 */

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { iniciarEnrolamientoTotp, verificarEnrolamientoTotp } from "../acciones-mfa";

type Estado =
  | { paso: "inicio" }
  | { paso: "cargando" }
  | { paso: "error_inicio"; mensaje: string }
  | { paso: "verificar"; factorId: string; qrCodeSvg: string; secret: string }
  | { paso: "exito" };

interface Props {
  /** Si `false`, el componente parte en un botón "Comenzar" en vez de llamar a Supabase de inmediato. */
  autoIniciar?: boolean;
  /** Se llama tras verificar el código con éxito (además del mensaje de éxito que ya se muestra). */
  onExito?: () => void;
}

export function PanelEnrolamientoTotp({ autoIniciar = true, onExito }: Props) {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>(autoIniciar ? { paso: "cargando" } : { paso: "inicio" });
  const [codigo, setCodigo] = useState("");
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputCodigoRef = useRef<HTMLInputElement>(null);
  const idCodigo = useId();
  const yaIntento = useRef(false);

  function iniciar() {
    setEstado({ paso: "cargando" });
    startTransition(async () => {
      const resultado = await iniciarEnrolamientoTotp();
      if (!resultado.ok) {
        setEstado({ paso: "error_inicio", mensaje: resultado.mensaje });
        return;
      }
      setEstado({
        paso: "verificar",
        factorId: resultado.factorId,
        qrCodeSvg: resultado.qrCodeSvg,
        secret: resultado.secret,
      });
    });
  }

  useEffect(() => {
    if (autoIniciar && !yaIntento.current) {
      yaIntento.current = true;
      iniciar();
    }
  }, [autoIniciar]);

  useEffect(() => {
    if (estado.paso === "verificar") {
      inputCodigoRef.current?.focus();
    }
  }, [estado.paso]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (estado.paso !== "verificar") return;
    setErrorCodigo(null);
    const { factorId } = estado;
    startTransition(async () => {
      const resultado = await verificarEnrolamientoTotp(factorId, codigo);
      if (!resultado.ok) {
        setErrorCodigo(resultado.mensaje);
        setCodigo("");
        inputCodigoRef.current?.focus();
        return;
      }
      setEstado({ paso: "exito" });
      onExito?.();
    });
  }

  async function copiarSecreto(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Portapapeles no disponible (permiso denegado, contexto no seguro, etc.) —
      // el secret ya está visible en texto, así que no es bloqueante.
    }
  }

  if (estado.paso === "inicio") {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">
          Agrega o reemplaza el segundo factor (MFA) de tu cuenta de administrador.
        </p>
        <Button onClick={iniciar} disabled={isPending}>
          <KeyRound aria-hidden="true" />
          Configurar un nuevo factor
        </Button>
      </div>
    );
  }

  if (estado.paso === "cargando") {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        Generando tu código QR…
      </div>
    );
  }

  if (estado.paso === "error_inicio") {
    return (
      <div className="space-y-3 text-center">
        <p role="alert" className="text-sm text-destructive">
          {estado.mensaje}
        </p>
        <Button variant="outline" onClick={iniciar} disabled={isPending}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (estado.paso === "exito") {
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-center" role="status">
        <ShieldCheck className="size-9 text-success" aria-hidden="true" />
        <p className="font-medium">Segundo factor verificado</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Tu app authenticator ya está protegiendo el backstage de Rutax. Ya puedes operar con
          normalidad.
        </p>
        <Button className="mt-2" onClick={() => router.refresh()}>
          Continuar
        </Button>
      </div>
    );
  }

  // estado.paso === "verificar"
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3">
        {/* Data URI ya armado por el SDK de Supabase — ver nota de cabecera. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={estado.qrCodeSvg}
          alt="Código QR para agregar Rutax Admin a tu app authenticator"
          className="size-40 rounded-lg border bg-white p-2"
        />
        <div className="w-full space-y-1.5 text-center">
          <p className="text-xs text-muted-foreground">¿No puedes escanear? Ingresa este código manualmente:</p>
          <button
            type="button"
            onClick={() => copiarSecreto(estado.secret)}
            className="mx-auto flex items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-3 py-1.5 font-mono text-xs tracking-wider hover:bg-muted"
          >
            {estado.secret}
            {copiado ? (
              <Check className="size-3.5 text-success" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="sr-only">{copiado ? "Copiado" : "Copiar código"}</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={idCodigo}>Código de 6 dígitos</Label>
          <Input
            ref={inputCodigoRef}
            id={idCodigo}
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoFocus
            disabled={isPending}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="text-center font-mono text-lg tracking-[0.5em]"
            aria-describedby={errorCodigo ? `${idCodigo}-error` : undefined}
            aria-invalid={errorCodigo ? true : undefined}
            placeholder="000000"
          />
          <p className="text-xs text-muted-foreground">
            Genera el código en la app donde acabas de escanear el QR (o donde ingresaste el
            código manualmente).
          </p>
        </div>

        {errorCodigo && (
          <p id={`${idCodigo}-error`} role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            {errorCodigo}
          </p>
        )}

        <Button type="submit" className="w-full" loading={isPending} disabled={codigo.length !== 6}>
          Verificar y activar
        </Button>
      </form>
    </div>
  );
}
