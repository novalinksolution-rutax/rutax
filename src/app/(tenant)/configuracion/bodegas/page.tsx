import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarBodegas } from "@/modules/identidad/capacidades";
import { obtenerSellersDelTenant } from "@/lib/datos-tenant/sellers";
import { obtenerMontoVisitaDefaultClp } from "@/lib/datos-tenant/config-retiro";
import { accionListarBodegasCourier } from "./actions";
import { PanelBodegas } from "./panel-bodegas";

export const metadata: Metadata = {
  title: "Bodegas",
};

export default async function PaginaBodegas() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeGestionarBodegas(sesion.usuario)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Sin permiso para ver esta sección</p>
          <p className="text-sm text-muted-foreground">
            La gestión de bodegas es exclusiva de dueño, supervisor o coordinador.
          </p>
        </div>
      </div>
    );
  }

  const tenantId = sesion.usuario.tenantId;

  const [sellers, bodegasCourierResultado, montoVisitaDefaultClp] = await Promise.all([
    obtenerSellersDelTenant(tenantId),
    accionListarBodegasCourier(),
    obtenerMontoVisitaDefaultClp(tenantId),
  ]);

  const bodegasCourierIniciales = bodegasCourierResultado.ok ? bodegasCourierResultado.datos : [];
  const errorCourierInicial = bodegasCourierResultado.ok ? null : bodegasCourierResultado.mensaje;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bodegas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dónde se retiran los pedidos y desde dónde sale tu flota a repartir.
        </p>
      </div>

      <PanelBodegas
        sellers={sellers}
        bodegasCourierIniciales={bodegasCourierIniciales}
        errorCourierInicial={errorCourierInicial}
        montoVisitaDefaultClp={montoVisitaDefaultClp}
      />
    </div>
  );
}
