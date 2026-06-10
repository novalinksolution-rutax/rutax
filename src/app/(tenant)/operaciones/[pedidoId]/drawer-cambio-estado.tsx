"use client";

/**
 * Drawer de corrección manual de estado (B-4).
 *
 * Reglas críticas:
 * - El selector de "nuevo estado" se construye DINÁMICAMENTE con
 *   esTransicionValida(estadoActual, candidato, 'interno') — sin lista hardcodeada.
 * - Motivo obligatorio (mínimo 10 caracteres).
 * - Botón "Confirmar" habilitado solo cuando se alcanza el mínimo.
 * - Sin window.confirm ni alert.
 */

import { useState, useTransition } from "react";
import { X, AlertTriangle } from "lucide-react";
import { ESTADOS_PEDIDO } from "@/modules/operacion/tipos";
import { esTransicionValida } from "@/modules/operacion/maquina-estados";
import { traducirEstadoPedido } from "@/lib/ui/traduccion-estados";
import { actionCambiarEstadoPedido } from "../actions";
import type { EstadoPedido } from "@/modules/operacion/tipos";

const MOTIVO_MIN = 10;

interface Props {
  pedidoId: string;
  estadoActual: EstadoPedido;
}

export function DrawerCambioEstado({ pedidoId, estadoActual }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [estadoNuevo, setEstadoNuevo] = useState<EstadoPedido | "">("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Construir lista de estados válidos dinámicamente (B-8)
  const estadosValidos = ESTADOS_PEDIDO.filter(
    (candidato) => candidato !== estadoActual && esTransicionValida(estadoActual, candidato, "interno"),
  );

  const motivoValido = motivo.trim().length >= MOTIVO_MIN;
  const puedeConfirmar = estadoNuevo !== "" && motivoValido && !pending;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!puedeConfirmar || !estadoNuevo) return;
    setError(null);

    const formData = new FormData();
    formData.set("pedidoId", pedidoId);
    formData.set("estadoEsperado", estadoActual);
    formData.set("estadoNuevo", estadoNuevo);
    formData.set("motivo", motivo.trim());

    startTransition(async () => {
      const resultado = await actionCambiarEstadoPedido(formData);
      if (resultado.error) {
        setError(resultado.error);
        return;
      }
      setAbierto(false);
      setEstadoNuevo("");
      setMotivo("");
    });
  }

  function cerrar() {
    if (pending) return;
    setAbierto(false);
    setEstadoNuevo("");
    setMotivo("");
    setError(null);
  }

  if (estadosValidos.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-800 hover:bg-orange-100 transition-colors"
      >
        Cambiar estado
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-estado-titulo"
          className="fixed inset-0 z-50 flex items-end justify-end"
        >
          {/* Fondo */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={cerrar}
            aria-hidden="true"
          />

          {/* Drawer */}
          <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-background shadow-2xl sm:w-96">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 id="drawer-estado-titulo" className="text-base font-semibold">
                Corrección manual de estado
              </h2>
              <button
                type="button"
                onClick={cerrar}
                disabled={pending}
                className="rounded-md p-1 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <form id="form-cambio-estado" onSubmit={handleSubmit} className="space-y-5">
                {/* Estado actual — solo lectura */}
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Estado actual</p>
                  <p className="mt-1 font-semibold">{traducirEstadoPedido(estadoActual)}</p>
                </div>

                {/* Selector de nuevo estado — construido dinámicamente (B-8) */}
                <div>
                  <label htmlFor="selector-estado-nuevo" className="block text-sm font-medium">
                    Nuevo estado <span aria-hidden="true">*</span>
                  </label>
                  <select
                    id="selector-estado-nuevo"
                    value={estadoNuevo}
                    onChange={(e) => setEstadoNuevo(e.target.value as EstadoPedido)}
                    disabled={pending}
                    required
                    className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Seleccionar nuevo estado...</option>
                    {estadosValidos.map((estado) => (
                      <option key={estado} value={estado}>
                        {traducirEstadoPedido(estado)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Motivo obligatorio (mínimo 10 caracteres) */}
                <div>
                  <label htmlFor="motivo-cambio" className="block text-sm font-medium">
                    Motivo <span aria-hidden="true">*</span>
                  </label>
                  <textarea
                    id="motivo-cambio"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    disabled={pending}
                    required
                    rows={4}
                    placeholder="Describe el motivo del cambio de estado..."
                    className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-describedby="motivo-ayuda"
                  />
                  <p id="motivo-ayuda" className="mt-1 text-xs text-muted-foreground">
                    {motivo.trim().length}/{MOTIVO_MIN} caracteres mínimos
                    {motivo.trim().length >= MOTIVO_MIN && (
                      <span className="ml-1 text-green-600">&#10003;</span>
                    )}
                  </p>
                </div>

                {/* Advertencia de bitácora */}
                <div
                  className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800"
                  role="note"
                >
                  <AlertTriangle className="mt-0.5 size-4 flex-shrink-0" aria-hidden="true" />
                  <p>Este cambio queda registrado en la bitácora de auditoría.</p>
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
                form="form-cambio-estado"
                disabled={!puedeConfirmar}
                className="w-full rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending ? "Guardando..." : "Confirmar cambio de estado"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
