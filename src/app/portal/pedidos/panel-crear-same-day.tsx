"use client";

/**
 * «Crear pedido same-day» del seller, en el panel — sin salir de sus pedidos.
 * =============================================================================
 * Es el mismo patrón que ya usa el courier en su listado
 * (`(tenant)/operaciones/formulario-same-day.tsx`): el formulario vive en un
 * panel de acción, no en otra pantalla.
 *
 * 🔴 **El botón llevaba a `/portal/pedidos/nuevo`.** Crear un envío es el gesto
 * más repetido del seller, y cargarle una pantalla entera —perdiendo de vista
 * la lista que estaba mirando— por algo que hace cinco veces al día es la
 * fricción más cara del portal.
 *
 * ⚠️ **`amplio` (620 px), no los 430 del resto.** Un panel de 430 sería más
 * angosto que el modal de 512 que este formulario ya tuvo y que se rechazó por
 * estrecho: repetiría el error con otro nombre. Con 620 los campos vuelven a
 * caber en pares.
 *
 * ⚠️ **`/portal/pedidos/nuevo` NO se retira.** Sigue siendo una URL que se
 * comparte y que el botón atrás del teléfono respeta; el panel es el camino
 * rápido, no el único. Y bajo 768 px el panel ya es una hoja a pantalla
 * completa, que es exactamente lo que la página daba en el teléfono.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PanelAccion } from "@/components/ui/panel-accion";
import { FormularioAltaSameDay } from "@/components/operacion/formulario-alta-same-day";
import type { EstadoSellerParaAlta } from "@/app/(tenant)/operaciones/nuevo/actions";
import { accionCrearSameDaySeller } from "./nuevo/accion-alta";

export function PanelCrearSameDay({
  estadoSeller,
  /** Para el botón del inicio, que no es el del listado. */
  variante = "listado",
}: {
  estadoSeller: EstadoSellerParaAlta;
  variante?: "listado" | "inicio";
}) {
  const [abierto, setAbierto] = useState(false);
  const router = useRouter();

  return (
    <PanelAccion
      abierto={abierto}
      onOpenChange={setAbierto}
      ancho="amplio"
      titulo="Crear pedido same-day"
      subtitulo="Queda pendiente de asignación hasta que tu courier le asigne un conductor."
      disparador={
        variante === "inicio" ? (
          <Button className="w-full sm:w-auto">
            <Plus className="size-4 shrink-0" aria-hidden="true" />
            Crear un pedido same-day
          </Button>
        ) : (
          <Button className="shrink-0">
            <Plus className="size-4 shrink-0" aria-hidden="true" />
            {/* Se acorta por ancho en vez de desbordar la fila del encabezado.
                El nombre accesible se conserva entero. */}
            <span className="hidden sm:inline">Crear pedido same-day</span>
            <span className="sr-only sm:hidden">Crear pedido same-day</span>
          </Button>
        )
      }
    >
      <FormularioAltaSameDay
        estadoSellerInicial={estadoSeller}
        accionCrear={accionCrearSameDaySeller}
        onListo={() => {
          setAbierto(false);
          // La lista de atrás tiene que traer el pedido nuevo: sin esto el
          // panel se cierra sobre una lista que no cambió y no queda claro si
          // se creó.
          router.refresh();
        }}
      />
    </PanelAccion>
  );
}
