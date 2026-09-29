"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Pie fijo del paso: Volver (solo ícono, desde el paso 2) y el botón principal.
 * Barra fija abajo con safe-area; en escritorio el botón queda a la derecha.
 */
export function PieDePaso({
  volverAPaso,
  etiqueta,
  cargando,
  deshabilitado,
  onClick,
  formId,
}: {
  volverAPaso?: number;
  etiqueta: string;
  cargando?: boolean;
  deshabilitado?: boolean;
  onClick?: () => void;
  formId?: string;
}) {
  const router = useRouter();
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-[960px] items-center gap-3 px-6 py-3">
        {volverAPaso ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Volver"
            className="pointer-coarse:size-12"
            onClick={() => router.push(`/puesta-en-marcha?paso=${volverAPaso}`)}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          type={formId ? "submit" : "button"}
          form={formId}
          loading={cargando}
          disabled={deshabilitado}
          onClick={onClick}
          className="h-10 flex-1 sm:ml-auto sm:flex-none sm:px-6 pointer-coarse:h-12"
        >
          {etiqueta}
        </Button>
      </div>
    </div>
  );
}
