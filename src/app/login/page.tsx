import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { FormularioLogin } from "./formulario-login";
import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";

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
    <PantallaSinSesion marca={{ tipo: "neutra" }}>
      <FormularioLogin />
    </PantallaSinSesion>
  );
}
