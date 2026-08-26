import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarBodegas } from "@/modules/identidad/capacidades";
import { obtenerSellersDelTenant } from "@/lib/datos-tenant/sellers";
import { obtenerMontoVisitaDefaultClp } from "@/lib/datos-tenant/config-retiro";
import { accionListarBodegasCourier } from "./actions";
import {
  PantallaConfiguracion,
  SinPermisoConfiguracion,
} from "../_componentes/pantalla-configuracion";
import { PanelBodegas } from "./panel-bodegas";

export const metadata: Metadata = {
  title: "Bodegas",
};

export default async function PaginaBodegas() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeGestionarBodegas(sesion.usuario)) {
    return (
      <SinPermisoConfiguracion frase="Las bodegas solo las pueden ver y cambiar el dueño, un supervisor o un coordinador." />
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
    <PantallaConfiguracion
      titulo="Bodegas"
      bajada="Dónde se retiran los pedidos y desde dónde sale tu flota a repartir. Son dos cosas distintas y por eso van separadas."
      ancho="tabla"
    >
      <PanelBodegas
        sellers={sellers}
        bodegasCourierIniciales={bodegasCourierIniciales}
        errorCourierInicial={errorCourierInicial}
        montoVisitaDefaultClp={montoVisitaDefaultClp}
      />
    </PantallaConfiguracion>
  );
}
