import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { Portada } from "./(marketing)/portada";

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
  title: "Rutax · La operación y el dinero de tu courier, en un solo sistema",
  description:
    "Software de última milla para couriers de Santiago. Centraliza los pedidos de Mercado Libre Flex, Shopify y los tuyos, despáchalos con tu flota, y deja hecha la factura al seller y la liquidación del conductor.",
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
