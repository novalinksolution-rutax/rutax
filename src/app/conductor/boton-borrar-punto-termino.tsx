"use client";

/**
 * Borrar el punto de término — peldaño 2 de la escalera de fricción.
 * =============================================================================
 *
 * Peldaño 2 y no 1: el dato no se puede recuperar solo, y volver a darlo exige
 * pasar otra vez por el consentimiento de tres pasos — que hoy, además, **no
 * existe en ninguna superficie** mientras la app nativa no lo construya. Así que
 * la consecuencia se dice completa antes de apretar.
 *
 * Peldaño 2 y no 3: no se pide escribir una frase. Es el derecho de la persona
 * sobre su propio dato personal, y ponerle una aduana a ejercerlo es
 * exactamente lo contrario de lo que la ley busca.
 */

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { accionQuitarPuntoTermino } from "./actions";

export function BotonBorrarPuntoTermino() {
  const [abierto, setAbierto] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (listo) {
    return (
      <p className="text-sm leading-relaxed text-balanced-fg">
        Listo: borramos tu punto de término. Tus rutas se van a armar sin considerar dónde terminas.
      </p>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        Borrar mi punto de término
      </Button>

      <Dialog open={abierto} onOpenChange={(a) => !a && !pendiente && setAbierto(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Borrar tu punto de término</DialogTitle>
          </DialogHeader>

          <p className="text-sm leading-relaxed text-fg-muted">
            Se borra la dirección donde terminas tu jornada. Tus rutas se van a seguir armando
            igual, solo que sin considerarla.
          </p>
          {/* Lo que NO se puede deshacer, dicho antes. */}
          <p className="text-sm leading-relaxed text-fg-muted">
            <strong className="font-medium text-fg">No se puede deshacer desde acá:</strong> para
            volver a darla vas a tener que hacerlo desde la app, cuando esa pantalla exista.
          </p>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" disabled={pendiente} onClick={() => setAbierto(false)}>
              Volver
            </Button>
            <Button
              variant="destructive"
              disabled={pendiente}
              onClick={() =>
                iniciar(async () => {
                  setError(null);
                  const r = await accionQuitarPuntoTermino();
                  if (!r.ok) {
                    setError(r.mensaje ?? "No pudimos quitarlo. Inténtalo de nuevo.");
                    return;
                  }
                  setListo(true);
                  setAbierto(false);
                })
              }
            >
              {pendiente ? "Borrando…" : "Sí, bórralo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
