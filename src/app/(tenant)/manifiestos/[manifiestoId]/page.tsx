import { redirect } from "next/navigation";

/**
 * El detalle del manifiesto ya no es una pantalla propia.
 * =============================================================================
 * Todo lo que mostraba —ruta, acciones y bitácora— vive ahora en el panel
 * lateral que se abre al tocar una fila del listado. Esta ruta se conserva solo
 * como REDIRECCIÓN: cualquier enlace viejo o marcador a `/manifiestos/[id]`
 * cae en el listado con el panel de ese manifiesto abierto (`?abrir=`), en vez
 * de una 404.
 *
 * Las piezas de este directorio (`contenido-manifiesto`, `datos-detalle`,
 * `panel-ruta`, `boton-*`) siguen aquí: las usa el panel. Un directorio de ruta
 * sin `page.tsx` propio no es una pantalla, y el redirect de arriba es el único
 * `page.tsx` que queda.
 */
export default async function DetalleManifiestoRedirect({
  params,
}: {
  params: Promise<{ manifiestoId: string }>;
}) {
  const { manifiestoId } = await params;
  redirect(`/manifiestos?abrir=${manifiestoId}`);
}
