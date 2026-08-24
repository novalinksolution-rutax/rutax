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
 *
 * =============================================================================
 * QUÉ CAMBIÓ EN EL REDISEÑO
 * =============================================================================
 * El diálogo escrito a mano —`fixed inset-0` con overlay `bg-black/50`, sin
 * atrapar el foco y sin cerrar con Escape— pasa al `Dialog` del sistema, y
 * `window.location.reload()` pasa a `router.refresh()`: recargar la página
 * perdía el orden de ruta sin guardar del panel de al lado.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlagTriangleRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  const router = useRouter();
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
        return;
      }
      setAbierto(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-start"
        disabled={pending}
        onClick={() => setAbierto(true)}
      >
        <FlagTriangleRight className="size-4" aria-hidden="true" />
        Cerrar manifiesto
      </Button>

      <Dialog open={abierto} onOpenChange={(a) => !a && !pending && setAbierto(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cerrar la ruta de {nombreConductor}</DialogTitle>
          </DialogHeader>

          <p className="text-sm leading-relaxed text-fg-muted">
            El manifiesto pasa a completado y el conductor deja de verlo como ruta activa.
          </p>

          {paradasAbiertas > 0 ? (
            // El aviso importa: cerrar la planilla no entrega los paquetes, y
            // sin decirlo el coordinador cree que dejó el día cuadrado.
            <p className="border border-attention-line bg-attention-bg px-3 py-2.5 text-sm leading-relaxed text-attention-fg">
              Quedan{" "}
              <strong className="font-medium">
                {paradasAbiertas} parada{paradasAbiertas === 1 ? "" : "s"} sin cerrar
              </strong>
              . Cerrar el manifiesto <strong className="font-medium">no</strong> las marca como
              entregadas: siguen apareciendo para asignar hasta que les des un estado final
              desde la ficha de cada pedido.
            </p>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" disabled={pending} onClick={() => setAbierto(false)}>
              Volver
            </Button>
            <Button disabled={pending} onClick={handleCompletar}>
              {pending ? "Cerrando…" : "Cerrar manifiesto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
