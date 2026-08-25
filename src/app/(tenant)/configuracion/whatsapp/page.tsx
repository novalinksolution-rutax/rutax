import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarContactosWhatsApp } from "@/modules/identidad/capacidades";
import { obtenerSellersDelTenant } from "@/lib/datos-tenant/sellers";
import { accionListarContactos, accionListarBodegasParaContactos } from "./actions";
import {
  PantallaConfiguracion,
  SinPermisoConfiguracion,
} from "../_componentes/pantalla-configuracion";
import { PanelContactosWhatsApp } from "./panel-contactos";

export const metadata: Metadata = {
  title: "Contactos de WhatsApp",
};

export default async function PaginaContactosWhatsApp() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeGestionarContactosWhatsApp(sesion.usuario)) {
    return (
      <SinPermisoConfiguracion frase="Los contactos de WhatsApp solo los pueden ver y cambiar el dueño, un supervisor o un coordinador." />
    );
  }

  const [contactos, bodegas, sellers] = await Promise.all([
    accionListarContactos(),
    accionListarBodegasParaContactos(),
    obtenerSellersDelTenant(sesion.usuario.tenantId),
  ]);

  return (
    <PantallaConfiguracion
      titulo="Contactos de WhatsApp"
      bajada="A quién le escribe Rutax por WhatsApp. Los avisos salen desde el número oficial de Rutax, y solo a quien haya dado su consentimiento."
    >
      <PanelContactosWhatsApp
        contactosIniciales={contactos.ok ? contactos.datos : []}
        errorInicial={contactos.ok ? null : contactos.mensaje}
        bodegas={bodegas.ok ? bodegas.datos : []}
        sellers={sellers.map((s) => ({ id: s.id, nombre: s.nombre }))}
      />
    </PantallaConfiguracion>
  );
}
