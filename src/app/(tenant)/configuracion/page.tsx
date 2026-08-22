import { redirect } from "next/navigation";

/**
 * `/configuracion` — hasta ahora, un 404.
 *
 * Las nueve pantallas de configuración viven bajo `/configuracion/*` y el
 * sidebar entra a la sub-navegación anidada, pero **la raíz no existía**: quien
 * borraba el último segmento de la URL, o seguía un enlace viejo, se encontraba
 * con la 404 del framework, en inglés y sin marca.
 *
 * Redirige al hub real, que hoy es «Puesta en marcha» — es la pantalla que
 * enumera el estado de la configuración del courier y desde la que se llega a
 * todas las demás. **No es la pantalla definitiva:** el rediseño le da a
 * configuración su propio índice (bloque de diseño B3b), y cuando exista, este
 * archivo pasa a renderizarlo en vez de redirigir.
 */
export default function ConfiguracionIndex() {
  redirect("/onboarding");
}
