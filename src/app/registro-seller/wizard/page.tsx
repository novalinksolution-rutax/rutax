import type { Metadata } from "next";
import Link from "next/link";

import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { Button } from "@/components/ui/button";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerEstadoWizardSellerAction } from "./actions";
import { WizardAltaSeller } from "./wizard-alta-seller";

export const metadata: Metadata = {
  title: "Completa tu alta",
  robots: { index: false, follow: false },
};

/**
 * `/registro-seller/wizard` — los cinco pasos del alta de seller por
 * autoservicio (RF-010 rediseño).
 * =============================================================================
 * Llega acá SOLO quien ya pasó por `/auth/callback` con la barrera de
 * auto-registro en verde: el `tenantId` del enlace quedó fijo en la cookie del
 * wizard (`borrador-wizard-seller.ts`) y es inmutable durante todo el flujo.
 *
 * Sin esa cookie (venció, se limpió, o alguien entra a esta URL directo sin
 * haber pasado por el enlace) no hay nada que mostrar — mismo criterio que
 * `/invitacion/[token]`: un estado final claro, sin el bundle del formulario.
 *
 * El nombre del courier no lo entrega `obtenerEstadoWizardSellerAction`
 * (solo trae los pasos ya guardados): se resuelve acá con una lectura directa
 * por `tenantId`, igual que hace `resolverEnlaceSellerPublico` para la
 * landing — es un dato público de decoración, no una regla de negocio nueva.
 */
export default async function PaginaWizardAltaSeller() {
  const resultado = await obtenerEstadoWizardSellerAction();

  if (!resultado.ok) {
    return (
      <PantallaSinSesion marca={{ tipo: "neutra" }}>
        <div className="w-full max-w-sm border border-line bg-bg-raised p-6">
          <DistintivoEstado tono="attention" etiqueta="Sesión vencida" />
          <h1 className="font-heading mt-4 text-xl leading-tight font-semibold">
            Tu sesión de registro venció
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">{resultado.mensaje}</p>
          <div className="mt-5">
            <Button asChild variant="outline">
              <Link href="/login">Ir a iniciar sesión</Link>
            </Button>
          </div>
        </div>
      </PantallaSinSesion>
    );
  }

  const estado = resultado.datos;
  const cliente = crearClienteServiceRole();
  const { data: tenant } = await cliente
    .from("tenants")
    .select("nombre_fantasia")
    .eq("id", estado.tenantId)
    .maybeSingle();
  const nombreFantasia = (tenant?.nombre_fantasia as string | null)?.trim() || "tu courier";

  return (
    // El ADN no tiene sombras, así que la tarjeta no "flota" con elevación: se
    // apoya en un pozo de luz. El degradado va del fondo de página (--rx-bg) al
    // hundido (--rx-bg-sunken) hacia los bordes, sin colores nuevos.
    // `sm:` a propósito: en teléfono el seller abre esto desde WhatsApp y la
    // tarjeta debe ocupar la pantalla, no flotar en el medio.
    <PantallaSinSesion
      marca={{ tipo: "courier", nombre: nombreFantasia }}
      className="sm:bg-[radial-gradient(ellipse_at_center,var(--rx-bg)_0%,var(--rx-bg-sunken)_72%)]"
    >
      <WizardAltaSeller estadoInicial={estado} nombreFantasia={nombreFantasia} />
    </PantallaSinSesion>
  );
}
