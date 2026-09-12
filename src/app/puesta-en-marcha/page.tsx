import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { resolverEstadoPuestaEnMarcha, PASOS_PUESTA_EN_MARCHA } from "./estado";
import { Wizard } from "./wizard";

export const metadata: Metadata = {
  title: "Puesta en marcha",
};

/**
 * El wizard obligatorio de puesta en marcha. El layout ya garantizó sesión,
 * tenant, que es el dueño y que aún no la completó. Acá se resuelve el estado de
 * los ocho pasos y se abre en el primero pendiente.
 */
export default async function PaginaPuestaEnMarcha() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  const estado = await resolverEstadoPuestaEnMarcha(sesion.usuario.tenantId);
  const indiceInicial = Math.max(0, PASOS_PUESTA_EN_MARCHA.indexOf(estado.primerPendiente));

  return <Wizard iniciales={estado.iniciales} indiceInicial={indiceInicial} />;
}
