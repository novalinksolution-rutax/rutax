import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarConfiguracionDte, puedeGestionarUsuariosYRoles } from "@/modules/identidad/capacidades";
import { BarraSuperior } from "@/components/app-shell/barra-superior";
import { BannerOnboarding } from "@/components/onboarding/banner-onboarding";
import { resolverEstadoOnboarding } from "@/app/onboarding/estado";

/**
 * Cascarón mínimo del área autenticada — sirve a las pantallas D-K de este
 * lote (onboarding del courier, equipo, sellers). No reemplaza al dashboard
 * del dueño (RF-046, fuera de alcance) — es justo el andamiaje de navegación
 * que esas pantallas necesitan para no quedar sueltas.
 *
 * La navegación se ajusta por capacidad — no porque "ocultar baste" (la
 * autorización real vive en el backend, CLAUDE.md), sino porque mostrar un
 * enlace a una sección que el actor no puede usar es, en sí, un error de UX
 * (lleva a un caso "sin permiso" evitable).
 */
export default async function LayoutApp({ children }: { children: React.ReactNode }) {
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

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("nombre_fantasia")
    .eq("id", sesion.usuario.tenantId)
    .maybeSingle();

  const enlaces = [{ href: "/onboarding", etiqueta: "Onboarding" }];
  if (puedeGestionarUsuariosYRoles(sesion.usuario)) {
    enlaces.push({ href: "/equipo", etiqueta: "Equipo" });
  }
  enlaces.push({ href: "/sellers", etiqueta: "Sellers" });

  // Banner persistente de onboarding incompleto (§1.3): solo se calcula y
  // muestra a quien puede ACTUAR sobre esos pasos — mostrarlo a alguien que no
  // puede resolverlo sería ruido sin acción posible (criterio §5 transversal:
  // "todo estado lleva una acción clara").
  const puedeActuarSobreOnboarding = puedeGestionarConfiguracionDte(sesion.usuario);
  const estadoOnboarding = puedeActuarSobreOnboarding && sesion.usuario.tenantId
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
