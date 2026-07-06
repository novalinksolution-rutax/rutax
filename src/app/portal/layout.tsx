/**
 * Layout del portal del seller — mismo AppShell (sidebar + barra superior) que
 * usa el backoffice del courier, para consistencia visual entre módulos.
 *
 * Nota: el seller tiene un único rol (sin variantes RBAC como el courier), así
 * que la navegación es fija — no hay filtrado por capacidad como en
 * `(tenant)/layout.tsx`.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerAvisosSeller } from "@/lib/avisos/obtener-avisos-seller";
import { AppShell, type GrupoNav } from "@/components/app-shell/app-shell";

export default async function LayoutPortal({
  children,
}: {
  children: React.ReactNode;
}) {
  const sesion = await obtenerSesionActual();

  if (!sesion) {
    redirect("/login");
  }
  if (sesion.usuario.estado === "invitado") {
    redirect("/activar-cuenta");
  }
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    redirect("/");
  }

  const cliente = crearClienteServiceRole();
  const [{ data: seller }, avisos] = await Promise.all([
    cliente
      .from("sellers")
      .select("razon_social")
      .eq("id", sesion.usuario.sellerId)
      .eq("tenant_id", sesion.usuario.tenantId)
      .maybeSingle(),
    obtenerAvisosSeller(sesion.usuario.sellerId),
  ]);

  // Agrupada por objetivo, mismo patrón que (tenant)/layout.tsx: "Inicio" suelto
  // arriba (como "Dashboard" en el backoffice), luego Operación y Dinero.
  const grupos: GrupoNav[] = [
    {
      titulo: null,
      items: [{ href: "/portal", etiqueta: "Inicio", icono: "inicio" }],
    },
    {
      titulo: "Operación",
      items: [
        { href: "/portal/pedidos", etiqueta: "Mis pedidos", icono: "pedidos" },
        { href: "/portal/incidencias", etiqueta: "Incidencias", icono: "incidencias" },
      ],
    },
    {
      titulo: "Dinero",
      items: [{ href: "/portal/cobros", etiqueta: "Estado de cuenta", icono: "cobros" }],
    },
  ];

  return (
    <AppShell
      nombreFantasia={(seller?.razon_social as string | undefined) ?? "Portal del seller"}
      nombreCompleto={sesion.nombreCompleto}
      grupos={grupos}
      avisos={avisos}
    >
      {children}
    </AppShell>
  );
}
