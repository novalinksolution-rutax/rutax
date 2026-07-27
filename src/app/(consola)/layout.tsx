import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";

/**
 * Área de CONSOLA — pantallas de operación a viewport completo.
 *
 * Por qué existe este grupo, separado de `(tenant)`
 * ------------------------------------------------------------------
 * `(tenant)` es el backoffice: sidebar fijo, `<main>` con `max-w-6xl` y padding,
 * scroll de página. Es el modelo correcto para pantallas de formulario, tablas y
 * configuración, y ahí siguen TODAS las pantallas nuevas del courier (la regla
 * de CLAUDE.md no cambia).
 *
 * La Torre de control no es una pantalla de backoffice: es un tablero que se
 * mira, no se recorre. Su diseño aprobado es una consola de viewport fijo donde
 * las regiones se reparten la altura y SOLO el riel scrollea. Ese contrato es
 * incompatible con un `<main>` que scrollea y una columna de ancho máximo: con
 * el shell encima, el mapa nunca recibe una altura determinada y el tablero
 * queda encajonado en el centro de la pantalla.
 *
 * Este grupo mantiene EXACTAMENTE los mismos guards de sesión y de tipo de
 * usuario que `(tenant)/layout.tsx` — salir del shell no puede significar salir
 * del control de acceso. Lo único que no hereda es el cromo: sin `AppShell`, sin
 * banner de onboarding y sin avisos, porque una consola a pantalla completa no
 * los tiene dónde poner. La capacidad RBAC fina (`ver_torre_control`) la
 * comprueba cada página del grupo, como antes.
 *
 * La navegación de vuelta al resto del producto la ofrece la propia consola en
 * su barra superior (R1) — ver `_componentes/r1-barra-superior.tsx`.
 */
export default async function LayoutConsola({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesionActual();

  if (!sesion) {
    redirect("/login");
  }
  if (sesion.usuario.estado === "invitado") {
    redirect("/activar-cuenta");
  }
  if (!sesion.usuario.tenantId) {
    redirect("/login");
  }
  // Conductores → su PWA, no el backoffice. Sellers → su portal.
  if (sesion.usuario.tipoUsuario === "conductor") {
    redirect("/conductor/manifiesto");
  }
  if (sesion.usuario.tipoUsuario === "seller") {
    redirect("/portal");
  }

  return children;
}
