"use client";

/**
 * Error boundary global (App Router).
 * =====================================================================
 * Solo se activa cuando falla el propio layout RAÍZ — un caso catastrófico que
 * `error.tsx` no puede atrapar. Reemplaza todo el documento, así que renderiza
 * su propio <html>/<body> y usa estilos inline (no depende de que el CSS de la
 * app haya cargado). Reporta a la observabilidad central, fire-and-forget.
 */

import { useEffect } from "react";

export default function GlobalError({
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
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "28rem",
            textAlign: "center",
            border: "1px solid #e2e8f0",
            borderRadius: "0.75rem",
            background: "#ffffff",
            padding: "1.5rem",
          }}
        >
          <h1 style={{ fontSize: "1.125rem", fontWeight: 700, margin: "0 0 0.25rem" }}>
            No se pudo cargar la aplicación
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
            Ocurrió un problema inesperado. Ya quedó registrado. Reintenta o
            recarga la página.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "#94a3b8",
                marginTop: "0.75rem",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              Código: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#0f172a",
              color: "#ffffff",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
