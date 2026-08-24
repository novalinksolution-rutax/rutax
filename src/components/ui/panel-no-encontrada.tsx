import Link from "next/link";
import { FileQuestion } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * La forma común de «esta página no está».
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ HAY MÁS DE UNA 404, SI LA DE LA RAÍZ YA ESTABA BIEN
 * -----------------------------------------------------------------------------
 * La de la raíz está escrita con cuidado para **quien no tiene cuenta**: el
 * destinatario que abre un enlace de seguimiento que no calza. Por eso no dice
 * qué falló —una 404 no distingue un enlace mal copiado de uno vencido—, no
 * confirma ni niega que el envío exista (regla 45), y su salida no asume nada:
 * «Ir a Rutax» y «pídele el enlace a quien te lo mandó».
 *
 * Y esa misma pantalla **le salía al coordinador** que tecleó mal el id de un
 * manifiesto. A alguien que está dentro de la aplicación, con su sesión abierta
 * y el sidebar a la vista, se le decía «Ir a Rutax» y se le preguntaba si estaba
 * siguiendo un envío. Cierto para uno, absurdo para el otro.
 *
 * La vaguedad de la raíz **no es un defecto que corregir: es correcta ahí**,
 * porque ahí de verdad no se sabe quién mira. Dentro de un área sí se sabe, y
 * entonces callar deja de ser prudencia y pasa a ser desorientación.
 *
 * Así que la forma se comparte y **el texto lo pone cada área**.
 *
 * ⚠️ Sin ilustración, a propósito: sería una imagen de varios cientos de KB en
 * la pantalla que ve alguien con mala señal esperando un paquete.
 */
export function PanelNoEncontrada({
  titulo = "Esta página no está",
  cuerpo,
  salida,
  nota,
}: {
  titulo?: string;
  cuerpo: string;
  salida: { href: string; texto: string };
  /** Lo que solo aplica a un público. En la raíz, quien sigue un envío. */
  nota?: ReactNode;
}) {
  return (
    <div className="flex min-h-[70svh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md border border-line bg-card p-8 text-center">
        <div className="mx-auto flex size-11 items-center justify-center bg-bg-inset">
          <FileQuestion className="size-5 text-fg-muted" aria-hidden="true" />
        </div>

        <h1 className="mt-4 font-heading text-xl font-semibold text-fg">{titulo}</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{cuerpo}</p>

        <div className="mt-6 flex flex-col gap-3">
          <Button asChild className="w-full">
            <Link href={salida.href}>{salida.texto}</Link>
          </Button>
          {nota ? <p className="text-xs leading-relaxed text-fg-subtle">{nota}</p> : null}
        </div>
      </div>
    </div>
  );
}
