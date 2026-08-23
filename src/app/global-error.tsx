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

/**
 * ⚠️ ESTA PANTALLA NO VE NINGÚN TOKEN, Y NO PUEDE VERLOS.
 *
 * `global-error.tsx` reemplaza el `<html>` y el `<body>` del layout raíz — es
 * lo que se muestra cuando el propio layout reventó—, así que **no hay hoja de
 * estilos cargada**: ni `globals.css`, ni el puente, ni las variables. Todo va
 * en línea y con valores literales, como en el mapa, los PDF y los correos.
 *
 * Los que había eran del ADN anterior (`#f8fafc`, `#0f172a`, `#e2e8f0`,
 * `#64748b`, `#94a3b8`) y ese último daba **2,5:1 sobre blanco** justo en el
 * código de error, que es lo único que sirve para que soporte encuentre nada.
 *
 * Va en tema claro a propósito: no hay JavaScript de tema acá y adivinar el del
 * sistema operativo en la pantalla que aparece cuando todo falló es una
 * complicación de más.
 */
const C = {
  fondo: "#E6EEEF", // --rx-bg-sunken
  tarjeta: "#FFFFFF", // --rx-bg-raised
  texto: "#0B1114", // --rx-fg
  tenue: "#4C5F65", // --rx-fg-muted · 6,2:1
  linea: "#C6D6D8", // --rx-line
  acento: "#007D69", // --rx-accent-text
  sobreAcento: "#FFFFFF",
} as const;

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
          background: C.fondo,
          color: C.texto,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "28rem",
            textAlign: "center",
            border: `1px solid ${C.linea}`,
            // Radio 3 px (`--rx-radius-ctrl`), no 12: el sistema no redondea así.
            borderRadius: "3px",
            background: C.tarjeta,
            padding: "1.5rem",
          }}
        >
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 0.25rem" }}>
            No se pudo cargar la aplicación
          </h1>
          <p style={{ fontSize: "0.875rem", color: C.tenue, margin: 0, lineHeight: 1.55 }}>
            Ocurrió un problema inesperado. Ya quedó registrado. Reintenta o
            recarga la página.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                // El código va en el gris del sistema, no en uno más claro:
                // es lo único que sirve para que soporte encuentre el error, y
                // estaba en #94a3b8 — 2,5:1 sobre blanco.
                color: C.tenue,
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
              borderRadius: "3px",
              border: "none",
              background: C.acento,
              color: C.sobreAcento,
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
