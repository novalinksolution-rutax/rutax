"use client";

/**
 * «Crear pedido same-day» — el gesto más repetido del día, sin salir de la lista.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * TRES VERSIONES DE ESTA PANTALLA, Y POR QUÉ ÉSTA NO REPITE EL ERROR DE LA PRIMERA
 * -----------------------------------------------------------------------------
 * 1. Era un **modal de 512 px** con 369 líneas dentro.
 * 2. Se sacó a una **página propia** (`/operaciones/nuevo`), porque B1c decía
 *    «peldaño 1: no lleva modal» — un formulario largo necesita espacio, un
 *    enlace que se pueda compartir y el botón atrás del teléfono.
 * 3. Ahora es un **panel de acción**, por decisión del usuario (25-08): no vale
 *    la pena salir de la lista para crear un pedido.
 *
 * ⚠️ **Y la objeción de la versión 2 sigue siendo cierta, así que se responde en
 * vez de ignorarse:**
 *
 * · **El panel va `amplio` (620 px), no en los 430 del resto.** Un panel de 430
 *   sería más angosto que el modal de 512 que se rechazó — repetiría el error
 *   con otro nombre. Con 620 los campos vuelven a caber en pares.
 * · **`/operaciones/nuevo` NO se retira.** Sigue siendo una URL que se comparte
 *   y que el botón atrás del teléfono respeta. El panel es el camino rápido, no
 *   el único.
 * · **Bajo 768 px el panel es una hoja inferior a pantalla completa**, que es
 *   exactamente lo que la página daba en el teléfono.
 *
 * -----------------------------------------------------------------------------
 * EL FORMULARIO ES EL MISMO ARCHIVO
 * -----------------------------------------------------------------------------
 * `FormularioAltaSameDay` no se duplica: lo monta la página y lo monta este
 * panel. Dos copias del formulario que crea pedidos es la forma más cara de que
 * una validación exista en un sitio y no en el otro.
 */

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PanelAccion } from "@/components/ui/panel-accion";
import { FormularioAltaSameDay } from "./nuevo/formulario";

export function FormularioPedidoSameDay({
  sellers,
  variante = "encabezado",
}: {
  sellers: { id: string; nombre: string }[];
  /** Ya no se usa: la acción lo toma de la sesión. Se conserva por el llamador. */
  tenantId?: string;
  /**
   * Dónde vive el disparador, que es lo único que cambia entre los dos sitios.
   *
   * - `encabezado` — compite por ancho con el título, el indicador en vivo y
   *   «Ver incidencias», así que el rótulo se acorta por tramos.
   * - `vacio` — es el ÚNICO elemento de la pantalla. Acortarlo ahí no ahorra
   *   nada y deja al courier con un botón que dice «Crear» sin decir qué.
   */
  variante?: "encabezado" | "vacio";
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <PanelAccion
      abierto={abierto}
      onOpenChange={setAbierto}
      ancho="amplio"
      titulo="Crear pedido same-day"
      subtitulo="Entra a la operación de hoy y genera su etiqueta."
      disparador={
        <Button className="shrink-0">
          <Plus className="size-4 shrink-0" aria-hidden="true" />
          {/* ⚠️ **La etiqueta se acorta por ancho; NO se deja desbordar.**
              «Crear pedido same-day» son 21 caracteres y en un encabezado con
              título, indicador en vivo y un segundo botón rompía la fila
              entera: empujaba el ancho por encima del contenedor y la pantalla
              aparecía con desplazamiento horizontal.

              Se resuelve acortando el rótulo, no encogiendo la letra ni
              cortando con puntos suspensivos. El nombre accesible se conserva
              entero para quien no ve el botón. */}
          {variante === "vacio" ? (
            "Crear pedido same-day"
          ) : (
            <>
              <span className="hidden xl:inline">Crear pedido same-day</span>
              <span className="hidden sm:inline xl:hidden">Crear</span>
              <span className="sr-only sm:hidden">Crear pedido same-day</span>
            </>
          )}
        </Button>
      }
    >
      <FormularioAltaSameDay
        sellers={sellers}
        // Al terminar, el panel se cierra solo: la lista de atrás ya se
        // recargó y el pedido nuevo está ahí. Quedarse con el formulario
        // abierto sobre una lista que ya cambió es lo que hace dudar de si se
        // creó.
        onListo={() => setAbierto(false)}
      />
    </PanelAccion>
  );
}
