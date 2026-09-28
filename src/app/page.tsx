import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { Portada } from "./(marketing)/portada";
import { PRECIO_POR_ENVIO_CLP } from "./(marketing)/_lib/precio";

/**
 * La raíz hace DOS cosas, y por eso no se partió en dos archivos.
 * =============================================================================
 *
 * · **Con sesión** — reparte por tipo de usuario, como siempre.
 * · **Sin sesión** — muestra la portada.
 *
 * Antes, sin sesión, mandaba a `/login`: un courier que llegaba a `rutax.io`
 * encontraba un formulario y **ninguna forma de saber qué es esto**. El registro
 * no tenía un solo enlace entrante (brecha #9).
 *
 * ⚠️ **La portada NO puede vivir en una ruta aparte** —`/inicio`, `(marketing)/`
 * con su propio `page.tsx`— porque las dos cosas responden a la MISMA URL. Si
 * fueran dos rutas, la raíz tendría que elegir a cuál redirigir, y una redirección
 * es un viaje de más justo en la petición que decide si el visitante se queda.
 */
export const metadata: Metadata = {
  title: "Rutax · Tu operación de reparto, de la colecta a la entrega",
  alternates: { canonical: "/" },
  description:
    `Software para couriers de última milla en Chile: recibe los pedidos de tus clientes y gestiona retiros, rutas, entregas y liquidaciones en un solo lugar. ${formatearCLP(PRECIO_POR_ENVIO_CLP)} + IVA por envío.`,
};

export default async function Home() {
  const sesion = await obtenerSesionActual();

  // Sin sesión: la portada. No una redirección al login.
  if (!sesion) {
    return <Portada />;
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
