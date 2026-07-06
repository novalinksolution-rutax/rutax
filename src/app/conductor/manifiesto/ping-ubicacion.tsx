"use client";

/**
 * PingUbicacion — Componente cliente que envía la ubicación del conductor
 * periódicamente mientras está en ruta y la PWA está en primer plano.
 *
 * Comportamiento:
 * - Primera vez (o después de rechazar): muestra modal de consentimiento.
 * - Si acepta: activa el ping cada INTERVALO_PING_MS mientras visibilityState='visible'.
 * - Al cerrar el componente (ruta completada): detiene el ping.
 * - Los datos GPS nunca se loguean en el cliente.
 *
 * Ley 21.431 (datos trabajadores): solo posición actual, no histórico.
 * El servidor verifica que haya manifiesto en_ruta antes de escribir.
 *
 * PRIVACIDAD: lat/long nunca en console.log ni en state visible.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  actionPingUbicacion,
  actionBorrarUbicacion,
  actionRegistrarConsentimientoUbicacion,
} from "./[pedidoId]/actions";

// =============================================================================
// Constantes
// =============================================================================

const INTERVALO_PING_MS = 90_000; // 90 segundos (entre 60 y 120, como indica el spec)
const STORAGE_KEY_CONSENTIMIENTO = "rutax_ubicacion_consentimiento";

// =============================================================================
// Props
// =============================================================================

interface Props {
  /** El ping solo está activo cuando el manifiesto está en ruta. */
  manifiestoEnRuta: boolean;
}

// =============================================================================
// Componente
// =============================================================================

export function PingUbicacion({ manifiestoEnRuta }: Props) {
  // Leer consentimiento previo (solo en el cliente)
  const [consentimiento, setConsentimiento] = useState<"pendiente" | "aceptado" | "rechazado">("pendiente");
  const [mostrarModal, setMostrarModal] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const montadoRef = useRef(true);

  // Inicializar estado de consentimiento desde localStorage (store client-only).
  // Se hace en effect, no en initializer lazy, para no romper la hidratación SSR
  // (localStorage no existe en el servidor). El setState síncrono es intencional
  // y se ejecuta una sola vez al montar — no causa cascada relevante.
  useEffect(() => {
    const guardado = localStorage.getItem(STORAGE_KEY_CONSENTIMIENTO);
    if (guardado === "aceptado" || guardado === "rechazado") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConsentimiento(guardado);
    } else if (manifiestoEnRuta) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMostrarModal(true);
    }
  }, [manifiestoEnRuta]);

  // --- Función de ping GPS (sin logear coordenadas) ---
  const enviarPing = useCallback(async () => {
    if (!manifiestoEnRuta || document.visibilityState !== "visible") return;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!montadoRef.current) return;
        const fd = new FormData();
        fd.set("lat", String(pos.coords.latitude));
        fd.set("long", String(pos.coords.longitude));
        if (pos.coords.accuracy) fd.set("precisionM", String(pos.coords.accuracy));
        // Ignoramos errores del ping — no bloquea la UX
        await actionPingUbicacion(fd).catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [manifiestoEnRuta]);

  // --- Activar/desactivar ping según consentimiento y estado del manifiesto ---
  useEffect(() => {
    montadoRef.current = true;

    if (consentimiento !== "aceptado" || !manifiestoEnRuta) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Ping inmediato al activar
    enviarPing();

    // Ping periódico
    intervalRef.current = setInterval(enviarPing, INTERVALO_PING_MS);

    // Escuchar cambios de visibilidad: no pingar en segundo plano
    const handleVisibilidad = () => {
      if (document.visibilityState === "visible") enviarPing();
    };
    document.addEventListener("visibilitychange", handleVisibilidad);

    return () => {
      montadoRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilidad);
    };
  }, [consentimiento, manifiestoEnRuta, enviarPing]);

  // --- Borrar ubicación al desmontar si estaba en ruta ---
  useEffect(() => {
    return () => {
      if (consentimiento === "aceptado" && manifiestoEnRuta) {
        actionBorrarUbicacion().catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Aceptar consentimiento ---
  const handleAceptar = useCallback(async () => {
    localStorage.setItem(STORAGE_KEY_CONSENTIMIENTO, "aceptado");
    setConsentimiento("aceptado");
    setMostrarModal(false);
    await actionRegistrarConsentimientoUbicacion(true).catch(() => undefined);
  }, []);

  // --- Rechazar consentimiento ---
  const handleRechazar = useCallback(async () => {
    localStorage.setItem(STORAGE_KEY_CONSENTIMIENTO, "rechazado");
    setConsentimiento("rechazado");
    setMostrarModal(false);
    await actionRegistrarConsentimientoUbicacion(false).catch(() => undefined);
  }, []);

  if (!mostrarModal) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-ubicacion-titulo"
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg rounded-t-2xl bg-card border border-border shadow-xl pb-safe">
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        <div className="px-5 pb-8 pt-2 space-y-4">
          {/* Icono y título */}
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-subtle">
              <MapPin className="size-5 text-info-subtle-foreground" aria-hidden="true" />
            </div>
            <div>
              <h2 id="modal-ubicacion-titulo" className="text-base font-semibold">
                Tu ubicación mientras estás en ruta
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Necesitamos saber dónde estás para coordinar tus entregas de forma segura.
              </p>
            </div>
          </div>

          {/* Detalles del consentimiento */}
          <ul className="space-y-2 text-sm text-muted-foreground" aria-label="Detalles del uso de tu ubicación">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
              Solo registramos tu posición en este momento, no tu historial de movimientos.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
              Se elimina automáticamente cuando terminas tu ruta o cierras sesión.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
              Solo los coordinadores de tu courier pueden verla. Los clientes y vendedores no tienen acceso.
            </li>
          </ul>

          {/* Acciones */}
          <div className="flex flex-col gap-2 pt-1">
            <Button
              type="button"
              onClick={handleAceptar}
              className="min-h-[52px] w-full rounded-xl text-base font-bold"
            >
              Compartir mi ubicación
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleRechazar}
              className="min-h-[48px] w-full rounded-xl text-sm text-muted-foreground"
            >
              <X className="mr-2 size-4" aria-hidden="true" />
              Rechazar por ahora
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
