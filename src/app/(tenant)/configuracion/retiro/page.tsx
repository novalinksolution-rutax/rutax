import { redirect } from "next/navigation";

/**
 * `/configuracion/retiro` — ahora es una sección de Tarifas.
 *
 * ⚠️ La ruta se conserva y redirige; no se borra. Ver el porqué en
 * `configuracion/zonas/page.tsx`.
 */
export default function RedirigirRetiro() {
  redirect("/configuracion/tarifas?seccion=retiro");
}
