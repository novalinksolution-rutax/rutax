import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  obtenerTodasSuscripciones,
  obtenerPlanesActivos,
  obtenerTodosLosTenantsSinSuscripcion,
} from "@/modules/plataforma/consultas";
import { tieneSesionAdmin } from "../sesion-admin";
import { TablaSuscripciones } from "./tabla-suscripciones";

export const metadata: Metadata = {
  title: "Suscripciones · Rutax Admin",
};

export default async function PaginaSuscripciones() {
  // Doble verificación — el layout también protege, pero lo repetimos aquí para
  // que el código del servidor de esta página (que consulta datos cross-tenant
  // vía service_role) NUNCA se ejecute sin una sesión admin válida.
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  const [suscripciones, planes, tenantsSinSuscripcion] = await Promise.all([
    obtenerTodasSuscripciones(),
    obtenerPlanesActivos(),
    obtenerTodosLosTenantsSinSuscripcion(),
  ]);

  return (
    <TablaSuscripciones
      suscripciones={suscripciones}
      planes={planes}
      tenantsSinSuscripcion={tenantsSinSuscripcion.map((t) => ({
        id: t.id,
        nombreFantasia: t.nombreFantasia ?? null,
      }))}
    />
  );
}
