import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PantallaEmpresaPendiente } from "@/components/puesta-en-marcha/pantalla-empresa-pendiente";
import { cerrarSesion } from "@/lib/identidad/cerrar-sesion";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { RUTA_REGISTRO_EMPRESA } from "@/modules/identidad/registro-empresa";

export const metadata: Metadata = { title: "Puesta en marcha" };

/**
 * Layout de `/puesta-en-marcha` — SIN AppShell y FUERA de `(tenant)`.
 *
 * Decisión (docs/ux/puesta-en-marcha-v2.md §8, H7): el gate vive en
 * `(tenant)/layout.tsx` y esta ruta es su hermana, no su hija. Así el redirect
 * del gate no puede entrar en bucle (el destino no pasa por el gate) y no hace
 * falta conocer la ruta actual ni mover ninguna pantalla existente. Lo que
 * repite de aquel layout son solo las guardas de sesión.
 */
export default async function LayoutPuestaEnMarcha({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesionActual();
  if (sesion?.sinPerfil) redirect(RUTA_REGISTRO_EMPRESA);
  if (!sesion || !sesion.usuario.tenantId) redirect("/login");
  if (sesion.usuario.estado !== "activo") redirect("/login");
  if (sesion.usuario.tipoUsuario === "conductor") redirect("/conductor");
  if (sesion.usuario.tipoUsuario === "seller") redirect("/portal");
  if (sesion.usuario.tipoUsuario !== "interno") redirect("/login");

  async function accionSalir() {
    "use server";
    await cerrarSesion("/login");
  }

  if (sesion.usuario.rol !== "dueno") {
    const { data } = await crearClienteServiceRole()
      .schema("identidad")
      .from("tenants")
      .select("nombre_fantasia")
      .eq("id", sesion.usuario.tenantId)
      .maybeSingle();
    return (
      <PantallaEmpresaPendiente
        nombreFantasia={(data?.nombre_fantasia as string | undefined) ?? "Tu courier"}
        motivo="no_dueno"
        accionSalir={accionSalir}
      />
    );
  }

  return <>{children}</>;
}
