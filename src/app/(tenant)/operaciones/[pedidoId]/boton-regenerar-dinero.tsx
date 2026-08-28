"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { accionRegenerarLineasDinero } from "./acciones-dinero";

/**
 * «Falta una línea» + la forma de reponerla.
 * =============================================================================
 *
 * Aparece **solo cuando el hueco existe**: un pedido entregado al que le falta
 * el cobro o la liquidación. No es un botón permanente — regenerar algo que ya
 * está completo no hace nada, y ofrecerlo sugiere que sí.
 *
 * ⚠️ **No dice «listo».** El motor corre en un job aparte, así que al volver la
 * línea todavía no existe. Prometer que ya está sería mentir sobre algo que no
 * ocurrió; el aviso dice que se pidió y que hay que recargar para verlo.
 *
 * No es una acción de la zona de consecuencia: es **aditiva e idempotente**
 * —el motor inserta con `ON CONFLICT DO NOTHING`— y no destruye nada. Ponerla
 * junto a «anular» y «cancelar» la haría parecer grave, y las de ahí piden
 * motivo escrito porque lo son.
 */
export function AvisoLineaFaltante({
  pedidoId,
  faltaCobro,
  faltaLiquidacion,
}: {
  pedidoId: string;
  faltaCobro: boolean;
  faltaLiquidacion: boolean;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<"listo" | "pedido" | "error">("listo");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!faltaCobro && !faltaLiquidacion) return null;

  const queFalta =
    faltaCobro && faltaLiquidacion
      ? "el cobro al seller y la liquidación al conductor"
      : faltaCobro
        ? "el cobro al seller"
        : "la liquidación al conductor";

  function pedir() {
    setMensaje(null);
    startTransition(async () => {
      const r = await accionRegenerarLineasDinero(pedidoId);
      if (!r.ok) {
        setEstado("error");
        setMensaje(r.mensaje ?? "No se pudo pedir la regeneración.");
        return;
      }
      setEstado("pedido");
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3">
      <p className="text-sm font-medium">Esta entrega no tiene {queFalta}.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Pasa cuando el motor no alcanzó a escribir una de las dos líneas. Pedir que se
        regeneren no duplica lo que ya existe: solo escribe lo que falta.
      </p>

      {estado === "pedido" ? (
        <p className="mt-3 text-xs font-medium">
          Se pidió la regeneración. El motor corre aparte y tarda unos segundos — recarga
          la página para ver si la línea apareció.
        </p>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={isPending}
          onClick={pedir}
        >
          {isPending ? "Pidiendo…" : "Regenerar las líneas de dinero"}
        </Button>
      )}

      {estado === "error" && mensaje ? (
        <p className="mt-2 text-xs text-destructive">{mensaje}</p>
      ) : null}
    </div>
  );
}
