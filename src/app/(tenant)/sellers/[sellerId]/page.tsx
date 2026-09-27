import { redirect } from "next/navigation";

/**
 * La ficha del seller ya no es una página: es el panel lateral del listado
 * (decisión del usuario, 2026-09-27). La ruta se conserva porque la enlazan el
 * correo de conexión caída y el detalle de un pedido; redirige al listado con
 * `?seller=`, que abre el panel.
 */
export default async function RedirigirFichaSeller({
  params,
}: {
  params: Promise<{ sellerId: string }>;
}) {
  const { sellerId } = await params;
  redirect(`/sellers?seller=${encodeURIComponent(sellerId)}`);
}
