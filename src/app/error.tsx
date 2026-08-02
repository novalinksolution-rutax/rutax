"use client";

/**
 * Error boundary de la app (App Router).
 * =====================================================================
 * Atrapa las excepciones no manejadas de cualquier segmento hijo del layout
 * raíz (área del courier, portal del seller, conductor, admin) y muestra una
 * recuperación amable en vez de la página cruda de error de Next.
 *
 * Reporte: los errores de render en SERVIDOR ya los captura
 * `instrumentation.ts` (onRequestError). Aquí reportamos además los de CLIENTE
 * (hidratación, interacción) al endpoint interno, fire-and-forget.
 */

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorApp({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      void fetch("/api/observabilidad/cliente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mensaje: error.message,
          stack: error.stack,
          digest: error.digest,
          ruta: typeof window !== "undefined" ? window.location.pathname : undefined,
        }),
        keepalive: true,
      });
    } catch {
      // El reporte nunca puede romper la recuperación.
    }
  }, [error]);

  return (
    <div className="flex min-h-[60svh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-xs">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-destructive-subtle">
          <AlertTriangle
            className="size-5 text-destructive-subtle-foreground"
            aria-hidden="true"
          />
        </div>
        <h1 className="mt-4 font-heading text-lg font-bold">Algo salió mal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tuvimos un problema al mostrar esta pantalla. Ya quedó registrado.
          Puedes reintentar; si vuelve a ocurrir, recarga la página.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-muted-foreground/70">
            Código: {error.digest}
          </p>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button onClick={reset}>Reintentar</Button>
          <Button
            variant="outline"
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
          >
            Recargar
          </Button>
        </div>
      </div>
    </div>
  );
}
