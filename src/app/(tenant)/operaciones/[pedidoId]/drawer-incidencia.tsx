"use client";

/**
 * Drawer para abrir una incidencia en un pedido.
 */

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { TIPOS_INCIDENCIA } from "@/modules/operacion/tipos";
import { traducirTipoIncidencia } from "@/lib/ui/traduccion-estados";
import { actionAbrirIncidencia } from "../actions";

interface Props {
  pedidoId: string;
  sellerId: string;
}

export function DrawerIncidencia({ pedidoId, sellerId }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setError(null);

    startTransition(async () => {
      const resultado = await actionAbrirIncidencia(data);
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
        className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
      >
        Abrir incidencia
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-incidencia-titulo"
          className="fixed inset-0 z-50 flex items-end justify-end"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !pending && setAbierto(false)}
            aria-hidden="true"
          />

          <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-background shadow-2xl sm:w-96">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 id="drawer-incidencia-titulo" className="text-base font-semibold">
                Abrir incidencia
              </h2>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                disabled={pending}
                className="rounded-md p-1 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <form id="form-incidencia" onSubmit={handleSubmit} className="space-y-4">
                <input type="hidden" name="pedidoId" value={pedidoId} />
                <input type="hidden" name="sellerId" value={sellerId} />

                <div>
                  <label htmlFor="tipo-incidencia" className="block text-sm font-medium">
                    Tipo de incidencia <span aria-hidden="true">*</span>
                  </label>
                  <select
                    id="tipo-incidencia"
                    name="tipo"
                    required
                    disabled={pending}
                    className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Seleccionar tipo...</option>
                    {TIPOS_INCIDENCIA.map((tipo) => (
                      <option key={tipo} value={tipo}>
                        {traducirTipoIncidencia(tipo)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="descripcion-incidencia" className="block text-sm font-medium">
                    Descripción <span className="text-muted-foreground">(opcional)</span>
                  </label>
                  <textarea
                    id="descripcion-incidencia"
                    name="descripcion"
                    rows={3}
                    disabled={pending}
                    placeholder="Describe brevemente la incidencia..."
                    className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {error && (
                  <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
              </form>
            </div>

            <div className="border-t px-5 py-4">
              <button
                type="submit"
                form="form-incidencia"
                disabled={pending}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {pending ? "Abriendo..." : "Abrir incidencia"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
