import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";
import { IngresaCodigoRegistro } from "./ingresa-codigo-registro";

export const metadata: Metadata = {
  title: "Ingresa tu código",
};

interface PageProps {
  searchParams: Promise<{ email?: string }>;
}

/**
 * Segundo paso de "Enviar código por correo" en `/registro` (F1, login sin
 * contraseña). Antes esta ruta decía "revisa tu correo para crear tu
 * contraseña" y era un callejón sin salida (solo un botón de reenviar). Ahora
 * es la vista donde se ingresa el código de 6 dígitos, con el mismo
 * componente compartido (`IngresaCodigo`) que usa `/login`.
 *
 * ⚠️ Sin `email` en la URL no hay a quién verificarle nada — se redirige de
 * vuelta al formulario en vez de mostrar una pantalla rota.
 */
export default async function PaginaRevisaTuCorreo({ searchParams }: PageProps) {
  const { email } = await searchParams;
  if (!email) {
    redirect("/registro");
  }

  return (
    <PantallaSinSesion marca={{ tipo: "rutax" }}>
      <IngresaCodigoRegistro email={email} />
    </PantallaSinSesion>
  );
}
