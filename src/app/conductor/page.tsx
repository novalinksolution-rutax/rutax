/**
 * Punto de entrada de la PWA del conductor.
 * Redirige directamente al manifiesto activo del día.
 */

import { redirect } from "next/navigation";

export default function PaginaConductorRaiz() {
  redirect("/conductor/manifiesto");
}
