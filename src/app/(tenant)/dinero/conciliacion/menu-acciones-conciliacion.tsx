"use client";

/**
 * Menú rápido de la fila (D-4, §1.1 P1) — SOLO transiciones de un clic que no
 * exigen nota (el resto vive en el Sheet de detalle, con su textarea
 * obligatoria). Las opciones se DERIVAN de `TRANSICIONES_VALIDAS` — nunca se
 * hardcodea "qué botón mostrar en qué estado" (esa fue la causa raíz de un
 * bug real ya corregido acá): lo único hardcodeado es un mapa de mejores
 * etiquetas para los destinos más comunes, con una traducción genérica como
 * respaldo para cualquier otro destino alcanzable sin nota.
 *
 * Un estado terminal (origen) SIEMPRE exige el motivo de la reapertura
 * (`transicionarEventoConciliacion`) — por eso este menú no ofrece nada para
 * esos casos; "Reabrir" vive exclusivamente en el Sheet.
 */

import { useState, useTransition } from "react";
import { MoreHorizontal, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { EstadoEventoConciliacion } from "@/modules/dinero/tipos";
import { TRANSICIONES_VALIDAS, esEstadoTerminal } from "@/modules/dinero/conciliacion-clasificacion";
import { traducirEstadoConciliacion } from "@/lib/ui/traduccion-estados";
import { accionTransicionarEvento } from "./actions";
import { DESTINOS_QUE_EXIGEN_COMENTARIO } from "./reglas-nota";

const ETIQUETA_TRANSICION_RAPIDA: Partial<Record<EstadoEventoConciliacion, string>> = {
  en_analisis: "Marcar en análisis",
  esperando_info: "Marcar esperando información",
};

interface Props {
  eventoId: string;
  estadoActual: EstadoEventoConciliacion;
  onMutated: () => void;
}

export function MenuAccionesConciliacion({ eventoId, estadoActual, onMutated }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Reapertura (origen terminal) siempre exige nota → ninguna acción rápida.
  const destinosRapidos = esEstadoTerminal(estadoActual)
    ? []
    : (TRANSICIONES_VALIDAS[estadoActual] ?? []).filter(
        (destino) => !DESTINOS_QUE_EXIGEN_COMENTARIO.has(destino),
      );

  if (destinosRapidos.length === 0) return null;

  function ejecutar(destino: EstadoEventoConciliacion) {
    startTransition(async () => {
      const resultado = await accionTransicionarEvento(eventoId, destino);
      if (resultado.ok) {
        setError(null);
        setAbierto(false);
        toast.success(`Excepción actualizada a "${traducirEstadoConciliacion(destino)}"`);
        onMutated();
      } else {
        // Regla 56: el fallo NO va en notificación temporal. El menú se queda
        // abierto con el error adentro — si se cerrara, el usuario vería la
        // fila con su estado viejo y un aviso que se va en cuatro segundos, y
        // esta transición es la que decide si un período se puede facturar.
        setError(resultado.mensaje);
      }
    });
  }

  return (
    <DropdownMenu
      open={abierto}
      onOpenChange={(v) => {
        setAbierto(v);
        if (!v) setError(null);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={isPending}
          aria-label="Acciones rápidas del evento"
          onClick={(e) => e.stopPropagation()}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <MoreHorizontal className="size-4" aria-hidden="true" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {error ? (
          <div
            role="alert"
            className="mb-1 max-w-64 border-b border-fault-line bg-fault-bg px-2 py-2 text-xs leading-relaxed text-fault-fg"
          >
            <strong>No se pudo cambiar el estado.</strong> {error} La excepción sigue como
            estaba.
          </div>
        ) : null}
        {destinosRapidos.map((destino) => (
          <DropdownMenuItem key={destino} disabled={isPending} onSelect={() => ejecutar(destino)}>
            {ETIQUETA_TRANSICION_RAPIDA[destino] ?? `Marcar como "${traducirEstadoConciliacion(destino)}"`}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
