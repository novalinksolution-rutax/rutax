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
  puedeGestionarIncidencias,
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
  puedeGestionarCobranza,
  puedeVerConciliacion,
  puedeVerBitacoraAuditoria,
} from "@/modules/identidad/capacidades";
import { AppShell, type GrupoNav } from "@/components/app-shell/app-shell";
import { BannerOnboarding } from "@/components/onboarding/banner-onboarding";
import { resolverEstadoOnboarding } from "@/app/(tenant)/onboarding/estado";
import { obtenerAvisos } from "@/lib/avisos/obtener-avisos";

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

  const u = sesion.usuario;
  const esOperativo =
    puedeAsignarYReasignarPedidos(u) ||
    puedeGenerarManifiestos(u) ||
    puedeAjustarOperacionDiaria(u);

  // Navegación AGRUPADA por objetivo y filtrada por capacidad (UX_STRATEGY §5.2).
  // Lo que un rol no puede hacer, no se incluye como ítem — no se muestra
  // deshabilitado. Un grupo sin ítems no se agrega.
  const grupoPrincipal: GrupoNav = { titulo: null, items: [] };
  if (puedeVerReportesEjecutivos(u)) {
    grupoPrincipal.items.push({ href: "/dashboard", etiqueta: "Dashboard", icono: "dashboard" });
  }

  const grupoOperacion: GrupoNav = { titulo: "Operación", items: [] };
  if (esOperativo) {
    grupoOperacion.items.push({ href: "/operaciones", etiqueta: "Pedidos", icono: "pedidos" });
    grupoOperacion.items.push({ href: "/manifiestos", etiqueta: "Manifiestos", icono: "manifiestos" });
  }
  if (puedeGestionarIncidencias(u)) {
    grupoOperacion.items.push({ href: "/operaciones/incidencias", etiqueta: "Incidencias", icono: "incidencias" });
  }

  const grupoDinero: GrupoNav = { titulo: "Dinero", items: [] };
  if (puedeEmitirFacturas(u)) {
    grupoDinero.items.push({ href: "/dinero/periodos", etiqueta: "Períodos", icono: "periodos" });
  }
  if (puedeGestionarLiquidacionesConductores(u)) {
    grupoDinero.items.push({ href: "/dinero/liquidaciones", etiqueta: "Liquidaciones", icono: "liquidaciones" });
  }
  if (puedeVerConciliacion(u)) {
    grupoDinero.items.push({ href: "/dinero/conciliacion", etiqueta: "Conciliación", icono: "conciliacion" });
  }
  if (puedeVerConciliacion(u) || puedeGestionarCobranza(u)) {
    grupoDinero.items.push({ href: "/dinero/cobranza", etiqueta: "Pagos", icono: "pagos" });
  }

  const grupoConfig: GrupoNav = { titulo: "Configuración", items: [] };
  grupoConfig.items.push({ href: "/onboarding", etiqueta: "Configuración", icono: "configuracion" });
  if (puedeGestionarUsuariosYRoles(u)) {
    grupoConfig.items.push({ href: "/equipo", etiqueta: "Equipo", icono: "equipo" });
  }
  grupoConfig.items.push({ href: "/sellers", etiqueta: "Sellers", icono: "sellers" });
  if (puedeVerBitacoraAuditoria(u)) {
    grupoConfig.items.push({ href: "/configuracion/exportar-datos", etiqueta: "Exportar datos", icono: "exportar" });
  }

  const grupos: GrupoNav[] = [grupoPrincipal, grupoOperacion, grupoDinero, grupoConfig].filter(
    (g) => g.items.length > 0,
  );

  const puedeActuarSobreOnboarding = puedeGestionarConfiguracionDte(sesion.usuario);
  const [estadoOnboarding, avisos] = await Promise.all([
    puedeActuarSobreOnboarding && sesion.usuario.tenantId
      ? resolverEstadoOnboarding(sesion.usuario.tenantId)
      : Promise.resolve(null),
    obtenerAvisos(sesion.usuario.tenantId, sesion.usuario),
  ]);

  return (
    <AppShell
      nombreFantasia={(tenant?.nombre_fantasia as string | undefined) ?? "Tu courier"}
      nombreCompleto={sesion.nombreCompleto}
      grupos={grupos}
      avisos={avisos}
      banner={
        estadoOnboarding && !estadoOnboarding.completo ? (
          <BannerOnboarding
            pasosCompletados={estadoOnboarding.pasosCompletados}
            totalPasos={estadoOnboarding.totalPasos}
          />
        ) : null
      }
    >
      {children}
    </AppShell>
  );
}
