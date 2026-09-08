/**
 * Vista del manifiesto — deep-link (Flujo 2).
 * =============================================================================
 * Server Component delgado: carga el payload compartido y lo pinta con el mismo
 * renderer que usa el panel lateral del listado (`ContenidoManifiesto`), para
 * que la página y el panel no puedan divergir.
 *
 * La página se conserva como destino de enlaces directos y del botón atrás; el
 * uso habitual —tocar una fila— abre el panel sin salir del listado.
 */

import { notFound, redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { Retorno, destinoRetorno } from "@/components/app-shell/retorno";
import { cargarDetalleManifiesto } from "./datos-detalle";
import { ContenidoManifiesto } from "./contenido-manifiesto";

interface Props {
  params: Promise<{ manifiestoId: string }>;
  searchParams: Promise<{ volver?: string }>;
}

export default async function PaginaDetalleManifiesto({ params, searchParams }: Props) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  const { manifiestoId } = await params;
  const { volver } = await searchParams;

  const datos = await cargarDetalleManifiesto(
    crearClienteServiceRole(),
    sesion.usuario.tenantId,
    sesion.usuario,
    manifiestoId,
  );

  if (!datos) notFound();

  return (
    <div className="space-y-6">
      <Retorno href={destinoRetorno("/manifiestos", volver)} etiqueta="Volver a manifiestos" />
      <ContenidoManifiesto datos={datos} />
    </div>
  );
}
