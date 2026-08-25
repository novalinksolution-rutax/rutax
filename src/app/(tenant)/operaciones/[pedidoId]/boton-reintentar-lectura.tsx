"use client";

/**
 * «Volver a intentar» — vuelve a pedir la pantalla al servidor.
 * =============================================================================
 * Tablero `P3`, estado de falla de lectura.
 *
 * ⚠️ Es `router.refresh()` y no un enlace a la misma URL. Un `<Link>` al mismo
 * sitio no hace nada: Next lo resuelve contra su caché de router y la pantalla
 * se repinta con exactamente los mismos datos que fallaron. `refresh()` invalida
 * esa caché y vuelve a ejecutar el componente de servidor, que es lo único que
 * puede cambiar el resultado.
 *
 * El `useTransition` no es adorno: sin él el botón no tiene forma de decir que
 * está trabajando, y una lectura que falló probablemente vuelva a tardar.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";

export function BotonReintentarLectura() {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  return (
    <button
      type="button"
      disabled={pendiente}
      onClick={() => iniciar(() => router.refresh())}
      className="mt-2 inline-flex cursor-pointer items-center gap-1.5 border border-attention-line px-2.5 py-1 text-xs font-medium text-attention-fg transition-colors hover:bg-attention-fg/10 disabled:cursor-default disabled:opacity-70"
    >
      <RotateCw
        className={`size-3.5 ${pendiente ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      {pendiente ? "Cargando…" : "Volver a intentar"}
    </button>
  );
}
