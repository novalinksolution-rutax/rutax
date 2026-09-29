import type { ReactNode } from "react";
import { MarcaRutax } from "@/components/ui/marca-rutax";
import { cn } from "@/lib/utils";

/**
 * Marco común de la puesta en marcha (§3.3): sin AppShell, logo, "Cerrar
 * sesión" y la barra de cuatro segmentos. El contenido es de 480 px; el paso 4
 * declara 960.
 */
export function MarcoPuestaEnMarcha({
  paso,
  ancho = "estrecho",
  accionSalir,
  children,
}: {
  /** 1–4 pasos de trabajo; 5 = cierre (barra llena). */
  paso: 1 | 2 | 3 | 4 | 5;
  ancho?: "estrecho" | "ancho";
  accionSalir: () => Promise<void>;
  children: ReactNode;
}) {
  const actual = Math.min(paso, 4);
  return (
    <div className="flex min-h-svh flex-col bg-bg text-fg">
      <header className="mx-auto w-full max-w-[960px] px-6 pt-6">
        <div className="flex items-center justify-between">
          <MarcaRutax version="reducida" />
          <form action={accionSalir}>
            <button
              type="submit"
              className="text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline pointer-coarse:py-3"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={4}
          aria-valuenow={actual}
          aria-valuetext={`Paso ${actual} de 4`}
          className="mt-5 flex gap-1"
        >
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className="h-0.5 flex-1 bg-line" aria-hidden="true">
              <span
                className={cn(
                  "block h-full origin-left bg-primary motion-safe:transition-transform motion-safe:duration-(--motion-slow) motion-safe:ease-out",
                  n <= actual ? "scale-x-100" : "scale-x-0",
                )}
              />
            </span>
          ))}
        </div>
      </header>

      <main
        className={cn(
          "mx-auto flex w-full flex-1 flex-col px-6 pt-10 pb-28",
          ancho === "ancho" ? "max-w-[960px]" : "max-w-[480px]",
          "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-(--motion-base)",
        )}
      >
        {children}
      </main>
    </div>
  );
}
