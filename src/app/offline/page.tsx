import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = {
  title: "Sin conexión",
};

/**
 * Página de cortesía que el service worker sirve cuando una navegación falla por
 * falta de conexión (T-4). Estática y sin datos — segura de cachear.
 */
export default function PaginaOffline() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <WifiOff className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="font-heading text-lg font-semibold text-foreground">Sin conexión</h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          No pudimos cargar esta pantalla. Revisa tu conexión a internet; tu ruta vuelve a
          aparecer apenas se restablezca.
        </p>
      </div>
    </div>
  );
}
