"use client";

/**
 * Se cayó el conductor: marcarlo no disponible y redistribuir sus paradas.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * LA ACCIÓN YA EXISTÍA; LO QUE FALTABA ERA ESTAR ACÁ
 * -----------------------------------------------------------------------------
 * `actionMarcarConductorNoDisponible` y su `ResultadoRedistribucion` con impacto
 * SLA por seller están construidos desde F6. Su único llamador vivía en la
 * pantalla de **conductores**, que es donde se administra la nómina — no donde
 * se mira una ruta en curso.
 *
 * Y el momento en que esto se necesita es este: son las 18:20, el coordinador
 * está mirando la ruta de Muñoz porque va en 30 %, y le avisan que se accidentó.
 * Tener que salir a otra pantalla, buscarlo en una lista de conductores y
 * volver, con el corte a tres horas, es la diferencia entre reaccionar y llegar
 * tarde.
 *
 * -----------------------------------------------------------------------------
 * EL RESULTADO SE MUESTRA EN BLOQUE, NO EN UN AVISO QUE SE VA
 * -----------------------------------------------------------------------------
 * Redistribuir devuelve tres cifras que hay que leer con calma —cuántas paradas
 * encontraron receptor, cuántas quedaron sin nadie, y a qué sellers les pega en
 * el SLA—. **Las que quedaron sin receptor son la razón de ser de la tarjeta**:
 * son bultos que nadie va a llevar, y si eso aparece en una notificación
 * temporal se pierde justo cuando hay que actuar.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserMinus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ImpactoSla } from "@/modules/operacion/tipos";
import { actionMarcarConductorNoDisponible } from "../actions";

interface Props {
  conductorId: string;
  nombreConductor: string;
  /** Fecha de operación del manifiesto, 'YYYY-MM-DD'. */
  fecha: string;
  /** Paradas que el conductor todavía no cierra: lo que se va a mover. */
  paradasAbiertas: number;
}

interface Resultado {
  reasignadas: number;
  sinConductor: number;
  idempotente: boolean;
  impactoSla: ImpactoSla[];
}

export function BotonRedistribuir({
  conductorId,
  nombreConductor,
  fecha,
  paradasAbiertas,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmar() {
    setError(null);
    startTransition(async () => {
      const r = await actionMarcarConductorNoDisponible(conductorId, motivo, fecha);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setResultado({
        reasignadas: r.datos.paradasReasignadas.length,
        sinConductor: r.datos.paradasSinConductor.length,
        idempotente: r.datos.idempotente,
        impactoSla: r.datos.impactoSla,
      });
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-start border-attention-line text-attention-fg hover:bg-attention-bg"
        onClick={() => {
          setResultado(null);
          setError(null);
          setMotivo("");
          setAbierto(true);
        }}
      >
        <UserMinus className="size-4" aria-hidden="true" />
        Se cayó el conductor
      </Button>

      <Dialog
        open={abierto}
        onOpenChange={(a) => {
          if (a || pending) return;
          setAbierto(false);
          // Si hubo redistribución, al cerrar se relee la pantalla: las paradas
          // que cambiaron de manos ya no son de este manifiesto.
          if (resultado) router.refresh();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {resultado ? "Paradas redistribuidas" : `Marcar a ${nombreConductor} no disponible`}
            </DialogTitle>
          </DialogHeader>

          {resultado ? (
            <div className="space-y-4">
              {resultado.idempotente ? (
                <p className="text-sm text-fg-muted">
                  {nombreConductor} ya estaba marcado no disponible. No había paradas que
                  redistribuir.
                </p>
              ) : (
                <div className="flex flex-wrap gap-x-8 gap-y-3">
                  <div>
                    <p className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
                      Con nuevo conductor
                    </p>
                    <p className="rx-num text-2xl text-fg">{resultado.reasignadas}</p>
                  </div>
                  {/* Las que quedaron sin nadie son lo único accionable de esta
                      tarjeta, así que van en el tono que lo dice. */}
                  <div>
                    <p className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
                      Sin conductor
                    </p>
                    <p
                      className={
                        resultado.sinConductor > 0
                          ? "rx-num text-2xl text-attention-fg"
                          : "rx-num text-2xl text-fg"
                      }
                    >
                      {resultado.sinConductor}
                    </p>
                  </div>
                </div>
              )}

              {resultado.sinConductor > 0 ? (
                <p className="text-sm leading-relaxed text-attention-fg">
                  Esas paradas quedaron en la bandeja{" "}
                  <strong className="font-medium">sin conductor</strong>: nadie las lleva
                  hasta que las asignes. Están en Operaciones, pendientes de asignación.
                </p>
              ) : null}

              {resultado.impactoSla.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
                    A quién le pega
                  </p>
                  <ul className="divide-y divide-line border border-line">
                    {resultado.impactoSla.map((i) => (
                      <li
                        key={i.sellerId}
                        className="flex items-center justify-between gap-4 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">{i.sellerNombre}</span>
                        <span className="rx-num shrink-0 text-fg-muted">
                          {i.slaPctActual !== null ? `${i.slaPctActual.toFixed(1)}%` : "—"} / obj.{" "}
                          {i.objetivoPct}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {/* La consecuencia en número: cuántas paradas se mueven. */}
              <p className="text-sm leading-relaxed text-fg-muted">
                {paradasAbiertas > 0 ? (
                  <>
                    Sus{" "}
                    <strong className="font-medium text-fg">
                      {paradasAbiertas} {paradasAbiertas === 1 ? "parada abierta" : "paradas abiertas"}
                    </strong>{" "}
                    del día se reparten entre los conductores que siguen en ruta. Las que no
                    encuentren receptor quedan en la bandeja sin conductor.
                  </>
                ) : (
                  <>
                    No le quedan paradas abiertas ese día. Se marca no disponible y no hay nada
                    que redistribuir.
                  </>
                )}
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="motivo-redistribuir-manifiesto">Motivo</Label>
                <Textarea
                  id="motivo-redistribuir-manifiesto"
                  rows={2}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Se accidentó y no puede seguir la ruta."
                />
                <p className="text-xs text-fg-muted">
                  Queda en la bitácora con tu nombre, junto a la redistribución.
                </p>
              </div>
            </>
          )}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button
              variant={resultado ? "default" : "ghost"}
              disabled={pending}
              onClick={() => {
                setAbierto(false);
                if (resultado) router.refresh();
              }}
            >
              {resultado ? "Listo" : "Volver"}
            </Button>
            {resultado ? null : (
              <Button
                variant="destructive"
                disabled={pending || motivo.trim().length < 3}
                onClick={confirmar}
              >
                {pending ? "Redistribuyendo…" : "Marcar y redistribuir"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
