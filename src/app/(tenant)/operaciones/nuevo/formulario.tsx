/**
 * El formulario de alta same-day del courier.
 * =============================================================================
 * Delega en el compartido. La pieza vive en `components/operacion/` desde que el
 * portal del seller usa exactamente el mismo formulario —decisión del usuario,
 * 25-08-2026— y dos copias del mismo alta se separan sin que nadie lo note.
 *
 * Se mantiene este archivo, y no se cambian los importadores, porque el
 * formulario se monta en DOS sitios de esta superficie: la página
 * `/operaciones/nuevo` y el panel de acción del listado.
 */

export { FormularioAltaSameDay } from "@/components/operacion/formulario-alta-same-day";
