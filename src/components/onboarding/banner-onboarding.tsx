/**
 * Banner persistente de "onboarding incompleto" (§1.3 del documento UX).
 *
 * Vive en la barra superior del área autenticada — visible en cualquier
 * pantalla mientras el onboarding no esté completo, con un clic directo al
 * panel (Pantalla D). Desaparece solo cuando DTE está `activo` y existe al
 * menos una tarifa vigente (mismo criterio de "completo" que `estado.ts`).
 *
 * Solo se muestra a quien puede actuar sobre esos pasos (dueño/administración)
 * — mostrarlo a un supervisor/coordinador, que no puede resolverlo, sería
 * "informar sin poder actuar": ruido, no ayuda.
 */

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  pasosCompletados: number;
  totalPasos: number;
}

export function BannerOnboarding({ pasosCompletados, totalPasos }: Props) {
  const pendientes = totalPasos - pasosCompletados;
  if (pendientes <= 0) return null;

  return (
    <div className="border-b border-warning-subtle bg-warning-subtle/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-warning-subtle-foreground">
          <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>
            Tu cuenta tiene {pendientes === 1 ? "1 paso pendiente" : `${pendientes} pasos pendientes`} para activarse
            del todo.
          </span>
        </div>
        <Button asChild size="sm" variant="outline" className="w-fit border-warning bg-transparent text-warning-subtle-foreground hover:bg-warning-subtle">
          <Link href="/onboarding">Completar configuración</Link>
        </Button>
      </div>
    </div>
  );
}
