import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerPanelCouriers } from "@/modules/plataforma/panel-couriers";
import { tieneSesionAdmin } from "../sesion-admin";
import { TablaCouriers } from "./tabla-couriers";

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
  let errorCarga = false;

  try {
    const panel = await obtenerPanelCouriers();
    couriers = panel.couriers;
  } catch {
    errorCarga = true;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Couriers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Un vistazo por courier: estado de su suscripción, plan, morosidad y
          salud. Las acciones de suspender/cancelar viven en el detalle de la
          suscripción — aquí es solo lectura.
        </p>
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
