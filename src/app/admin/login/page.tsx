import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { exigirSuperAdmin } from "@/modules/plataforma/autorizacion-admin";

export const metadata: Metadata = {
  title: "Iniciar sesión · Rutax Admin",
};

/**
 * Ruta de login del backstage. El formulario de acceso lo renderiza el layout
 * cuando no hay sesión válida de super-admin (protección uniforme de todo
 * `/admin/*`), así que esta página solo necesita resolver el caso "ya
 * autenticado" → al panel (el layout decide, ahí, si además hace falta
 * enrolamiento/step-up de MFA antes de mostrar contenido).
 *
 * `exigirSuperAdmin()` NO exige AAL2 — a propósito: un super-admin que ya iba
 * a `/admin/login` con una sesión válida pero sin MFA verificado igual debe
 * salir de esta página (el layout es quien lo enruta al prompt correcto), no
 * quedarse viendo el formulario de login de nuevo.
 */
export default async function AdminLoginPage() {
  let autenticado = false;
  try {
    await exigirSuperAdmin();
    autenticado = true;
  } catch {
    autenticado = false;
  }

  // `redirect()` lanza un error especial (`NEXT_REDIRECT`) — se llama FUERA
  // del `try` de arriba para que no lo intercepte el `catch` (gotcha conocido
  // de Next.js App Router).
  if (autenticado) {
    redirect("/admin/suscripciones");
  }

  // Sin sesión válida: el layout muestra el formulario de login; nada que renderizar aquí.
  return null;
}
