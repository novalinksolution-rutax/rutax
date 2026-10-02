import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerPanelCouriers } from "@/modules/plataforma/panel-couriers";
import { tieneSesionAdmin, obtenerRolAdminActual } from "../sesion-admin";
import { TablaCouriers } from "./tabla-couriers";
import { DialogNuevoCourier } from "./dialog-nuevo-courier";
import {
  obtenerPerfilesComerciales,
  resumirPlataformas,
  type PerfilesPorTenant,
} from "@/modules/plataforma/perfil-comercial";
import { ResumenPlataformasOrigen } from "./resumen-plataformas";

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

  type Panel = Awaited<ReturnType<typeof obtenerPanelCouriers>>;
  let couriers: Panel["couriers"] = [];
  let invitados: Panel["couriersSinSuscripcion"] = [];
  let errorCarga = false;
  let perfiles: PerfilesPorTenant = {};
  let errorPerfiles = false;

  // El rol decide si se muestra el botón de alta (crear courier es escritura,
  // `admin_total` + AAL2). Es solo UX: el gate real vive en `accionCrearCourier`
  // vía `exigirActorAdmin`. `soporte_lectura` ve la lista, no el botón.
  const rolAdmin = await obtenerRolAdminActual();
  const puedeCrear = rolAdmin === "admin_total";

  try {
    const panel = await obtenerPanelCouriers();
    couriers = panel.couriers;
    invitados = panel.couriersSinSuscripcion;
  } catch {
    errorCarga = true;
  }

  // Aparte: si las respuestas comerciales fallan, el panel de couriers sigue.
  try {
    perfiles = await obtenerPerfilesComerciales();
  } catch {
    errorPerfiles = true;
  }
  // Solo cuentan los couriers que están en el panel o invitados (no huérfanos).
  const idsVisibles = new Set([...couriers.map((c) => c.tenantId), ...invitados.map((c) => c.tenantId)]);
  const perfilesVisibles = Object.entries(perfiles).filter(([id]) => idsVisibles.has(id));

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
        {puedeCrear ? <DialogNuevoCourier /> : null}
      </div>

      {errorCarga ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          No se pudo cargar el panel de couriers. Intenta recargar la página.
        </div>
      ) : (
        <>
          {errorPerfiles ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              No se pudieron cargar las respuestas de Tu empresa. Intenta recargar la página.
            </div>
          ) : (
            <ResumenPlataformasOrigen
              resumen={resumirPlataformas(perfilesVisibles.map(([, p]) => p))}
              totalCouriers={idsVisibles.size}
            />
          )}
          <TablaCouriers couriers={couriers} invitados={invitados} perfiles={perfiles} />
        </>
      )}
    </div>
  );
}
