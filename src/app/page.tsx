import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";

/**
 * Punto de entrada: redirige al área correcta según el tipo de usuario,
 * o a /login si no hay sesión activa.
 */
export default async function Home() {
  const sesion = await obtenerSesionActual();

  if (!sesion) {
    redirect("/login");
  }

  switch (sesion.usuario.tipoUsuario) {
    case "conductor":
      redirect("/conductor");
    case "seller":
      redirect("/portal");
    default:
      // interno (dueno, supervisor, coordinador, administracion)
      redirect("/dashboard");
  }
}
