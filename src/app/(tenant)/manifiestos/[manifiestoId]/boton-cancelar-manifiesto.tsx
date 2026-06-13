"use client";

/**
 * Botón "Cancelar manifiesto" con confirmación simple.
 * Solo visible en estado 'borrador'.
 */

import { useState, useTransition } from "react";
import { actionCancelarManifiesto } from "../actions";

interface Props {
  manifiestoId: string;
}

export function BotonCancelarManifiesto({ manifiestoId }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCancelar() {
    setError(null);
    const formData = new FormData();
    formData.set("manifiestoId", manifiestoId);

    startTransition(async () => {
      const resultado = await actionCancelarManifiesto(formData);
      if (resultado?.error) {
        setError(resultado.error);
        setAbierto(false);
      }
      // Si tuvo éxito, la acción hace redirect a /manifiestos
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-lg border px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
      >
        Cancelar manifiesto
      </button>

      {/* Dialog de confirmación */}
      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-cancelar-titulo"
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
            <h2 id="dialog-cancelar-titulo" className="text-lg font-semibold">
              Cancelar manifiesto
            </h2>
            <p className="text-sm text-muted-foreground">
              Esta acción cancela el manifiesto en borrador. Los pedidos quedarán disponibles para ser asignados nuevamente.
            </p>

            {error && (
              <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
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
                Volver
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleCancelar}
                className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                {pending ? "Cancelando..." : "Sí, cancelar manifiesto"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
