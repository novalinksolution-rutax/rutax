"use client";

/**
 * Las dos acciones de la fila: inactivar y reactivar.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 «REACTIVAR» ES LA SALIDA QUE NO EXISTÍA
 * -----------------------------------------------------------------------------
 * B3b lo señala como uno de los cinco estados sin salida: *«hoy la interfaz sabe
 * pintar la tarifa inactivada y no ofrece ninguna forma de salir de ese
 * estado»*. La única vuelta era crear otra tarifa desde cero — y con eso se
 * pierde la fecha de vigencia original, que es lo que decide desde cuándo se le
 * cobró a ese seller.
 *
 * -----------------------------------------------------------------------------
 * INACTIVAR PIDE CONFIRMACIÓN Y REACTIVAR NO
 * -----------------------------------------------------------------------------
 * No es inconsistencia: **las dos direcciones no cuestan lo mismo**. Inactivar
 * deja al seller sin tarifa vigente y sus entregas dejan de poder cobrarse, en
 * silencio, hasta el cierre del período. Reactivar devuelve una tarifa a un
 * estado en el que ya estuvo, se ve al instante en la tabla y se deshace con un
 * clic.
 *
 * La confirmación **dice la consecuencia**, no «¿estás seguro?»: nombra al
 * seller y dice que sus entregas quedan sin poder cobrarse.
 */

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { accionInactivarTarifa, accionReactivarTarifa } from "./actions";

export function BotonInactivarTarifa({
  tarifaId,
  /** Para nombrarlo en la confirmación. `null` = la tarifa por defecto. */
  sellerNombre,
}: {
  tarifaId: string;
  sellerNombre: string | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const aQuien = sellerNombre ?? "todos los sellers sin tarifa propia";

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Inactivar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Inactivar esta tarifa</DialogTitle>
          {/* La consecuencia, no «¿estás seguro?». */}
          <DialogDescription>
            Las entregas de <span className="font-medium text-fg">{aQuien}</span> se van a seguir
            haciendo, pero <span className="font-medium text-fg">no se van a poder cobrar</span>{" "}
            mientras no haya otra tarifa vigente. Puedes reactivarla después desde el cajón
            «Inactivas».
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p
            role="alert"
            className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
          >
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setAbierto(false)} disabled={pendiente}>
            Volver
          </Button>
          <Button
            variant="destructive"
            disabled={pendiente}
            onClick={() =>
              iniciar(async () => {
                setError(null);
                const r = await accionInactivarTarifa(tarifaId);
                if (r.ok) setAbierto(false);
                else setError(r.mensaje);
              })
            }
          >
            {pendiente ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                Inactivando…
              </>
            ) : (
              "Inactivar la tarifa"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BotonReactivarTarifa({ tarifaId }: { tarifaId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  return (
    <div className="flex items-center justify-end gap-2">
      {error && (
        <span role="alert" className="text-xs text-fault-fg">
          {error}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={pendiente}
        onClick={() =>
          iniciar(async () => {
            setError(null);
            const r = await accionReactivarTarifa(tarifaId);
            if (!r.ok) setError(r.mensaje);
          })
        }
      >
        {pendiente ? (
          <>
            <Loader2 className="mr-2 size-3.5 animate-spin" aria-hidden="true" />
            Reactivando…
          </>
        ) : (
          "Reactivar"
        )}
      </Button>
    </div>
  );
}
