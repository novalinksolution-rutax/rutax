import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { FormularioRecuperar } from "./formulario-recuperar";
import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
};

/**
 * Paso 1 de 2 — pedir el enlace de recuperación. Pública: quien llega aquí,
 * por definición, no puede iniciar sesión.
 *
 * Si YA hay sesión activa no tiene sentido recuperar nada — se le manda a su
 * área, igual que hace `/login`.
 */
export default async function PaginaRecuperarContrasena() {
  const sesion = await obtenerSesionActual();
  if (sesion?.usuario.tenantId) {
    redirect("/");
  }

  return (
    <PantallaSinSesion marca={{ tipo: "neutra" }}>
      <FormularioRecuperar />
    </PantallaSinSesion>
  );
}
