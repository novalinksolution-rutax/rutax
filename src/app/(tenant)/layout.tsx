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
  puedeGestionarTarifas,
  puedeGestionarIncidencias,
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
  puedeGestionarCobranza,
  puedeVerConciliacion,
  puedeVerBitacoraAuditoria,
  puedeGestionarSuscripcion,
  puedeVerPreparacionDia,
  puedeVerTorreControl,
  puedeGestionarBodegas,
} from "@/modules/identidad/capacidades";
import { AppShell, type GrupoNav, type ItemNav } from "@/components/app-shell/app-shell";
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
  // Destino de primer nivel, no un ítem de "Operación": el coordinador —que no
  // tiene Dashboard— empieza el día aquí. Ver docs/arquitectura/torre-de-control.md.
  if (puedeVerTorreControl(u)) {
    grupoPrincipal.items.push({
      href: "/torre-de-control",
      etiqueta: "Torre de control",
      icono: "torre-de-control",
    });
  }

  const grupoOperacion: GrupoNav = { titulo: "Operación", items: [] };
  // Primero del grupo, y no por orden alfabético: es el orden del DÍA. El retiro
  // en bodega ocurre toda la mañana y la asignación tiene que estar terminada a
  // las 16:00 — quien coordina abre esta pantalla antes que la de pedidos.
  if (puedeVerPreparacionDia(u)) {
    grupoOperacion.items.push({
      href: "/preparacion",
      etiqueta: "Preparación del día",
      icono: "preparacion",
    });
  }
  if (esOperativo) {
    grupoOperacion.items.push({ href: "/operaciones", etiqueta: "Pedidos", icono: "pedidos" });
    grupoOperacion.items.push({ href: "/manifiestos", etiqueta: "Manifiestos", icono: "manifiestos" });
  }
  if (puedeAsignarYReasignarPedidos(u)) {
    grupoOperacion.items.push({ href: "/conductores", etiqueta: "Conductores", icono: "conductores" });
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
    grupoDinero.items.push({ href: "/dinero/cobranza", etiqueta: "Cobranza", icono: "pagos" });
  }

  // Clientes — el seller es una entidad de negocio, no un ajuste (IA Blueprint §1.1).
  const grupoClientes: GrupoNav = {
    titulo: "Clientes",
    items: [{ href: "/sellers", etiqueta: "Sellers", icono: "sellers" }],
  };

  // Settings anidado (Patrón H de Retell): el grupo Configuración SALE del sidebar
  // principal y se vuelve una sub-navegación que reemplaza el sidebar al entrar
  // (con "‹ Volver"). Mismo gating RBAC que antes; el hub de onboarding es
  // "Puesta en marcha". Mi plan vive aquí y también en el bloque inferior (billing).
  const itemsSettings: ItemNav[] = [
    { href: "/onboarding", etiqueta: "Puesta en marcha", icono: "puesta-en-marcha" },
  ];
  if (puedeGestionarTarifas(u)) {
    itemsSettings.push({ href: "/configuracion/tarifas", etiqueta: "Tarifas", icono: "tarifas" });
    itemsSettings.push({ href: "/configuracion/api", etiqueta: "Integraciones", icono: "integraciones" });
    itemsSettings.push({ href: "/configuracion/zonas", etiqueta: "Zonas", icono: "zonas" });
    // Mismo gate que Tarifas — es la misma clase de dato: lo que se le paga al
    // conductor por una unidad de trabajo (ver justificación en
    // configuracion/retiro/actions.ts).
    itemsSettings.push({ href: "/configuracion/retiro", etiqueta: "Retiro", icono: "retiro-bodega" });
  }
  // Bloque propio: `gestionar_bodegas` NO coincide con `gestionar_tarifas`. Se
  // la tienen dueño, supervisor y coordinador, y NO administración — al revés
  // que el resto de Configuración. Va junto a Zonas por afinidad geográfica.
  if (puedeGestionarBodegas(u)) {
    itemsSettings.push({ href: "/configuracion/bodegas", etiqueta: "Bodegas", icono: "bodegas" });
  }
  if (puedeGestionarUsuariosYRoles(u)) {
    itemsSettings.push({ href: "/equipo", etiqueta: "Equipo", icono: "equipo" });
  }
  if (puedeVerBitacoraAuditoria(u)) {
    itemsSettings.push({ href: "/configuracion/exportar-datos", etiqueta: "Exportar datos", icono: "exportar" });
  }
  if (puedeGestionarSuscripcion(u)) {
    itemsSettings.push({ href: "/configuracion/plan", etiqueta: "Mi plan", icono: "plan" });
  }

  const grupos: GrupoNav[] = [
    grupoPrincipal,
    grupoOperacion,
    grupoDinero,
    grupoClientes,
  ].filter((g) => g.items.length > 0);

  // Mi plan = card "Free trial" de Retell (billing, marco propio abajo).
  const itemPlan: ItemNav | undefined = puedeGestionarSuscripcion(u)
    ? { href: "/configuracion/plan", etiqueta: "Mi plan", icono: "plan" }
    : undefined;

  // Bloque inferior (ítems sobre la card de plan): entrada "Configuración" que
  // ABRE el Settings anidado.
  const itemsInferiores: ItemNav[] = [
    { href: "/onboarding", etiqueta: "Configuración", icono: "configuracion" },
  ];

  // "‹ Volver" del Settings anidado → el primer ítem del sidebar principal.
  const hrefPrincipal = grupos[0]?.items[0]?.href ?? "/dashboard";

  const ROL_ETIQUETA: Record<string, string> = {
    dueno: "Dueño",
    supervisor: "Supervisor",
    coordinador: "Coordinador",
    administracion: "Administración",
  };

  const puedeActuarSobreOnboarding = puedeGestionarConfiguracionDte(sesion.usuario);
  const [estadoOnboarding, avisos] = await Promise.all([
    puedeActuarSobreOnboarding && sesion.usuario.tenantId
      ? resolverEstadoOnboarding(sesion.usuario.tenantId)
      : Promise.resolve(null),
    obtenerAvisos(sesion.usuario.tenantId, sesion.usuario, sesion.usuarioId),
  ]);

  return (
    <AppShell
      nombreFantasia={(tenant?.nombre_fantasia as string | undefined) ?? "Tu courier"}
      nombreCompleto={sesion.nombreCompleto}
      subtituloCuenta={ROL_ETIQUETA[sesion.usuario.rol] ?? null}
      grupos={grupos}
      itemsInferiores={itemsInferiores}
      itemsSettings={itemsSettings}
      hrefPrincipal={hrefPrincipal}
      itemPlan={itemPlan}
      // La Torre es la única pantalla ancha del backoffice: su mapa necesita más
      // que el `max-w-6xl` con que se lee bien todo lo demás. La excepción se
      // declara acá —donde viven las rutas— y no se le quita el ancho máximo a
      // ninguna otra pantalla.
      rutasAnchas={["/torre-de-control"]}
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
