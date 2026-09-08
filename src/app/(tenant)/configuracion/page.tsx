import { redirect } from "next/navigation";

/**
 * `/configuracion` ya no tiene pantalla propia.
 * =============================================================================
 * Las opciones de configuración se abren desde la barra lateral (el botón
 * «Configuración» despliega la navegación anidada con Tarifas, Bodegas, Equipo,
 * etc.), así que el índice que listaba las secciones era una puerta de más.
 *
 * Se conserva la ruta como REDIRECCIÓN —y no se borra— para que cualquier
 * enlace viejo o marcador a `/configuracion` caiga en una sección real en vez
 * de una 404. La herramienta de QA que vivía al pie de este índice se movió a la
 * barra lateral (ver `_componentes/lanzador-herramienta-prueba.tsx`).
 */
export default function ConfiguracionIndex() {
  redirect("/configuracion/tarifas");
}
