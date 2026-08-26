/**
 * Layout del portal del seller — mismo AppShell (sidebar + barra superior) que
 * usa el backoffice del courier, para consistencia visual entre módulos.
 *
 * Nota: el seller tiene un único rol (sin variantes RBAC como el courier), así
 * que la navegación es fija — no hay filtrado por capacidad como en
 * `(tenant)/layout.tsx`.
 */

import { UserRound } from "lucide-react";
import { cerrarSesion } from "@/lib/identidad/cerrar-sesion";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerAvisosSeller } from "@/lib/avisos/obtener-avisos-seller";
import { AppShell, type GrupoNav } from "@/components/app-shell/app-shell";
import { destinosMovil } from "@/components/app-shell/destinos-movil";

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
        { href: "/portal/bodegas", etiqueta: "Bodegas", icono: "bodegas" },
        { href: "/portal/incidencias", etiqueta: "Incidencias", icono: "incidencias" },
      ],
    },
    {
      titulo: "Dinero",
      // «Mis cobros», igual que el `h1` y que la pestaña. «Estado de cuenta»
      // es lenguaje de banco, y además no cabía en la barra inferior del
      // teléfono: se cortaba en «Estado de cuen…».
      items: [{ href: "/portal/cobros", etiqueta: "Mis cobros", icono: "cobros" }],
    },
  ];

  return (
    <AppShell
      nombreFantasia={(seller?.razon_social as string | undefined) ?? "Portal del seller"}
      nombreCompleto={sesion.nombreCompleto}
      subtituloCuenta="Seller"
      etiquetaMarca="Tienda"
      densidad="relajada"
      grupos={grupos}
      /* «Mi perfil» vive en el bloque de cuenta del pie del sidebar, igual que
         en el backoffice del courier (encargo del usuario, 26-08-2026: que el
         bloque con tu nombre lleve a alguna parte, en todos los roles).

         ⚠️ Y salió del grupo «Mi cuenta» de la navegación: tenerlo en los dos
         sitios es la misma duplicación que el usuario ya reclamó con «Mi plan»
         apareciendo tres veces. El sitio donde alguien busca sus propios datos
         es donde está su nombre.

         ⚠️ El ícono va YA RENDERIZADO, no como componente: este layout es de
         servidor y una función no cruza la frontera hacia un Client Component
         — se lleva por delante todo lo que el layout envuelve, con typecheck y
         lint en verde. */
      enlacesCuenta={[
        {
          href: "/portal/perfil",
          etiqueta: "Mi perfil",
          subtitulo: "Tus datos y tus avisos",
          icono: <UserRound className="size-4" aria-hidden="true" />,
        },
      ]}
      accionSalir={async () => {
        "use server";
        await cerrarSesion("/portal/login");
      }}
      avisos={avisos}
      destinosMovil={destinosMovil(grupos.flatMap((g) => g.items))}
      // El seller ve el botón de buscar y la paleta ⌘K, pero `/api/buscar` corta
      // por `tipoUsuario !== "interno"` y le devuelve vacío SIEMPRE. Una pantalla
      // no promete una acción que la interfaz no ofrece (regla 35), así que se
      // apaga hasta que exista el buscador global del portal (NUEVO #21). El
      // buscador de «Mis pedidos» es local a esa pantalla, no éste.
      mostrarBusqueda={false}
    >
      {children}
    </AppShell>
  );
}
