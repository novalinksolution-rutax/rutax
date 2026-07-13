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
    case "super_admin":
      // F3-A: el super-admin ahora tiene sesión Supabase real (antes solo
      // existía como secreto compartido de `/admin`, nunca aterrizaba aquí).
      // Sin este caso cae en el `default` → `/dashboard`, y el layout
      // `(tenant)` lo rebota por no tener `tenantId` — bucle de redirects.
      // `/admin` no tiene `page.tsx` propio (solo layout) — se redirige a la
      // primera pantalla real del backstage, igual que `admin/login/page.tsx`.
      redirect("/admin/suscripciones");
    default:
      // interno (dueno, supervisor, coordinador, administracion)
      redirect("/dashboard");
  }
}
