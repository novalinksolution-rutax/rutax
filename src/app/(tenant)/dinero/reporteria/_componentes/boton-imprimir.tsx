"use client";

import { Button } from "@/components/ui/button";

/**
 * El botón de imprimir. Es lo ÚNICO que necesita cliente en estos documentos.
 *
 * Se aísla en su propio módulo a propósito: si viviera en la página, la
 * directiva `"use client"` convertiría toda la hoja en un componente de cliente
 * y las lecturas de base tendrían que salir de ahí. La hoja es un documento
 * estático; lo único interactivo es este botón.
 *
 * `print:hidden` lo saca del papel: un botón impreso es tinta que no dice nada.
 */
export function BotonImprimir({ etiqueta = "Imprimir" }: { etiqueta?: string }) {
  return (
    <Button variant="outline" onClick={() => window.print()} className="print:hidden">
      {etiqueta}
    </Button>
  );
}
