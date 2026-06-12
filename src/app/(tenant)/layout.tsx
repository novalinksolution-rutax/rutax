import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import {
  puedeAsignarYReasignarPedidos,
  puedeAjustarOperacionDiaria,
  puedeVerReportesEjecutivos,
  puedeGenerarManifiestos,
  puedeGestionarUsuariosYRoles,
  puedeGestionarConfiguracionDte,
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
  puedeVerConciliacion,
  puedeVerBitacoraAuditoria,
} from "@/modules/identidad/capacidades";
import { BarraSuperior } from "@/components/app-shell/barra-superior";
import { BannerOnboarding } from "@/components/onboarding/banner-onboarding";
import { resolverEstadoOnboarding } from "@/app/(tenant)/onboarding/estado";

/**
 * Layout del área autenticada para roles internos del courier (dueño, supervisor,
 * coordinador, administración). Los conductores van a /conductor y los sellers
 * a /portal — nunca deben llegar aquí.
 *
 * Redirección por rol al iniciar sesión:
 * - dueno → /dashboard
 * - supervisor / coordinador → /operaciones
 * - administracion → /onboarding (sin sección operativa en este MVP)
 */
export default async function LayoutTenant({ children }: { children: React.ReactNode }) {
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

  // Conductores → su PWA, no el backoffice.
  if (sesion.usuario.tipoUsuario === "conductor") {
    redirect("/conductor/manifiesto");
  }
  // Sellers → su portal.
  if (sesion.usuario.tipoUsuario === "seller") {
    redirect("/portal");
  }

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("nombre_fantasia")
    .eq("id", sesion.usuario.tenantId)
    .maybeSingle();

  const esOperativo =
    puedeAsignarYReasignarPedidos(sesion.usuario) ||
    puedeGenerarManifiestos(sesion.usuario) ||
    puedeAjustarOperacionDiaria(sesion.usuario);

  const enlaces: { href: string; etiqueta: string }[] = [];

  if (puedeVerReportesEjecutivos(sesion.usuario)) {
    enlaces.push({ href: "/dashboard", etiqueta: "Dashboard" });
  }
  if (esOperativo) {
    enlaces.push({ href: "/operaciones", etiqueta: "Pedidos" });
    enlaces.push({ href: "/manifiestos", etiqueta: "Manifiestos" });
  }

  // Dinero — para roles financieros (Fase C)
  if (puedeEmitirFacturas(sesion.usuario)) {
    enlaces.push({ href: "/dinero/periodos", etiqueta: "Períodos" });
  }
  if (puedeGestionarLiquidacionesConductores(sesion.usuario)) {
    enlaces.push({ href: "/dinero/liquidaciones", etiqueta: "Liquidaciones" });
  }
  if (puedeVerConciliacion(sesion.usuario)) {
    enlaces.push({ href: "/dinero/conciliacion", etiqueta: "Conciliación" });
    enlaces.push({ href: "/dinero/cobranza", etiqueta: "Pagos" });
  }

  enlaces.push({ href: "/onboarding", etiqueta: "Onboarding" });
  if (puedeGestionarUsuariosYRoles(sesion.usuario)) {
    enlaces.push({ href: "/equipo", etiqueta: "Equipo" });
  }
  enlaces.push({ href: "/sellers", etiqueta: "Sellers" });
  if (puedeVerBitacoraAuditoria(sesion.usuario)) {
    enlaces.push({ href: "/configuracion/exportar-datos", etiqueta: "Exportar datos" });
  }

  const puedeActuarSobreOnboarding = puedeGestionarConfiguracionDte(sesion.usuario);
  const estadoOnboarding =
    puedeActuarSobreOnboarding && sesion.usuario.tenantId
      ? await resolverEstadoOnboarding(sesion.usuario.tenantId)
      : null;

  return (
    <div className="flex min-h-svh flex-col bg-muted/20">
      <BarraSuperior
        nombreFantasia={(tenant?.nombre_fantasia as string | undefined) ?? "Tu courier"}
        nombreCompleto={sesion.nombreCompleto}
        enlaces={enlaces}
      />
      {estadoOnboarding && !estadoOnboarding.completo ? (
        <BannerOnboarding
          pasosCompletados={estadoOnboarding.pasosCompletados}
          totalPasos={estadoOnboarding.totalPasos}
        />
      ) : null}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
