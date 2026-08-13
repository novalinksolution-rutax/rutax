"use client";

/**
 * "Sincronizar ahora" — el courier fuerza la ingesta de una cuenta ML de un
 * seller (o de una entre varias). Ver contexto completo en `./actions.ts`
 * (`solicitarSincronizacionMlSeller`).
 *
 * Un seller con UNA sola cuenta ve un botón directo. Con dos o más, el botón
 * abre un menú con una fila por cuenta — mismo criterio que el resto del
 * producto (CLAUDE.md: "muestra el origen solo cuando el seller tiene más de
 * una cuenta", no recargar la UI cuando hay una sola).
 */

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { solicitarSincronizacionMlSeller } from "./actions";

/**
 * Ventana de "enfriamiento" del botón tras cada intento — pura UX en el
 * cliente (no persiste, se reinicia al recargar). La deduplicación real que
 * evita machacar el backend vive en el servidor, en el `id` del evento
 * Inngest (ver `solicitarSincronizacionMlSeller`).
 */
const VENTANA_ENFRIAMIENTO_MS = 60_000;

export interface ConexionMlResumen {
  id: string;
  /** Nombre visible ya resuelto (alias → nickname → ···últimos 4). */
  etiqueta: string;
}

interface Props {
  razonSocial: string;
  conexiones: ConexionMlResumen[];
}

export function ControlSincronizarMl({ razonSocial, conexiones }: Props) {
  const [sincronizandoId, setSincronizandoId] = useState<string | null>(null);
  const [enEnfriamiento, setEnEnfriamiento] = useState<Set<string>>(new Set());
  const [ultimoIntentoId, setUltimoIntentoId] = useState<string | null>(null);
  const [resultadoPorId, setResultadoPorId] = useState<Record<string, { ok: boolean; mensaje: string }>>({});

  async function sincronizar(conexionId: string) {
    if (sincronizandoId || enEnfriamiento.has(conexionId)) return;
    setSincronizandoId(conexionId);
    setUltimoIntentoId(conexionId);

    try {
      const resultado = await solicitarSincronizacionMlSeller(conexionId);
      setResultadoPorId((prev) => ({
        ...prev,
        [conexionId]: resultado.ok
          ? { ok: true, mensaje: "Pedimos la sincronización — sus pedidos deberían aparecer en unos minutos." }
          : { ok: false, mensaje: resultado.mensaje },
      }));
    } catch {
      // Ver panel-conexion-ml.tsx: la Server Action puede rechazar (red caída,
      // deploy nuevo) y el botón NO debe quedar colgado en el spinner sin
      // mensaje.
      setResultadoPorId((prev) => ({
        ...prev,
        [conexionId]: {
          ok: false,
          mensaje: "No pudimos pedir la sincronización por un problema de conexión. Intenta de nuevo.",
        },
      }));
    } finally {
      setSincronizandoId(null);
      setEnEnfriamiento((prev) => new Set(prev).add(conexionId));
      setTimeout(() => {
        setEnEnfriamiento((prev) => {
          const copia = new Set(prev);
          copia.delete(conexionId);
          return copia;
        });
      }, VENTANA_ENFRIAMIENTO_MS);
    }
  }

  if (conexiones.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  const resultado = ultimoIntentoId ? resultadoPorId[ultimoIntentoId] : null;
  const etiquetaUltimoIntento = ultimoIntentoId
    ? (conexiones.find((c) => c.id === ultimoIntentoId)?.etiqueta ?? null)
    : null;
  const mostrarEtiquetaEnResultado = conexiones.length > 1 && etiquetaUltimoIntento;

  return (
    <div className="flex flex-col items-end gap-1">
      {conexiones.length === 1 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void sincronizar(conexiones[0].id)}
          disabled={sincronizandoId !== null || enEnfriamiento.has(conexiones[0].id)}
          aria-label={`Sincronizar pedidos de ${razonSocial}`}
        >
          {sincronizandoId === conexiones[0].id ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          Sincronizar
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sincronizandoId !== null}
              aria-label={`Sincronizar cuentas de Mercado Libre de ${razonSocial}`}
            >
              {sincronizandoId !== null ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              Sincronizar
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Cuentas de {razonSocial}</DropdownMenuLabel>
            {conexiones.map((c) => (
              <DropdownMenuItem
                key={c.id}
                disabled={sincronizandoId !== null || enEnfriamiento.has(c.id)}
                onSelect={() => void sincronizar(c.id)}
              >
                {c.etiqueta}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {resultado ? (
        <p
          role={resultado.ok ? "status" : "alert"}
          className={`max-w-[220px] text-right text-xs ${resultado.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {mostrarEtiquetaEnResultado ? `${etiquetaUltimoIntento}: ` : ""}
          {resultado.mensaje}
        </p>
      ) : null}
    </div>
  );
}
