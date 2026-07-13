import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerTodosLosPlanes } from "@/modules/plataforma/consultas";
import { tieneSesionAdmin, obtenerRolAdminActual } from "../sesion-admin";
import { TablaPlanes } from "./tabla-planes";

export const metadata: Metadata = {
  title: "Planes · Rutax Admin",
};

// Catálogo editable — nunca cachear entre despliegues del admin.
export const dynamic = "force-dynamic";

export default async function PaginaPlanes() {
  // Doble verificación (mismo patrón que el resto de `/admin/*`): el código
  // server que lee `plataforma` vía service_role NUNCA corre sin sesión admin.
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  let planes: Awaited<ReturnType<typeof obtenerTodosLosPlanes>> = [];
  let errorCarga = false;

  try {
    planes = await obtenerTodosLosPlanes();
  } catch {
    errorCarga = true;
  }

  // Rol de la sesión — pura UX: oculta/deshabilita los controles de escritura
  // que un `soporte_lectura` no podría ejecutar (el gate real, siempre, está
  // en `exigirSuperAdminEscritura` dentro de cada Server Action).
  const puedeEscribir = (await obtenerRolAdminActual()) === "admin_total";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Planes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Catálogo de planes de Rutax. Los planes inactivos no aparecen en el alta self-serve del
          courier, pero las suscripciones que ya los usan siguen operando sin cambios.
        </p>
      </div>

      {errorCarga ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          No se pudo cargar el catálogo de planes. Intenta recargar la página.
        </div>
      ) : (
        <TablaPlanes planes={planes} puedeEscribir={puedeEscribir} />
      )}
    </div>
  );
}
