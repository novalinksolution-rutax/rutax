import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarConfiguracionDte } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { obtenerEstadoConfiguracionDte } from "./actions";
import { FormularioConfiguracionDte } from "./formulario-configuracion-dte";

export const metadata: Metadata = {
  title: "Configuración de facturación electrónica",
};

/**
 * Pantalla E — Configuración DTE (RF-007 + RF-008 parte 1).
 *
 * Server component "cascarón": resuelve sesión + capacidad + estado inicial,
 * y delega toda la interacción (selector de proveedor que se "cierra" tras
 * guardar, cargas de certificado/credenciales) al formulario de cliente — esa
 * frontera es la misma que usan las Pantallas A/C/J de este lote.
 *
 * Guard de capacidad: a diferencia de la navegación (que ya se ajusta por
 * `puedeGestionarConfiguracionDte` en el layout), esta pantalla puede
 * alcanzarse por enlace directo (p. ej. desde el panel de onboarding visto por
 * alguien con otra capacidad) — por eso repite el guard aquí, mostrando un
 * estado explicativo en vez de un 404 o una pantalla en blanco (CLAUDE.md:
 * "ocultar no basta", y aquí menos aún — hay que decir POR QUÉ no se puede).
 */
export default async function PaginaConfiguracionDte() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  if (!puedeGestionarConfiguracionDte(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">No tienes permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            La configuración de facturación electrónica solo la pueden ver y modificar el dueño de la cuenta o
            administración. Si necesitas hacer un cambio aquí, pídele a esa persona que lo haga o que te dé acceso.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/onboarding">Volver al panel de activación</Link>
        </Button>
      </div>
    );
  }

  const resultado = await obtenerEstadoConfiguracionDte();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Facturación electrónica</h1>
        <p className="text-sm text-muted-foreground">
          Elige tu proveedor de DTE y carga tu certificado digital y tus credenciales. Todo se cifra antes de
          guardarse — una vez cargado, no podrás volver a verlo aquí, solo reemplazarlo.
        </p>
      </div>

      <FormularioConfiguracionDte
        estadoInicial={resultado.ok ? resultado.estado : null}
        errorInicial={resultado.ok ? null : resultado.mensaje}
      />
    </div>
  );
}
