/**
 * Bodegas del seller — las administra ÉL.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 ERA UNA TARJETA MUERTA
 * -----------------------------------------------------------------------------
 * Esta pantalla era de solo lectura: el seller veía su bodega y no podía hacer
 * nada con ella. Ni agregar la que acababa de arrendar, ni corregir un teléfono
 * equivocado, ni dar de baja la que cerró. Para cualquiera de las tres tenía
 * que escribirle a su courier y esperar.
 *
 * El tablero `B4` lo decía así —«ninguna acción: no es su configuración»— y
 * **se revierte por decisión del usuario (25-08-2026)**: la bodega es del
 * seller, es él quien sabe dónde está y a quién hay que llamar.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ LO QUE SIGUE SIENDO DEL COURIER
 * -----------------------------------------------------------------------------
 * El **pago por visita** (`monto_visita_clp`): es lo que el courier le paga al
 * conductor por venir hasta acá. No se muestra, no se edita, y una bodega nueva
 * lo hereda del monto general. Ver `actions.ts`.
 *
 * A propósito tampoco se muestra `geo_estado`. Ahora el seller SÍ puede
 * corregir la dirección, pero un aviso de «no ubicada» seguiría sin decirle qué
 * hacer: la coordenada la resuelve el servidor al guardar, y si falla, el
 * courier la reintenta desde su pantalla.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Warehouse } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { EmptyState } from "@/components/ui/empty-state";
import { ListaMisBodegas, type BodegaSeller } from "./lista-mis-bodegas";

export const metadata: Metadata = {
  title: "Bodegas",
};

export default async function PaginaBodegasSeller() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) redirect("/portal");

  const sellerId = sesion.usuario.sellerId;
  const tenantId = sesion.usuario.tenantId;
  const supabase = crearClienteServiceRole();

  let bodegas: BodegaSeller[] = [];
  let errorCarga = false;

  // El nombre del courier, para poder decir «Andes Express todavía no
  // registró…» en vez de «tu courier». Un vacío que nombra a quien tiene que
  // actuar se puede accionar; uno genérico, no.
  const { data: tenantFila } = await supabase
    .from("tenants")
    .select("nombre_fantasia")
    .eq("id", tenantId)
    .maybeSingle();
  const nombreCourier =
    (tenantFila?.nombre_fantasia as string | undefined) ?? "Tu empresa de despacho";

  try {
    const { data, error } = await supabase
      .schema("identidad")
      .from("seller_bodegas")
      .select(
        "id, nombre, direccion, comuna, instrucciones_acceso, contacto_nombre, contacto_telefono, es_principal, activa",
      )
      .eq("seller_id", sellerId)
      .eq("tenant_id", tenantId)
      .order("activa", { ascending: false })
      .order("es_principal", { ascending: false })
      .order("nombre", { ascending: true });

    if (error) throw error;

    bodegas = (data ?? []).map((f: Record<string, unknown>) => ({
      id: f.id as string,
      nombre: f.nombre as string,
      direccion: f.direccion as string,
      comuna: f.comuna as string,
      instruccionesAcceso: (f.instrucciones_acceso as string | null) ?? null,
      contactoNombre: (f.contacto_nombre as string | null) ?? null,
      contactoTelefono: (f.contacto_telefono as string | null) ?? null,
      esPrincipal: f.es_principal as boolean,
      activa: f.activa as boolean,
    }));
  } catch {
    errorCarga = true;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Bodegas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Desde acá retira {nombreCourier} tus pedidos. Agrega las que uses y mantén al día la
          dirección y a quién llamar.
        </p>
      </div>

      {errorCarga && (
        <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
          No se pudo cargar la lista de bodegas. Intenta recargar la página.
        </div>
      )}

      {!errorCarga && bodegas.length === 0 && (
        /* El vacío nombra al courier y OFRECE LA SALIDA: sin bodega registrada
           nadie va a pasar a retirar, así que quedarse esperando es lo peor que
           puede hacer el seller. */
        /* El vacío ya no manda a escribirle al courier: ahora hay botón. */
        <EmptyState
          icon={Warehouse}
          tono="arranque"
          titulo="Todavía no tienes ninguna bodega"
          descripcion={`Mientras no haya una, ${nombreCourier} no tiene dónde ir a retirar tus pedidos. Agrega la primera y quedas listo.`}
          accion={<ListaMisBodegas bodegas={[]} />}
        />
      )}

      {!errorCarga && bodegas.length > 0 && <ListaMisBodegas bodegas={bodegas} />}
    </div>
  );
}
