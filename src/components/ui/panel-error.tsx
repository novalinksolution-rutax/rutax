"use client";

/**
 * El panel de una pantalla que falló.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 POR QUÉ ESTO EXISTE: UN `error.tsx` EN LA RAÍZ SE LLEVA LA NAVEGACIÓN
 * -----------------------------------------------------------------------------
 * Había un solo boundary, en `src/app/error.tsx`. En el App Router un
 * `error.tsx` **reemplaza a todo lo que está por debajo de su propio layout**,
 * así que uno en la raíz sustituye el árbol entero: se lleva el `AppShell`, el
 * sidebar, el centro de avisos y la barra inferior del teléfono.
 *
 * El resultado es que **una falla en una pantalla deja al usuario sin ninguna
 * forma de ir a otra**, justo en el momento en que más lo necesita: lo único que
 * le queda es «Reintentar» sobre la pantalla que acaba de fallar, o escribir una
 * URL a mano. En una consola de operación a las 16:00, eso convierte el error de
 * una pantalla en la caída de la aplicación entera.
 *
 * Con un boundary **por área** —`(tenant)`, `portal`, `admin`, `conductor`— el
 * error queda contenido en el contenido de la pantalla y el marco sobrevive: el
 * coordinador sigue teniendo su sidebar y se va a Manifiestos con un clic.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL BOUNDARY NO ATRAPA A SU PROPIO LAYOUT
 * -----------------------------------------------------------------------------
 * `(tenant)/error.tsx` cubre las páginas **dentro** de `(tenant)/layout.tsx`,
 * no al layout mismo. Si el que revienta es el layout —la sesión, el `AppShell`—
 * el error sube hasta la raíz, y ahí el de raíz es lo correcto: sin layout no
 * hay marco que preservar. Por eso el de la raíz **se conserva**, no se retira.
 *
 * -----------------------------------------------------------------------------
 * QUÉ DICE EL PANEL, Y QUÉ NO
 * -----------------------------------------------------------------------------
 * No dice «Algo salió mal» y se acaba. Un mensaje de error tiene que contestar
 * tres cosas, y la segunda es la que casi siempre falta:
 *
 * 1. **qué pasó** — no pudimos mostrar esta pantalla;
 * 2. **qué NO pasó** — el trabajo que ya estaba hecho sigue ahí, y el resto de
 *    la aplicación funciona. Sin esto, quien acaba de asignar treinta pedidos no
 *    tiene forma de saber si los perdió;
 * 3. **qué hacer ahora** — reintentar, o irse a otra parte por el marco que
 *    sigue en pantalla.
 *
 * El `digest` se muestra cuando existe porque es lo único que conecta lo que vio
 * el usuario con lo que quedó en el registro del servidor.
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface SalidaError {
  href: string;
  texto: string;
}

export function PanelError({
  error,
  reset,
  titulo = "No pudimos mostrar esta pantalla",
  cuerpo,
  salida,
  compacto = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  titulo?: string;
  /** Qué NO pasó y qué hacer ahora, en el lenguaje de quien está mirando. */
  cuerpo: string;
  /** A dónde puede irse. `undefined` cuando no hay marco que lo lleve. */
  salida?: SalidaError;
  /** Para la app del conductor, donde el panel ocupa la pantalla entera. */
  compacto?: boolean;
}) {
  useEffect(() => {
    // ⚠️ Los errores de render en SERVIDOR ya los captura `instrumentation.ts`
    // (`onRequestError`). Acá se reportan los de CLIENTE —hidratación,
    // interacción—, que no pasan por ahí. Fire-and-forget con `keepalive`: si el
    // usuario se va de la pantalla, el reporte sale igual.
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
      // El reporte NUNCA puede romper la recuperación: si falla el fetch, el
      // usuario se queda igual sin pantalla y además sin panel.
    }
  }, [error]);

  return (
    <div
      role="alert"
      className={compacto ? "px-4 py-8" : "flex min-h-[60svh] items-center justify-center px-4"}
    >
      {/* Sin sombra (regla 4): la elevación es escalón de fondo + borde. */}
      <div className="w-full max-w-md rounded-ctrl border border-fault-line bg-fault-bg p-6 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full border border-fault-line">
          <AlertTriangle className="size-5 text-fault-fg" aria-hidden="true" />
        </div>

        <h1 className="mt-4 font-heading text-lg font-bold text-fg">{titulo}</h1>
        <p className="mt-1 text-sm text-fg-muted">{cuerpo}</p>

        {error.digest && (
          <p className="rx-num mt-3 font-mono text-xs text-fg-subtle">
            {/* Es lo único que ata lo que vio el usuario con lo que quedó en el
                registro del servidor. Sin esto, «me salió un error» no se puede
                buscar. */}
            Código: {error.digest}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>Reintentar</Button>
          {salida && (
            <Button asChild variant="outline">
              <Link href={salida.href}>{salida.texto}</Link>
            </Button>
          )}
          <Button
            variant="ghost"
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
