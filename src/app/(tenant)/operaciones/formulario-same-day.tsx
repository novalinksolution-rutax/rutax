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
    <Button asChild>
      <Link href="/operaciones/nuevo">
        <Plus className="size-4" aria-hidden="true" />
        Crear pedido same-day
      </Link>
    </Button>
  );
}
