import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { FormularioRecuperar } from "./formulario-recuperar";

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
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <FormularioRecuperar />
    </div>
  );
}
