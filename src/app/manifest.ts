import type { MetadataRoute } from "next";

/**
 * Manifest de la PWA (T-4). Next.js enlaza este manifiesto automáticamente
 * (`<link rel="manifest">`). Pensado para el conductor: arranca en su ruta del
 * día, pantalla completa, identidad navy de Rutax.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rutax — Conductor",
    short_name: "Rutax",
    description: "Tu ruta del día y tus liquidaciones.",
    start_url: "/conductor",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // El papel del tema claro, no blanco puro: es el fondo real del producto.
    background_color: "#F1F6F6",
    // Tinta de la marca nueva. Antes `#1e3a8a`, navy de la identidad anterior.
    theme_color: "#0B1114",
    lang: "es-CL",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
