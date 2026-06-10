"use client";

/**
 * Dialog de reasignación — advertencia explícita (B-5).
 *
 * Si el pedido ya tiene conductor asignado, el texto del dialog DEBE incluir
 * el nombre del conductor actual y el nombre del manifiesto actual.
 * "Ya está asignado" sin el nombre no es información suficiente.
 */

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { actionReasignarPedido } from "../actions";
import type { EstadoPedido } from "@/modules/operacion/tipos";

interface Props {
  pedidoId: string;
  estadoActual: EstadoPedido;
  conductorActual: string;
  manifiestoActual: string;
}

export function DialogReasignacion({
  pedidoId,
  estadoActual,
  conductorActual,
  manifiestoActual,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmar() {
    setError(null);
    const formData = new FormData();
    formData.set("pedidoId", pedidoId);
    formData.set("estadoEsperado", estadoActual);

    startTransition(async () => {
      const resultado = await actionReasignarPedido(formData);
      if (resultado.error) {
        setError(resultado.error);
        return;
      }
      setAbierto(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-800 hover:bg-yellow-100 transition-colors"
      >
        Reasignar conductor
      </button>

      {abierto && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="dialog-reasig-titulo"
          aria-describedby="dialog-reasig-desc"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !pending && setAbierto(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl bg-background p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 flex-shrink-0 text-yellow-600" aria-hidden="true" />
              <div>
                <h2 id="dialog-reasig-titulo" className="font-semibold">
                  Reasignar pedido
                </h2>
                <p id="dialog-reasig-desc" className="mt-2 text-sm text-muted-foreground">
                  Este pedido está asignado al manifiesto{" "}
                  <strong className="text-foreground">&ldquo;{manifiestoActual}&rdquo;</strong>{" "}
                  del conductor{" "}
                  <strong className="text-foreground">{conductorActual}</strong>.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Si continúas, el pedido se devolverá a la cola de pendientes de asignación y
                  quedará disponible para asignarlo a otro manifiesto.
                </p>

                {error && (
                  <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setAbierto(false)}
                disabled={pending}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={pending}
                className="rounded-lg bg-yellow-600 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-700 transition-colors disabled:opacity-50"
              >
                {pending ? "Procesando..." : "Confirmar reasignación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
