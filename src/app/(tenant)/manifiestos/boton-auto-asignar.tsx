"use client";

/**
 * Botón "Auto-asignar pendientes del día" para la vista de manifiestos.
 *
 * ⚠️ DESACTIVADO desde 2026-08-12 (Etapa 0 de
 * `docs/arquitectura/retiro-y-ruteo-plan.md`). Este componente ya no se
 * importa desde `./page.tsx` ni desde ninguna otra pantalla — el archivo se
 * conserva como camino de vuelta. La Server Action que llama
 * (`actionAutoAsignarPendientes`) tiene su propia guarda de rechazo, así que
 * reactivar esto requiere también quitar esa guarda en
 * `./actions.ts`. Ver el comentario de cabecera de
 * `src/modules/operacion/auto-asignacion.ts` para el porqué completo.
 * Destino final: eliminarlo cuando la asignación en bloque (Etapa 6) esté en
 * uso.
 *
 * Sigue el patrón del dialog-reasignacion.tsx: confirmación explícita antes
 * de ejecutar, y resumen del resultado con detalle de no-asignados.
 *
 * Solo se renderiza si el usuario tiene capacidad `asignar_y_reasignar_pedidos`
 * (la comprobación real vive en la Server Action — aquí es solo presentación).
 */

import { useState, useTransition } from "react";
import { Zap, RefreshCw, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { actionAutoAsignarPendientes } from "./actions";

interface Props {
  fechaHoy: string;
}

type ResultadoResumen = {
  totalAsignados: number;
  totalSinAsignar: number;
  conductoresAfectados: number;
  sinAsignarDetalle: Array<{ motivo: string; cantidad: number }>;
};

export function BotonAutoAsignar({ fechaHoy }: Props) {
  const [dialogAbierto, setDialogAbierto] = useState(false);
  const [pendiente, iniciarTransicion] = useTransition();
  const [resultado, setResultado] = useState<ResultadoResumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  function abrir() {
    setResultado(null);
    setError(null);
    setDialogAbierto(true);
  }

  function confirmar() {
    setError(null);
    iniciarTransicion(async () => {
      const resp = await actionAutoAsignarPendientes(fechaHoy);
      if (!resp.ok) {
        setError(resp.mensaje);
        return;
      }

      const datos = resp.datos;
      const totalAsignados = datos.asignados.reduce(
        (acc, a) => acc + a.pedidosAsignados.length,
        0,
      );

      const porMotivo = new Map<string, number>();
      for (const p of datos.sinAsignar) {
        porMotivo.set(p.motivo, (porMotivo.get(p.motivo) ?? 0) + 1);
      }

      setResultado({
        totalAsignados,
        totalSinAsignar: datos.sinAsignar.length,
        conductoresAfectados: datos.conductoresAfectados.length,
        sinAsignarDetalle: [...porMotivo.entries()].map(([motivo, cantidad]) => ({
          motivo: traducirMotivo(motivo),
          cantidad,
        })),
      });
    });
  }

  const mostrarConfirmacion = !resultado && !error;

  return (
    <>
      <Button variant="outline" onClick={abrir}>
        <Zap className="size-4" aria-hidden="true" />
        Auto-asignar pendientes
      </Button>

      {dialogAbierto && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="dialog-autoasig-titulo"
          aria-describedby="dialog-autoasig-desc"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
        >
          <div
            className="absolute inset-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
            onClick={() => !pendiente && setDialogAbierto(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-md rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <h2 id="dialog-autoasig-titulo" className="font-semibold text-lg">
              Auto-asignar pedidos pendientes
            </h2>

            {mostrarConfirmacion && (
              <p id="dialog-autoasig-desc" className="mt-2 text-sm text-muted-foreground">
                Se asignarán automáticamente los pedidos en estado{" "}
                <strong className="text-foreground">pendiente de asignación</strong> del día{" "}
                <strong className="text-foreground">{fechaHoy}</strong> a los conductores
                disponibles según sus zonas preferentes y cupo restante. El operador puede
                reasignar manualmente después.
              </p>
            )}

            {pendiente && (
              <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                Ejecutando auto-asignación…
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="mt-4">
                <ShieldAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {resultado && (
              <div className="mt-4 space-y-4">
                {resultado.totalAsignados > 0 ? (
                  <Alert className="bg-success-subtle text-success-subtle-foreground">
                    <CheckCircle2 className="text-success" />
                    <AlertDescription>
                      {resultado.totalAsignados} pedido
                      {resultado.totalAsignados !== 1 ? "s" : ""} asignado
                      {resultado.totalAsignados !== 1 ? "s" : ""} a{" "}
                      {resultado.conductoresAfectados} conductor
                      {resultado.conductoresAfectados !== 1 ? "es" : ""}.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert>
                    <AlertTriangle className="text-warning" />
                    <AlertDescription>
                      No hay pedidos pendientes de asignación para hoy.
                    </AlertDescription>
                  </Alert>
                )}

                {resultado.sinAsignarDetalle.length > 0 && (
                  <div className="rounded-lg border border-border p-4 space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      {resultado.totalSinAsignar} pedido
                      {resultado.totalSinAsignar !== 1 ? "s" : ""} sin asignar
                    </p>
                    <ul className="space-y-1.5">
                      {resultado.sinAsignarDetalle.map(({ motivo, cantidad }) => (
                        <li
                          key={motivo}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="text-muted-foreground">{motivo}</span>
                          <Badge variant="neutral">{cantidad}</Badge>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground pt-1">
                      Reasígnalos manualmente desde la vista del pedido o desde manifiestos.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDialogAbierto(false)}
                disabled={pendiente}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                {resultado || error ? "Cerrar" : "Cancelar"}
              </button>
              {mostrarConfirmacion && (
                <button
                  type="button"
                  onClick={confirmar}
                  disabled={pendiente}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
                >
                  {pendiente && (
                    <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                  )}
                  {pendiente ? "Asignando…" : "Confirmar auto-asignación"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Traducciones de motivos al español de Chile
function traducirMotivo(motivo: string): string {
  switch (motivo) {
    case "sin_conductor_disponible":
      return "Sin conductor disponible";
    case "sin_cupo":
      return "Conductores sin cupo";
    case "sin_conductor_en_zona":
      return "Sin conductor en la zona";
    default:
      return motivo;
  }
}
