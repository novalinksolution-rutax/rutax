import type { MetadataRoute } from "next";

/** Las páginas públicas del sitio comercial. `/agendar` queda fuera: es el fondo del embudo. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://rutax.io";
  const paginas: [string, number][] = [
    ["/", 1],
    ["/integraciones/mercado-libre-flex", 0.9],
    ["/integraciones/shopify", 0.8],
    ["/cobros-y-liquidaciones", 0.8],
    ["/precios", 0.8],
    ["/terminos", 0.2],
    ["/privacidad", 0.2],
  ];
  return paginas.map(([ruta, prioridad]) => ({ url: `${base}${ruta}`, changeFrequency: "monthly", priority: prioridad }));
}
