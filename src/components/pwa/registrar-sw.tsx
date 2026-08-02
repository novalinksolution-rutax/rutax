"use client";

import { useEffect } from "react";

/**
 * Registra el service worker de la PWA (T-4). Componente invisible: se monta en
 * el área del conductor para habilitar instalabilidad y el fallback offline.
 * Falla en silencio si el navegador no soporta service workers.
 */
export function RegistrarSW() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const id = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Sin SW no se rompe nada: la app sigue funcionando en línea.
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  return null;
}
