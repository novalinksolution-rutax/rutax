"use client";

/**
 * Lanzador de la herramienta de QA — vive en la barra lateral (Configuración) y
 * abre un popup con la ventana rápida de pedidos same-day de prueba.
 * =============================================================================
 * Es TEMPORAL: crea pedidos de relleno y limpia los activos. Por eso va como un
 * botón suelto al pie de las opciones de configuración y no como una pantalla.
 *
 * Las opciones (sellers, comunas, cuántos activos hay) se cargan al ABRIR el
 * modal, no en cada carga de página: así el layout no paga esa consulta en todo
 * el backoffice.
 */

import { useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PanelPedidosPrueba } from "./panel-pedidos-prueba";
import { actionOpcionesPrueba, type OpcionesPrueba } from "../acciones-prueba";

export function LanzadorHerramientaPrueba() {
  const [abierto, setAbierto] = useState(false);
  const [opciones, setOpciones] = useState<OpcionesPrueba | null>(null);
  const [cargando, setCargando] = useState(false);

  async function alAbrir(a: boolean) {
    setAbierto(a);
    if (a && !opciones && !cargando) {
      setCargando(true);
      const r = await actionOpcionesPrueba();
      setOpciones(r);
      setCargando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={alAbrir}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="mt-1 flex w-full cursor-pointer items-center gap-2.5 border-l-2 border-transparent px-2.5 py-[9px] text-left text-[13px] font-normal text-fg-muted transition-colors hover:bg-foreground/5 hover:text-fg"
        >
          <FlaskConical className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Herramienta de prueba</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Herramienta de prueba · Pedidos same-day</DialogTitle>
        </DialogHeader>

        {cargando || !opciones ? (
          <div className="flex items-center gap-2 py-6 text-sm text-fg-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Cargando…
          </div>
        ) : (
          <PanelPedidosPrueba
            sellers={opciones.sellers}
            comunas={opciones.comunas}
            sameDayActivos={opciones.sameDayActivos}
            sinMarco
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
