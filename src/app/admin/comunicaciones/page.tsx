import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerComunicaciones } from "@/modules/plataforma/comunicaciones";
import { tieneSesionAdmin, obtenerRolAdminActual, obtenerSuperAdminsActivos } from "../sesion-admin";
import { TablaComunicaciones, type ComunicacionConAutor } from "./tabla-comunicaciones";

export const metadata: Metadata = {
  title: "Comunicaciones · Rutax Admin",
};

// Canal en vivo hacia los couriers — nunca cachear entre despliegues del admin.
export const dynamic = "force-dynamic";

export default async function PaginaComunicaciones() {
  // Doble verificación (mismo patrón que el resto de `/admin/*`): el código
  // server que lee/escribe `plataforma` vía service_role NUNCA corre sin
  // sesión admin.
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  let comunicaciones: ComunicacionConAutor[] = [];
  let errorCarga = false;

  try {
    const [lista, admins] = await Promise.all([obtenerComunicaciones(), obtenerSuperAdminsActivos()]);
    // Resolver el nombre del autor server-side (nunca se pasa un Map crudo al
    // Client Component — mismo criterio que `manifiestos/[id]/asignar/page.tsx`).
    const nombrePorAdmin = new Map(admins.map((a) => [a.usuarioId, a.nombre]));
    comunicaciones = lista.map((c) => ({
      ...c,
      creadoPorNombre: c.creadoPor ? (nombrePorAdmin.get(c.creadoPor) ?? null) : null,
    }));
  } catch {
    errorCarga = true;
  }

  // Rol de la sesión — pura UX: oculta/deshabilita los controles de ESCRITURA
  // que un `soporte_lectura` no podría ejecutar (el gate real, siempre, está
  // en `exigirSuperAdminEscritura` dentro de cada Server Action).
  const puedeEscribir = (await obtenerRolAdminActual()) === "admin_total";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Comunicaciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Avisos de Rutax a los couriers: mantención, novedades y alertas. Se
          publican de inmediato como banner en el área interna de{" "}
          <span className="font-medium text-foreground">todos los couriers</span> (alcance
          global) y, si lo marcas, también por correo al dueño de cada uno.
        </p>
      </div>

      {errorCarga ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          No se pudieron cargar las comunicaciones. Intenta recargar la página.
        </div>
      ) : (
        <TablaComunicaciones comunicaciones={comunicaciones} puedeEscribir={puedeEscribir} />
      )}
    </div>
  );
}
