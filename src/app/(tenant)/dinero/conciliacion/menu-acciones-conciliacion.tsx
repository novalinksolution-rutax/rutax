"use client";

/**
 * Menú de 3 puntos para acciones de conciliación (D-4).
 *
 * Acciones por estado:
 * - pendiente: "Marcar revisado" · "Marcar resuelto" · "Ignorar"
 * - revisado: "Marcar resuelto" · "Ignorar"
 * - resuelto: solo lectura
 * - ignorado: "Restaurar a pendiente"
 *
 * "Ignorar" pide confirmación mínima. Las demás son de un clic.
 */

import { useState, useRef, useEffect, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import type { EstadoEventoConciliacion } from "@/modules/dinero/tipos";
import { accionResolverEvento, accionRestaurarEventoPendiente } from "./actions";

interface Props {
  eventoId: string;
  estadoActual: EstadoEventoConciliacion;
}

export function MenuAccionesConciliacion({ eventoId, estadoActual }: Props) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [confirmarIgnorar, setConfirmarIgnorar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resuelto, setResuelto] = useState(false);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuAbierto(false);
        setConfirmarIgnorar(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (estadoActual === "resuelto" || resuelto) {
    return null;
  }

  function ejecutarAccion(
    accion: () => Promise<{ ok: true } | { ok: false; mensaje: string }>,
  ) {
    setError(null);
    startTransition(async () => {
      const resultado = await accion();
      if (resultado.ok) {
        setMenuAbierto(false);
        setConfirmarIgnorar(false);
        setResuelto(true);
        window.location.reload();
      } else {
        setError(resultado.mensaje);
      }
    });
  }

  const acciones: Array<{
    etiqueta: string;
    accion: () => void;
    mostrar: boolean;
    destructivo?: boolean;
  }> = [
    {
      etiqueta: "Marcar revisado",
      accion: () =>
        ejecutarAccion(() => accionResolverEvento(eventoId, "revisado")),
      mostrar: estadoActual === "pendiente",
    },
    {
      etiqueta: "Marcar resuelto",
      accion: () =>
        ejecutarAccion(() => accionResolverEvento(eventoId, "resuelto")),
      mostrar: estadoActual === "pendiente" || estadoActual === "revisado",
    },
    {
      etiqueta: "Ignorar",
      accion: () => setConfirmarIgnorar(true),
      mostrar: estadoActual === "pendiente" || estadoActual === "revisado",
      destructivo: true,
    },
    {
      etiqueta: "Restaurar a pendiente",
      accion: () =>
        ejecutarAccion(() => accionRestaurarEventoPendiente(eventoId)),
      mostrar: estadoActual === "ignorado",
    },
  ].filter((a) => a.mostrar);

  if (acciones.length === 0) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => {
          setMenuAbierto((prev) => !prev);
          setConfirmarIgnorar(false);
          setError(null);
        }}
        disabled={isPending}
        aria-label="Acciones del evento"
        aria-haspopup="menu"
        aria-expanded={menuAbierto}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
      >
        {isPending ? (
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          <MoreHorizontal className="size-4" />
        )}
      </button>

      {menuAbierto && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-52 rounded-xl border bg-card shadow-lg"
        >
          {!confirmarIgnorar ? (
            <ul className="py-1">
              {acciones.map((accion) => (
                <li key={accion.etiqueta}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={accion.accion}
                    disabled={isPending}
                    className={`w-full px-4 py-2 text-left text-sm hover:bg-muted transition-colors disabled:opacity-50 ${
                      accion.destructivo ? "text-destructive hover:bg-destructive-subtle" : "text-foreground"
                    }`}
                  >
                    {accion.etiqueta}
                  </button>
                </li>
              ))}
              {error && (
                <li className="px-4 py-2">
                  <p className="text-xs text-destructive" role="alert">
                    {error}
                  </p>
                </li>
              )}
            </ul>
          ) : (
            /* Confirmación mínima para "Ignorar" */
            <div className="p-4 space-y-3">
              <p className="text-sm font-medium">¿Ignorar esta diferencia?</p>
              <p className="text-xs text-muted-foreground">
                Quedará registrado en la bitácora.
              </p>
              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmarIgnorar(false);
                    setError(null);
                  }}
                  disabled={isPending}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    ejecutarAccion(() => accionResolverEvento(eventoId, "ignorado"))
                  }
                  disabled={isPending}
                  className="flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  {isPending && (
                    <span
                      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-destructive-foreground border-t-transparent"
                      aria-hidden="true"
                    />
                  )}
                  Sí, ignorar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
