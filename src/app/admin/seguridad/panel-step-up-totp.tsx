"use client";

/**
 * Step-up de MFA — verifica el factor TOTP YA enrolado en una sesión que
 * todavía está en AAL1 (login nuevo en un dispositivo/navegador donde el
 * super-admin ya había configurado su segundo factor antes).
 *
 * `desafiarTotp(factorId, code)` (`../acciones-mfa.ts`) necesita el `factorId`
 * del factor verificado, pero ni `ActorSuperAdmin` ni el resto del gate lo
 * exponen (con AAL1 alcanza para resolver identidad+gobernanza+AAL, no hace
 * falta enumerar factores ahí). Este componente lo resuelve 100% en el
 * navegador con `supabase.auth.mfa.listFactors()` — es una lectura de la
 * propia sesión del usuario vía el SDK de Auth (no toca `plataforma.*`, no
 * necesita `service_role`), consistente con "esto es UX, la verdad vive en el
 * servidor": el `challengeAndVerify` real que actualiza la sesión sigue
 * corriendo server-side dentro de `desafiarTotp`.
 */

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { desafiarTotp } from "../acciones-mfa";

type EstadoFactor = { estado: "buscando" } | { estado: "listo"; factorId: string } | { estado: "no_encontrado" };

export function PanelStepUpTotp() {
  const router = useRouter();
  const [factor, setFactor] = useState<EstadoFactor>({ estado: "buscando" });
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const idCodigo = useId();

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const { data, error: errorSupabase } = await supabase.auth.mfa.listFactors();
      if (cancelado) return;
      const factorVerificado = data?.totp?.[0];
      if (errorSupabase || !factorVerificado) {
        setFactor({ estado: "no_encontrado" });
        return;
      }
      setFactor({ estado: "listo", factorId: factorVerificado.id });
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    if (factor.estado === "listo") {
      inputRef.current?.focus();
    }
  }, [factor.estado]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (factor.estado !== "listo") return;
    setError(null);
    const { factorId } = factor;
    startTransition(async () => {
      const resultado = await desafiarTotp(factorId, codigo);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        setCodigo("");
        inputRef.current?.focus();
        return;
      }
      // Sesión ya en AAL2 (cookie httpOnly actualizada por la Server Action):
      // refresca para que `layout.tsx` renderice el backstage normal.
      router.refresh();
    });
  }

  if (factor.estado === "buscando") {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        Verificando tu segundo factor…
      </div>
    );
  }

  // Sin botón propio de "Cerrar sesión": `layout.tsx` ya renderiza uno fijo
  // debajo de este panel en TODOS los estados, así que ponerlo aquí mostraba
  // dos salidas apiladas. El texto apunta a esa única salida.
  if (factor.estado === "no_encontrado") {
    return (
      <p role="alert" className="flex items-center justify-center gap-1.5 text-center text-sm text-destructive">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
        No pudimos encontrar tu segundo factor. Cierra sesión y vuelve a entrar.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={idCodigo}>Código de tu app authenticator</Label>
        <Input
          ref={inputRef}
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
          aria-describedby={error ? `${idCodigo}-error` : undefined}
          aria-invalid={error ? true : undefined}
          placeholder="000000"
        />
      </div>

      {error && (
        <p id={`${idCodigo}-error`} role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" loading={isPending} disabled={codigo.length !== 6}>
        Verificar
      </Button>
    </form>
  );
}
