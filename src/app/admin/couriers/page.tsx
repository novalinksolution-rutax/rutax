import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerPanelCouriers } from "@/modules/plataforma/panel-couriers";
import { obtenerPlanesActivos } from "@/modules/plataforma/consultas";
import type { Plan } from "@/modules/plataforma/tipos";
import { tieneSesionAdmin, obtenerRolAdminActual } from "../sesion-admin";
import { TablaCouriers } from "./tabla-couriers";
import { DialogNuevoCourier } from "./dialog-nuevo-courier";

export const metadata: Metadata = {
  title: "Couriers · Rutax Admin",
};

// El panel refleja morosidad/salud en vivo; nunca cachear.
export const dynamic = "force-dynamic";

export default async function PaginaCouriers() {
  // Doble verificación (mismo patrón que el resto de `/admin/*`): el código
  // server que lee datos cross-tenant vía service_role NUNCA corre sin sesión
  // admin válida.
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  let couriers: Awaited<ReturnType<typeof obtenerPanelCouriers>>["couriers"] = [];
  let planes: Plan[] = [];
  let errorCarga = false;

  // El rol decide si se muestra el botón de alta (crear courier es escritura,
  // `admin_total` + AAL2). Es solo UX: el gate real vive en `accionCrearCourier`
  // vía `exigirActorAdmin`. `soporte_lectura` ve la lista, no el botón.
  const [rolAdmin] = await Promise.all([obtenerRolAdminActual()]);
  const puedeCrear = rolAdmin === "admin_total";

  try {
    const [panel, planesActivos] = await Promise.all([
      obtenerPanelCouriers(),
      // Los planes alimentan el select del alta. Si falla, el alta sigue
      // pudiendo crear el courier «sin plan»; no vale tumbar la página por eso.
      obtenerPlanesActivos().catch(() => [] as Plan[]),
    ]);
    couriers = panel.couriers;
    planes = planesActivos;
  } catch {
    errorCarga = true;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Couriers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Un vistazo por courier: estado de su suscripción, plan, morosidad y
            salud. Las acciones de suspender/cancelar viven en el detalle de la
            suscripción — aquí es solo lectura.
          </p>
        </div>
        {puedeCrear ? <DialogNuevoCourier planes={planes} /> : null}
      </div>

      {errorCarga ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          No se pudo cargar el panel de couriers. Intenta recargar la página.
        </div>
      ) : (
        <TablaCouriers couriers={couriers} />
      )}
    </div>
  );
}
