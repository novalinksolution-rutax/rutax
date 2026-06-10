"use client";

/**
 * Selector interactivo de pedidos para agregar al manifiesto.
 * Checkboxes, barra sticky al fondo, advertencia de reasignación (B-5).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import type { Pedido } from "@/modules/operacion/tipos";
import { actionAsignarPedidos } from "../../actions";

interface PedidoDisponible {
  pedido: Pedido;
  nombreConductorActual: string | null;
  nombreManifiestoActual: string | null;
}

interface Props {
  manifiestoId: string;
  pedidosDisponibles: PedidoDisponible[];
}

export function SelectorPedidosManifiesto({ manifiestoId, pedidosDisponibles }: Props) {
  const router = useRouter();
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [dialogReasignacion, setDialogReasignacion] = useState<PedidoDisponible[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleSeleccion(pedidoId: string) {
    setSeleccionados((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(pedidoId)) {
        siguiente.delete(pedidoId);
      } else {
        siguiente.add(pedidoId);
      }
      return siguiente;
    });
  }

  function toggleTodos() {
    if (seleccionados.size === pedidosDisponibles.length) {
      setSeleccionados(new Set());
    } else {
      setSeleccionados(new Set(pedidosDisponibles.map((p) => p.pedido.id)));
    }
  }

  function handleAgregar() {
    if (seleccionados.size === 0) return;
    setError(null);

    // Verificar si alguno de los seleccionados ya tiene asignación activa (B-5)
    const conReasignacion = pedidosDisponibles.filter(
      (pd) => seleccionados.has(pd.pedido.id) && pd.pedido.estado === "asignado",
    );

    if (conReasignacion.length > 0) {
      setDialogReasignacion(conReasignacion);
      return;
    }

    ejecutarAsignacion();
  }

  function ejecutarAsignacion() {
    const formData = new FormData();
    formData.set("manifiestoId", manifiestoId);
    formData.set("pedidoIds", Array.from(seleccionados).join(","));

    startTransition(async () => {
      const resultado = await actionAsignarPedidos(formData);
      if (resultado?.error) {
        setError(resultado.error);
        setDialogReasignacion(null);
      } else {
        router.push(`/manifiestos/${manifiestoId}`);
      }
    });
  }

  const haySeleccionados = seleccionados.size > 0;

  if (pedidosDisponibles.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-6 py-12 text-center">
        <p className="text-muted-foreground">
          No hay pedidos pendientes de asignación.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Los pedidos se crean automáticamente desde Mercado Libre o puedes crear un pedido same-day.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Tabla de pedidos */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Pedidos disponibles para agregar al manifiesto">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={seleccionados.size === pedidosDisponibles.length && pedidosDisponibles.length > 0}
                    onChange={toggleTodos}
                    aria-label="Seleccionar todos"
                    className="rounded border-input"
                  />
                </th>
                <th className="px-4 py-2">Destinatario</th>
                <th className="hidden px-4 py-2 sm:table-cell">Dirección / Comuna</th>
                <th className="hidden px-4 py-2 md:table-cell">Seller</th>
                <th className="hidden px-4 py-2 lg:table-cell">F. compromiso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pedidosDisponibles.map(({ pedido, nombreConductorActual }) => {
                const yaAsignado = pedido.estado === "asignado";
                return (
                  <tr
                    key={pedido.id}
                    className={`hover:bg-muted/30 transition-colors cursor-pointer ${yaAsignado ? "bg-amber-50/50" : ""}`}
                    onClick={() => toggleSeleccion(pedido.id)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={seleccionados.has(pedido.id)}
                        onChange={() => toggleSeleccion(pedido.id)}
                        aria-label={`Seleccionar pedido de ${pedido.destinatarioNombre}`}
                        className="rounded border-input"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{pedido.destinatarioNombre}</p>
                      {yaAsignado && (
                        <p className="text-xs text-amber-700 mt-0.5 flex items-center gap-1">
                          <AlertTriangle className="size-3 inline" aria-hidden="true" />
                          Ya asignado{nombreConductorActual ? ` a ${nombreConductorActual}` : ""}
                        </p>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                      <span>{pedido.destinatarioDireccion}</span>
                      <span className="ml-1 text-xs font-medium text-foreground">{pedido.destinatarioComuna}</span>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {pedido.sellerId}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      {pedido.fechaCompromiso ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
          {error}
        </p>
      )}

      {/* Barra sticky al fondo */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card shadow-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {haySeleccionados ? (
              <span className="font-medium text-foreground">
                {seleccionados.size} pedido{seleccionados.size !== 1 ? "s" : ""} seleccionado{seleccionados.size !== 1 ? "s" : ""}
              </span>
            ) : (
              "Selecciona los pedidos que quieres agregar"
            )}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!haySeleccionados || pending}
              onClick={handleAgregar}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pending ? "Agregando..." : `Agregar al manifiesto`}
            </button>
          </div>
        </div>
      </div>

      {/* Dialog de advertencia de reasignación (B-5) */}
      {dialogReasignacion && dialogReasignacion.length > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-reasignacion-titulo"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/50" aria-hidden="true" />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-lg rounded-xl bg-card shadow-xl border p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <h2 id="dialog-reasignacion-titulo" className="text-lg font-semibold">
                Pedidos ya asignados
              </h2>
            </div>

            <div className="space-y-3">
              {dialogReasignacion.map(({ pedido, nombreConductorActual, nombreManifiestoActual }) => (
                <div key={pedido.id} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                  <p>
                    El pedido de{" "}
                    <span className="font-medium">{pedido.destinatarioNombre}</span>{" "}
                    ya está asignado al manifiesto{" "}
                    <span className="font-medium">
                      &ldquo;{nombreManifiestoActual ?? "sin nombre"}&rdquo;
                    </span>{" "}
                    del conductor{" "}
                    <span className="font-medium">{nombreConductorActual ?? "desconocido"}</span>.
                    {" "}Si lo agregas aquí, se quitará de ese manifiesto.
                  </p>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setDialogReasignacion(null)}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={ejecutarAsignacion}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {pending ? "Agregando..." : "Continuar de todos modos"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
