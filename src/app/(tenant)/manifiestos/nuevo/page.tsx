/**
 * Crear manifiesto — Pantalla 2-A (Flujo 2)
 *
 * Formulario del nuevo manifiesto. Al confirmar navega a Pantalla 2-B.
 */

import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGenerarManifiestos } from "@/modules/identidad/capacidades";
import { FormularioNuevoManifiesto } from "./formulario";

export default async function PaginaNuevoManifiesto() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  if (!puedeGenerarManifiestos(sesion.usuario)) {
    redirect("/manifiestos");
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  // Conductores activos del tenant
  const { data: conductoresRaw } = await cliente
    .from("conductores")
    .select("id, nombre_completo")
    .eq("tenant_id", tenantId)
    .eq("estado", "activo")
    .order("nombre_completo");

  const conductores = (conductoresRaw ?? []).map(
    (c: { id: string; nombre_completo: string }) => ({
      id: c.id,
      nombre: c.nombre_completo,
    }),
  );

  const hoy = new Date().toISOString().split("T")[0];

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nuevo manifiesto</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          El manifiesto se crea en borrador. Podrás agregar pedidos antes de confirmarlo.
        </p>
      </div>

      <FormularioNuevoManifiesto conductores={conductores} fechaHoy={hoy} tenantId={tenantId} />
    </div>
  );
}
