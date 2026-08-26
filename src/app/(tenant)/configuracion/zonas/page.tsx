import { redirect } from "next/navigation";

/**
 * `/configuracion/zonas` — ahora es una sección de Tarifas.
 *
 * ⚠️ **La ruta se conserva y redirige; no se borra.** Hay marcadores guardados y
 * enlaces dentro del propio producto —el índice de configuración, el asistente
 * de puesta en marcha— y una ruta que empieza a dar 404 después de una
 * reorganización interna es un fallo que nadie ve hasta que un courier lo
 * reporta.
 *
 * `redirect` es permanente en intención pero **no** se marca 308: si algún día
 * las zonas vuelven a tener pantalla propia, un 308 cacheado en el navegador de
 * cada courier seguiría mandándolos acá.
 */
export default function RedirigirZonas() {
  redirect("/configuracion/tarifas?seccion=zonas");
}
