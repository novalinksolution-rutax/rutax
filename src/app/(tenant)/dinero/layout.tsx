/**
 * Layout de la sección Dinero — solo para roles internos con capacidades financieras.
 *
 * Redirige a /dashboard si el usuario no tiene permisos de facturación
 * ni de liquidaciones. La autorización real vive en el backend (RLS), pero
 * redirigir aquí evita mostrar una sección vacía a roles sin acceso.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
  puedeVerConciliacion,
} from "@/modules/identidad/capacidades";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarEventosConciliacion } from "@/modules/dinero/index";

export default async function LayoutDinero({
  children,
}: {
  children: React.ReactNode;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  // Solo roles internos con acceso financiero
  const tieneAcceso =
    puedeEmitirFacturas(sesion.usuario) ||
    puedeGestionarLiquidacionesConductores(sesion.usuario) ||
    puedeVerConciliacion(sesion.usuario);

  if (!tieneAcceso) {
    redirect("/dashboard");
  }

  const tenantId = sesion.usuario.tenantId;

  // Badge de conciliación pendiente
  let pendientesConciliacion = 0;
  if (puedeVerConciliacion(sesion.usuario)) {
    try {
      const cliente = crearClienteServiceRole();
      const eventos = await listarEventosConciliacion(cliente, tenantId, "pendiente");
      pendientesConciliacion = eventos.length;
    } catch {
      // No bloquear la navegación si falla el conteo
    }
  }

  const navItems: { href: string; etiqueta: string; badge?: number; mostrar: boolean }[] = [
    {
      href: "/dinero/periodos",
      etiqueta: "Períodos de cobro",
      mostrar: puedeEmitirFacturas(sesion.usuario),
    },
    {
      href: "/dinero/liquidaciones",
      etiqueta: "Liquidaciones",
      mostrar: puedeGestionarLiquidacionesConductores(sesion.usuario),
    },
    {
      href: "/dinero/conciliacion",
      etiqueta: "Conciliación",
      badge: pendientesConciliacion > 0 ? pendientesConciliacion : undefined,
      mostrar: puedeVerConciliacion(sesion.usuario),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Navegación interna de la sección Dinero */}
      <nav
        aria-label="Sección Dinero"
        className="flex flex-wrap gap-1 border-b pb-3"
      >
        {navItems
          .filter((item) => item.mostrar)
          .map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {item.etiqueta}
              {item.badge !== undefined && (
                <span
                  aria-label={`${item.badge} pendiente${item.badge !== 1 ? "s" : ""}`}
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-xs font-bold text-warning-foreground"
                >
                  {item.badge}
                </span>
              )}
            </Link>
          ))}
      </nav>

      {children}
    </div>
  );
}
