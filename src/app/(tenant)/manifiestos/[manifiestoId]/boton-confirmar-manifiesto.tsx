"use client";

/**
 * Botón "Confirmar manifiesto" con dialog de confirmación.
 * Solo visible en estado 'borrador' y con ≥1 pedido.
 */

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { actionConfirmarManifiesto } from "../actions";

interface Props {
  manifiestoId: string;
  nombreConductor: string;
  totalPedidos: number;
  habilitado: boolean;
}

export function BotonConfirmarManifiesto({
  manifiestoId,
  nombreConductor,
  totalPedidos,
  habilitado,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirmar() {
    if (!habilitado) return;
    setError(null);
    const formData = new FormData();
    formData.set("manifiestoId", manifiestoId);

    startTransition(async () => {
      const resultado = await actionConfirmarManifiesto(formData);
      if (resultado?.error) {
        setError(resultado.error);
      } else {
        setExito(true);
        setAbierto(false);
        // Forzar recarga para ver el nuevo estado del manifiesto
        window.location.reload();
      }
    });
  }

  if (exito) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm font-medium text-green-800">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        Manifiesto confirmado
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={!habilitado || pending}
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={!habilitado ? "Agrega al menos un pedido para confirmar" : undefined}
      >
        Confirmar manifiesto
      </button>

      {/* Dialog de confirmación */}
      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-confirmar-titulo"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !pending && setAbierto(false)}
            aria-hidden="true"
          />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-md rounded-xl bg-card shadow-xl border p-6 space-y-4">
            <h2 id="dialog-confirmar-titulo" className="text-lg font-semibold">
              Confirmar manifiesto
            </h2>
            <p className="text-sm text-muted-foreground">
              Vas a confirmar este manifiesto para{" "}
              <span className="font-medium text-foreground">{nombreConductor}</span>.
              {" "}Una vez confirmado, no se podrán agregar ni quitar pedidos.
            </p>
            <p className="text-sm text-muted-foreground">
              Total: <span className="font-medium text-foreground">{totalPedidos} pedido{totalPedidos !== 1 ? "s" : ""}</span>
            </p>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setAbierto(false)}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleConfirmar}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {pending ? "Confirmando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
