import { MarcaRutax } from "@/components/ui/marca-rutax";
import { Button } from "@/components/ui/button";

/**
 * Lo que ve quien entra a un courier cuya puesta en marcha no terminó y NO
 * puede terminarla: cualquier rol que no sea el dueño, o el dueño cuando el
 * estado no se pudo leer (fail-closed, sin redirigir: redirigir en bucle a un
 * courier que sí terminó sería peor que el bloqueo).
 *
 * Decisión sobre Q12 (docs/ux/puesta-en-marcha-v2.md): el nombre de la empresa,
 * una sola línea y la salida. Sin aviso al dueño (no hay canal que construir
 * acá) y sin explicar mecánica.
 */
export function PantallaEmpresaPendiente({
  nombreFantasia,
  motivo,
  accionSalir,
}: {
  nombreFantasia: string;
  motivo: "no_dueno" | "error";
  accionSalir: () => Promise<void>;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-start gap-8 bg-bg px-6 pt-16 pb-10">
      <MarcaRutax version="reducida" tamano="grande" />
      <div className="w-full max-w-[400px] space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-fg">{nombreFantasia}</h1>
        <p className="text-sm text-fg-muted" role={motivo === "error" ? "alert" : undefined}>
          {motivo === "error"
            ? "No pudimos cargar tu cuenta. Recarga la página."
            : "El dueño aún no termina de configurar la cuenta."}
        </p>
        <form action={accionSalir}>
          <Button type="submit" variant="outline" className="pointer-coarse:h-12">
            Cerrar sesión
          </Button>
        </form>
      </div>
    </main>
  );
}
