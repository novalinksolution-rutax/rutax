import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { FormularioRecuperar } from "./formulario-recuperar";
import { MarcoPuerta } from "@/app/login/marco-puerta";

export const metadata: Metadata = {
  // El título dice el resultado, no el trámite — igual que el de la pantalla.
  title: "Cambia tu contraseña",
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
    // ⚠️ Mismo marco que el login, no `PantallaSinSesion`: «no es un flujo
    // aparte, es la misma puerta con otro cuerpo». Y con eso la marca deja de
    // ser `neutra` y pasa a ser la completa, que es la del marco.
    <MarcoPuerta>
      <FormularioRecuperar />
    </MarcoPuerta>
  );
}
