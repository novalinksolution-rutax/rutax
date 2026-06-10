import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { FormularioLogin } from "./formulario-login";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default async function PaginaLogin() {
  const sesion = await obtenerSesionActual();
  if (sesion?.usuario.tenantId) {
    // Ya autenticado — redirigir al área correcta según tipo de usuario
    redirect("/");
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <FormularioLogin />
    </div>
  );
}
