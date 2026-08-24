import type { MetadataRoute } from "next";

/**
 * Manifest de la aplicación web.
 * =============================================================================
 *
 * Nació como el manifiesto de la **PWA del conductor** y arrancaba en
 * `/conductor`, su ruta del día. Esa PWA se retiró el 24-08-2026: el conductor
 * trabaja en la app nativa, y este manifiesto quedaría prometiendo una
 * aplicación instalable que al abrirse dice «tu trabajo está en la app».
 *
 * Ahora describe **el producto web**, que es del courier: arranca en la raíz y
 * cada tipo de usuario aterriza donde le toca. Se conserva instalable porque un
 * coordinador con Rutax anclado en su escritorio es exactamente el uso que
 * tiene, y porque sin manifiesto se pierden el ícono y el color de la barra.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rutax",
    short_name: "Rutax",
    description: "La operación y la trastienda de dinero de tu courier.",
    // La raíz, no `/conductor`: `src/app/page.tsx` reparte por tipo de usuario.
    start_url: "/",
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
