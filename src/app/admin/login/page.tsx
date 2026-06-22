import { redirect } from "next/navigation";
import { tieneSesionAdmin } from "../sesion-admin";

/**
 * Ruta de login del backstage. El formulario de acceso lo renderiza el layout
 * cuando no hay sesión (protección uniforme de todo `/admin/*`), así que esta
 * página solo necesita resolver el caso "ya autenticado" → al panel.
 */
export default async function AdminLoginPage() {
  if (await tieneSesionAdmin()) {
    redirect("/admin/suscripciones");
  }
  // Sin sesión: el layout muestra el formulario de login; nada que renderizar aquí.
  return null;
}
