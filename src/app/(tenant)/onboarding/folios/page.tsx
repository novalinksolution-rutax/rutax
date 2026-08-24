import { redirect } from "next/navigation";

/**
 * Enlace directo al paso «folios» del asistente.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTO YA NO ES UNA PANTALLA
 * -----------------------------------------------------------------------------
 * El cuerpo del paso ahora vive dentro del asistente, bajo la lista de los
 * cinco: así el dueño no pierde de vista dónde está ni qué le falta. Mantener
 * ADEMÁS una pantalla suelta con el mismo formulario significaría dos
 * implementaciones del mismo paso, y la de menos tráfico se queda atrás sin que
 * nadie lo note.
 *
 * La ruta se conserva porque **los enlaces guardados tienen que seguir
 * funcionando** —los hay en correos, en la documentación y en el historial del
 * navegador— y porque el guard de capacidad de cada paso sigue siendo el mismo,
 * solo que ahora se aplica una vez, en el asistente.
 */
export default function PasoDirecto() {
  redirect("/onboarding?paso=folios");
}
