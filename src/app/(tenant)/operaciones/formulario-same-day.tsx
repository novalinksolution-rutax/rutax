/**
 * El botón «Crear pedido same-day» del listado de pedidos.
 *
 * -----------------------------------------------------------------------------
 * ESTO ERA UN MODAL DE 369 LÍNEAS, Y AHORA ES UN ENLACE
 * -----------------------------------------------------------------------------
 * El tablero B1c abre la ficha de esta pantalla con una frase que es la decisión
 * entera: **«Peldaño 1: no lleva modal.»** Crear un pedido es el gesto más
 * repetido del día en la bodega, y meterlo en una caja de 512 px con el listado
 * detrás le quita todo lo que un formulario largo necesita —espacio, un enlace
 * que se pueda compartir, el botón atrás del teléfono— a cambio de no perder de
 * vista una tabla que igual se va a recargar al terminar.
 *
 * El formulario vive ahora en `/operaciones/nuevo`, con sus cuatro grupos, sus
 * avisos en línea y su pantalla de éxito.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ CONSERVA EL NOMBRE Y LAS PROPS QUE YA NO USA
 * -----------------------------------------------------------------------------
 * `operaciones/page.tsx` lo monta como `<FormularioPedidoSameDay sellers={…}
 * tenantId={…} />` y **ese archivo tiene trabajo en curso: no se toca**. Al
 * conservar la firma, la pantalla que lo hospeda no se entera del cambio.
 *
 * Es el mismo patrón de convivencia del resto del rediseño —se construye lo
 * nuevo y lo viejo delega—, con el motivo extra de no pisarle el trabajo a
 * nadie. Cuando ese archivo se libere, esto se reduce a un `<Button asChild>`
 * en su encabezado y este componente desaparece.
 */

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FormularioPedidoSameDay(_props: {
  /** Ya no se usa: la pantalla nueva carga sus propios sellers en el servidor. */
  sellers?: unknown;
  /** Ya no se usa: la pantalla nueva lo toma de la sesión. */
  tenantId?: string;
}) {
  return (
    <Button asChild className="shrink-0">
      <Link href="/operaciones/nuevo">
        <Plus className="size-4 shrink-0" aria-hidden="true" />
        {/* ⚠️ **La etiqueta se acorta por ancho; NO se deja desbordar.**
            «Crear pedido same-day» son 21 caracteres y en un encabezado con
            título, indicador en vivo y un segundo botón **rompía la fila
            entera**: empujaba el ancho por encima del contenedor y la pantalla
            aparecía con desplazamiento horizontal.

            Se resuelve acortando el rótulo, no encogiendo la letra ni cortando
            con puntos suspensivos: «Crear» dice lo mismo cuando el botón está
            en una pantalla donde ya se sabe que se está en Pedidos. El nombre
            accesible se conserva entero para quien no ve el botón. */}
        <span className="hidden xl:inline">Crear pedido same-day</span>
        <span className="hidden sm:inline xl:hidden">Crear</span>
        {/* En 390 px es **solo el signo**: el tablero dibuja el encabezado del
            teléfono en una sola fila —`☰ Pedidos`— y cualquier rótulo la parte
            en dos. El nombre accesible se conserva entero, así que para un
            lector de pantalla el botón sigue diciendo lo mismo en los tres
            anchos. */}
        <span className="sr-only sm:hidden">Crear pedido same-day</span>
        <span className="sr-only hidden sm:inline xl:hidden">pedido same-day</span>
      </Link>
    </Button>
  );
}
