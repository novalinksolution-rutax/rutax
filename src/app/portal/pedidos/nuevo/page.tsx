import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeSolicitarSameDay } from "@/modules/identidad/capacidades";
import { FormularioNuevoPedido } from "./formulario-nuevo-pedido";

export const metadata: Metadata = {
  title: "Nuevo envío same-day",
};

export default async function PaginaNuevoPedido() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    redirect("/login");
  }
  if (!puedeSolicitarSameDay(sesion.usuario)) {
    redirect("/portal/pedidos");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/portal/pedidos"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
          Mis pedidos
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Solicitar envío same-day
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          El envío quedará en estado <em>pendiente de asignación</em> hasta que el courier lo
          asigne a un conductor. Puedes cargar varios envíos seguidos: el formulario
          queda listo para el siguiente apenas confirmas uno.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <FormularioNuevoPedido />
      </div>
    </div>
  );
}
