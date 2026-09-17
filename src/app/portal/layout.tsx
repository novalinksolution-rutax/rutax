/**
 * Layout del portal del seller — mismo AppShell (sidebar + barra superior) que
 * usa el backoffice del courier, para consistencia visual entre módulos.
 *
 * Nota: el seller tiene un único rol (sin variantes RBAC como el courier), así
 * que la navegación es fija — no hay filtrado por capacidad como en
 * `(tenant)/layout.tsx`.
 */

import { ArrowLeftRight, UserRound } from "lucide-react";
import { cerrarSesion } from "@/lib/identidad/cerrar-sesion";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerAvisosSeller } from "@/lib/avisos/obtener-avisos-seller";
import { AppShell, type GrupoNav } from "@/components/app-shell/app-shell";
import { destinosMovil } from "@/components/app-shell/destinos-movil";
import { listarMisMembresiasSeller } from "@/modules/identidad/seller-membresias";
import type { EnlaceMenuCuenta } from "@/components/app-shell/menu-cuenta";

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
    // F1 retiró `/activar-cuenta` (ver `(tenant)/layout.tsx` para el mismo
    // cambio y su razón) — fallback defensivo al login.
    redirect("/login");
  }
  if (sesion.usuario.estado === "suspendido") {
    // Cuenta/membresía dada de baja desde `/admin/cuentas`. Ver el comentario
    // gemelo en `(tenant)/layout.tsx`. Va a `/login` directo y no a
    // `/portal/login`: esa ruta solo redirige a `/login` sin arrastrar el
    // query string (es `neutra` — no sabe de qué courier se trata todavía).
    redirect("/login?error=cuenta_suspendida");
  }
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    redirect("/");
  }

  const cliente = crearClienteServiceRole();
  const [{ data: seller }, avisos, membresias] = await Promise.all([
    cliente
      .from("sellers")
      .select("razon_social")
      .eq("id", sesion.usuario.sellerId)
      .eq("tenant_id", sesion.usuario.tenantId)
      .maybeSingle(),
    obtenerAvisosSeller(sesion.usuario.sellerId),
    // Multi-courier (RF-010 rediseño): el switcher solo se muestra con MÁS de
    // una membresía — con una sola no hay nada que elegir (CLAUDE.md: "no
    // recargar la UI cuando hay una sola"). Fallo silencioso a `[]`: no vale
    // la pena tumbar todo el portal por no poder mostrar un enlace opcional.
    listarMisMembresiasSeller(cliente, sesion.usuarioId, sesion.usuario.tenantId).catch(() => []),
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

  // Mismo criterio que "Mi perfil": el ícono va YA RENDERIZADO porque este
  // layout es de SERVIDOR y `EnlaceMenuCuenta` lo consume un Client Component
  // (`MenuCuenta`) — pasar el componente sin renderizar tumba el árbol entero
  // (gotcha ya mordido el 2026-08-14, ver `menu-cuenta.tsx`).
  const enlacesCuenta: EnlaceMenuCuenta[] = [
    {
      href: "/portal/perfil",
      etiqueta: "Mi perfil",
      subtitulo: "Tus datos y tus avisos",
      icono: <UserRound className="size-4" aria-hidden="true" />,
    },
  ];
  if (membresias.length > 1) {
    enlacesCuenta.push({
      href: "/portal/seleccionar-courier",
      etiqueta: "Cambiar de courier",
      subtitulo: `Eres seller de ${membresias.length} couriers`,
      icono: <ArrowLeftRight className="size-4" aria-hidden="true" />,
    });
  }

  return (
    <AppShell
      nombreFantasia={(seller?.razon_social as string | undefined) ?? "Portal del seller"}
      nombreCompleto={sesion.nombreCompleto}
      subtituloCuenta="Seller"
      etiquetaMarca="Tienda"
      densidad="relajada"
      grupos={grupos}
      // «Mi perfil» vive en el bloque de cuenta del pie del sidebar, igual que
      // en el backoffice del courier (encargo del usuario, 26-08-2026: que el
      // bloque con tu nombre lleve a alguna parte, en todos los roles). Con
      // más de una membresía, «Cambiar de courier» se suma al lado — ver
      // `enlacesCuenta` más arriba.
      enlacesCuenta={enlacesCuenta}
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
