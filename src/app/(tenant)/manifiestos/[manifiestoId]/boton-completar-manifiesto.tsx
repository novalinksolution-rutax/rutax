"use client";

/**
 * Botón "Cerrar manifiesto" — el coordinador da por terminada una ruta que
 * quedó `en_ruta`.
 *
 * =============================================================================
 * POR QUÉ EXISTE, Y QUÉ HUECO CIERRA
 * =============================================================================
 * `actionCompletarManifiesto` estaba escrita, con su RBAC, y **ninguna pantalla
 * la llamaba**. Mientras tanto, el conductor solo puede cerrar el manifiesto de
 * HOY —su app resuelve el manifiesto vigente filtrando por `fecha_operacion`—,
 * así que una ruta que se quedó abierta de ayer no la podía cerrar nadie:
 * el conductor porque ya no la ve, y el coordinador porque no tenía botón.
 *
 * Encontrado en producción el 2026-08-15, con un manifiesto del día anterior
 * todavía `en_ruta`.
 *
 * =============================================================================
 * CERRAR EL MANIFIESTO NO CIERRA SUS PEDIDOS — Y ESO SE DICE EN PANTALLA
 * =============================================================================
 * `completarManifiesto` mueve el manifiesto y nada más: un pedido que quedó
 * `asignado` o `en_ruta` SIGUE ahí, y sigue apareciendo en la bandeja de
 * asignación. Es correcto —un paquete no se entrega solo porque se cierre una
 * planilla— pero es exactamente el malentendido que haría creer al coordinador
 * que ya resolvió el día. Por eso el diálogo dice cuántas paradas quedan
 * abiertas y adónde ir a cerrarlas.
 */

import { useState, useTransition } from "react";
import { FlagTriangleRight } from "lucide-react";
import { actionCompletarManifiesto } from "../actions";

interface Props {
  manifiestoId: string;
  driverId: string;
  nombreConductor: string;
  /** Paradas que NO llegaron a un estado terminal. Se muestran en el diálogo. */
  paradasAbiertas: number;
}

export function BotonCompletarManifiesto({
  manifiestoId,
  driverId,
  nombreConductor,
  paradasAbiertas,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCompletar() {
    setError(null);
    const formData = new FormData();
    formData.set("manifiestoId", manifiestoId);
    formData.set("driverId", driverId);

    startTransition(async () => {
      const resultado = await actionCompletarManifiesto(formData);
      if (resultado?.error) {
        setError(resultado.error);
      } else {
        setAbierto(false);
        window.location.reload();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
      >
        <FlagTriangleRight className="size-4" aria-hidden="true" />
        Cerrar manifiesto
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-completar-titulo"
        >
          <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
            <h2 id="dialog-completar-titulo" className="text-lg font-semibold">
              ¿Cerrar la ruta de {nombreConductor}?
            </h2>

            <p className="mt-2 text-sm text-muted-foreground">
              El manifiesto pasa a completado y el conductor deja de verlo como ruta activa.
            </p>

            {paradasAbiertas > 0 && (
              // El aviso importa: cerrar la planilla no entrega los paquetes, y
              // sin decirlo el coordinador cree que dejó el día cuadrado.
              <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                Quedan{" "}
                <span className="font-semibold text-foreground">
                  {paradasAbiertas} parada{paradasAbiertas === 1 ? "" : "s"} sin cerrar
                </span>
                . Cerrar el manifiesto <span className="font-medium">no</span> las marca como
                entregadas: siguen apareciendo para asignar hasta que les des un estado final
                desde la ficha de cada pedido.
              </p>
            )}

            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() => setAbierto(false)}
                className="rounded-lg border border-input px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleCompletar}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {pending ? "Cerrando…" : "Cerrar manifiesto"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
