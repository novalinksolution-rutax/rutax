/**
 * El aviso persistente de configuración pendiente.
 * =============================================================================
 *
 * Vive en la barra superior del área autenticada mientras el courier no pueda
 * operar, con un clic directo al asistente. Solo se muestra a quien puede
 * actuar sobre esos pasos (dueño/administración): mostrarlo a un supervisor,
 * que no puede resolverlo, sería informar sin poder actuar.
 *
 * -----------------------------------------------------------------------------
 * NOMBRA EL PASO, NO CUENTA PASOS
 * -----------------------------------------------------------------------------
 * Decía «tu cuenta tiene 2 pasos pendientes para activarse del todo». Ese conteo
 * salía de `totalPasos: 2` mientras la pantalla de destino mostraba cinco, así
 * que además de no ser accionable, no cuadraba con lo que uno encontraba al
 * llegar.
 *
 * Ahora dice qué falta: «te falta configurar la facturación para poder operar».
 * Se puede leer de paso, sin entrar, y es la misma regla que pide la pantalla de
 * cierre para cuando un paso se rompe después — el aviso vuelve **nombrando ese
 * paso**, no el asistente completo.
 */

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** Qué falta para operar, ya nombrado: «facturación», «tarifas». */
  faltaParaOperar: string | null;
}

export function BannerOnboarding({ faltaParaOperar }: Props) {
  if (!faltaParaOperar) return null;

  return (
    <div className="border-b border-attention-line bg-attention-bg">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-attention-fg">
          <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>
            Te falta configurar <strong className="font-medium">{faltaParaOperar}</strong> para
            poder operar.
          </span>
        </div>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="w-fit border-attention-line bg-transparent text-attention-fg hover:bg-attention-bg"
        >
          <Link href="/onboarding">Ir a la puesta en marcha</Link>
        </Button>
      </div>
    </div>
  );
}
