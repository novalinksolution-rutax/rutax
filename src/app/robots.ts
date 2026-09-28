import type { MetadataRoute } from "next";

/**
 * Se indexa el sitio comercial y nada más. Lo que va en `disallow` son áreas con
 * sesión (no aportan nada a un buscador) y, sobre todo, `/tracking/`: su token es
 * público y viaja en el enlace que recibe el destinatario, así que esas páginas
 * no pueden aparecer en resultados.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/tracking/", "/api/", "/admin", "/portal", "/conductor", "/login", "/registro", "/invitacion", "/oauth", "/auth", "/dev", "/kitchen-sink", "/agendar"],
    },
    sitemap: "https://rutax.io/sitemap.xml",
  };
}
