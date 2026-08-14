/**
 * "Asignación" — el hueco de la Etapa 6 (§12). Hoy es solo un enlace de
 * salida: la Etapa 5 no escribe nada. El enlace es genérico a `/manifiestos`
 * y no un enlace profundo por comuna, a propósito — ver §12 del documento: el
 * flujo de creación de manifiesto hoy es conductor-primero, sin campo de
 * comuna, así que no hay un manifiesto "de la comuna X" al que enlazar.
 *
 * El lugar de este bloque (columna derecha en escritorio, al final en móvil,
 * justo después de "Carga por comuna") queda fijo para cuando la Etapa 6
 * traiga la selección múltiple: se reemplaza el contenido, no la jerarquía.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function BloqueAsignacion() {
  return (
    <section
      aria-labelledby="asignacion-heading"
      className="space-y-2 rounded-lg border border-dashed border-border p-4"
    >
      <h2 id="asignacion-heading" className="text-sm font-semibold text-muted-foreground">
        Asignación
      </h2>
      <p className="text-sm text-muted-foreground">
        Cuando tengas suficiente carga en una zona, arma la asignación desde Manifiestos.
      </p>
      <Button asChild size="sm" variant="outline">
        <Link href="/manifiestos">Ir a manifiestos</Link>
      </Button>
    </section>
  );
}
