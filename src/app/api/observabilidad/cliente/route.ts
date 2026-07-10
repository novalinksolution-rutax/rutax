/**
 * Endpoint interno de reporte de errores de CLIENTE.
 * =====================================================================
 * Los error boundaries de cliente (`error.tsx` / `global-error.tsx`) publican
 * aquí las excepciones que ocurren en el navegador (hidratación, interacción),
 * que NO pasan por `instrumentation.ts` (ese solo cubre el render en servidor).
 * Se enrutan a la misma observabilidad central (`capturarExcepcion` → Sentry si
 * hay DSN, o log estructurado si no).
 *
 * Invariantes: nunca lanza y responde 204 siempre. No expone datos: el cuerpo
 * pasa por `redactarSensible` dentro de `capturarExcepcion`.
 */

import type { NextRequest } from "next/server";
import { capturarExcepcion } from "@/lib/observabilidad";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const cuerpo = (await req.json()) as {
      mensaje?: unknown;
      stack?: unknown;
      digest?: unknown;
      componentStack?: unknown;
      ruta?: unknown;
    };

    const mensaje =
      typeof cuerpo.mensaje === "string" && cuerpo.mensaje.trim()
        ? cuerpo.mensaje.slice(0, 1000)
        : "Error de cliente sin mensaje";

    // Reconstruye un Error real para que capturarExcepcion tome name/message/stack.
    const err = new Error(mensaje);
    if (typeof cuerpo.stack === "string") err.stack = cuerpo.stack.slice(0, 8000);

    await capturarExcepcion(err, {
      origen: "client",
      ...(typeof cuerpo.digest === "string" && cuerpo.digest
        ? { etiquetas: { digest: cuerpo.digest } }
        : {}),
      extra: {
        ruta: typeof cuerpo.ruta === "string" ? cuerpo.ruta : undefined,
        componentStack:
          typeof cuerpo.componentStack === "string"
            ? cuerpo.componentStack.slice(0, 8000)
            : undefined,
      },
    });
  } catch {
    // La observabilidad JAMÁS propaga su propio fallo.
  }
  return new Response(null, { status: 204 });
}
