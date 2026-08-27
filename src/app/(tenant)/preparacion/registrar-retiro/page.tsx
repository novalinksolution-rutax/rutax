import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { listarConductores } from "@/modules/operacion/conductores";
import { listarBodegasParaConductor } from "@/modules/operacion/retiro/bodegas";
import { listarPedidosPendientesDeRetiro } from "@/modules/operacion/retiro/registro-web";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

import { FormularioRetiro } from "./formulario-retiro";

export const metadata: Metadata = {
  title: "Registrar retiro",
};

/**
 * Registrar un retiro desde la oficina.
 * =============================================================================
 *
 * EL AGUJERO QUE TAPA. Hasta ahora un retiro solo podía nacer escaneando QR en
 * la app del conductor, y de ahí cuelga TODO: sin retiro no hay asignación, sin
 * asignación no hay manifiesto y sin manifiesto no hay ruta. Un conductor sin
 * batería, sin señal o sin teléfono bloqueaba el día entero **y nadie en la
 * oficina podía desatascarlo**.
 *
 * El propio alcance ya lo anticipaba —"el respaldo ante falla es seleccionar de
 * una lista, no teclear una cifra"— pero ese respaldo se especificó para la app
 * y nunca se construyó para la web.
 *
 * ⚠️ **Mismo gate que asignar** (`puedeAsignarYReasignarPedidos`) y no uno más
 * laxo: decidir quién cobra una visita es de la misma familia que decidir quién
 * lleva qué. Dueño, supervisor y coordinador; administración no.
 */
export default async function RegistrarRetiroPage() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        tono="filtro"
        titulo="No tienes acceso a esta pantalla"
        descripcion="Registrar un retiro genera el pago de la visita al conductor, así que requiere el mismo permiso que asignar pedidos."
        accion={
          <Button asChild variant="outline" size="sm">
            <Link href="/preparacion">Volver a Preparación del día</Link>
          </Button>
        }
      />
    );
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();
  const fecha = fechaLocalEnSantiago(new Date());

  const [conductoresRaw, bodegas, pedidos] = await Promise.all([
    listarConductores(cliente, tenantId),
    listarBodegasParaConductor(cliente, tenantId),
    listarPedidosPendientesDeRetiro(cliente, { tenantId, fecha }),
  ]);

  // Los disponibles primero, igual que en la bandeja de asignación: el que está
  // trabajando hoy es el candidato probable a haber ido a la bodega.
  const conductores = conductoresRaw
    .filter((c) => c.estado === "activo")
    .sort((a, b) => {
      if (a.disponible !== b.disponible) return a.disponible ? -1 : 1;
      return a.nombre.localeCompare(b.nombre, "es");
    })
    .map((c) => ({ id: c.id, nombre: c.nombre }));

  if (bodegas.length === 0) {
    return (
      <div className="space-y-6">
        <Cabecera />
        <EmptyState
          icon={ShieldAlert}
          tono="arranque"
          titulo="Todavía no hay bodegas de seller cargadas"
          descripcion="Un retiro ocurre en la bodega de un seller, así que primero hay que cargarlas en Configuración."
          accion={
            <Button asChild variant="outline" size="sm">
              <Link href="/configuracion/bodegas">Ir a Bodegas</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Cabecera />
      <FormularioRetiro conductores={conductores} bodegas={bodegas} pedidos={pedidos} />
    </div>
  );
}

function Cabecera() {
  return (
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Registrar retiro</h1>
      <p className="text-sm text-muted-foreground">
        Para cuando el retiro ocurrió pero no se pudo escanear. Queda registrado igual que en
        terreno: con su conductor, su bodega y su acta.
      </p>
    </header>
  );
}
