"use client";

/**
 * Panel lateral de acciones de una incidencia.
 * Solo visible para usuarios con puedeGestionarIncidencias.
 */

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { traducirTipoIncidencia, traducirEstadoIncidencia } from "@/lib/ui/traduccion-estados";
import { actionActualizarIncidencia } from "./actions";
import type { Incidencia } from "@/modules/operacion/tipos";

interface Props {
  incidencia: Incidencia;
}

export function PanelIncidencia({ incidencia }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [notas, setNotas] = useState(incidencia.notasResolucion ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function actualizarEstado(nuevoEstado: string) {
    setError(null);
    const data = new FormData();
    data.set("incidenciaId", incidencia.id);
    data.set("estado", nuevoEstado);
    if (notas.trim()) data.set("notasResolucion", notas.trim());

    startTransition(async () => {
      const resultado = await actionActualizarIncidencia(data);
      if (resultado.error) {
        setError(resultado.error);
        return;
      }
      setAbierto(false);
    });
  }

  async function guardarNota() {
    setError(null);
    const data = new FormData();
    data.set("incidenciaId", incidencia.id);
    data.set("notasResolucion", notas.trim());

    startTransition(async () => {
      const resultado = await actionActualizarIncidencia(data);
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
        className="text-xs font-medium text-primary hover:underline"
      >
        Gestionar
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="panel-inc-titulo"
          className="fixed inset-0 z-50 flex items-end justify-end"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !pending && setAbierto(false)}
            aria-hidden="true"
          />

          <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-background shadow-2xl sm:w-96">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 id="panel-inc-titulo" className="text-base font-semibold">Gestionar incidencia</h2>
              <button type="button" onClick={() => setAbierto(false)} disabled={pending}
                className="rounded-md p-1 hover:bg-muted" aria-label="Cerrar">
                <X className="size-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Tipo</dt>
                  <dd className="font-medium">{traducirTipoIncidencia(incidencia.tipo)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Estado actual</dt>
                  <dd className="font-medium">{traducirEstadoIncidencia(incidencia.estado)}</dd>
                </div>
                {incidencia.descripcion && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Descripción</dt>
                    <dd>{incidencia.descripcion}</dd>
                  </div>
                )}
              </dl>

              {/* Notas de resolución */}
              <div>
                <label htmlFor="notas-res" className="block text-sm font-medium">
                  Notas de resolución
                  {incidencia.estado === "en_gestion" && (
                    <span className="ml-1 text-muted-foreground">(obligatorio para resolver)</span>
                  )}
                </label>
                <textarea
                  id="notas-res"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  disabled={pending}
                  rows={3}
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
              )}

              {/* Acciones según estado */}
              <div className="space-y-2">
                {incidencia.estado === "abierta" && (
                  <button type="button" onClick={() => actualizarEstado("en_gestion")}
                    disabled={pending}
                    className="w-full rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
                    {pending ? "Procesando..." : "Marcar como En gestión"}
                  </button>
                )}

                {incidencia.estado === "en_gestion" && (
                  <button type="button" onClick={() => actualizarEstado("resuelta")}
                    disabled={pending || !notas.trim()}
                    className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50">
                    {pending ? "Procesando..." : "Marcar como Resuelta"}
                  </button>
                )}

                {incidencia.estado === "resuelta" && (
                  <button type="button" onClick={() => actualizarEstado("cerrada")}
                    disabled={pending}
                    className="w-full rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
                    {pending ? "Procesando..." : "Cerrar incidencia"}
                  </button>
                )}

                {(incidencia.estado === "abierta" || incidencia.estado === "en_gestion") && (
                  <button type="button" onClick={guardarNota}
                    disabled={pending || !notas.trim()}
                    className="w-full rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
                    Guardar nota
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
