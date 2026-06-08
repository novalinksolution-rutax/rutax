import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { FormularioInvitarSeller } from "./formulario-invitar-seller";

export const metadata: Metadata = {
  title: "Invitar seller",
};

/**
 * Pantalla K — Alta de seller + invitación (RF-010, §3.2).
 *
 * Vive en la sección "Sellers" del courier — DELIBERADAMENTE separada de la
 * Pantalla I (invitación de equipo interno): aquí se crea primero una entidad
 * de negocio (`sellers`) y luego se envía la invitación asociada. Reusa la
 * misma capacidad `puedeInvitarUsuarios` porque, bajo el capó, el mecanismo de
 * invitación es el mismo (`crearInvitacion`) — ver capacidades.ts.
 */
export default async function PaginaInvitarSeller() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  if (!puedeInvitarUsuarios(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">No tienes permiso para invitar sellers</p>
          <p className="text-sm text-muted-foreground">
            Dar de alta sellers y enviarles invitaciones lo pueden hacer el dueño de la cuenta o administración.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/onboarding">Volver al panel de activación</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Invitar a un seller</h1>
        <p className="text-sm text-muted-foreground">
          Registra a tu cliente y le enviaremos una invitación para que entre a su portal y conecte su cuenta de
          Mercado Libre.
        </p>
      </div>

      <FormularioInvitarSeller />
    </div>
  );
}
