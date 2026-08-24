import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeSolicitarSameDay } from "@/modules/identidad/capacidades";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { evaluarVentanaCorte } from "@/modules/operacion/ventanas-corte";
import { FormularioNuevoPedido } from "./formulario-nuevo-pedido";

export const metadata: Metadata = {
  // El mismo nombre que el `h1` y que el botón que trae acá.
  title: "Crear pedido same-day",
};

export default async function PaginaNuevoPedido() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    redirect("/login");
  }
  if (!puedeSolicitarSameDay(sesion.usuario)) {
    redirect("/portal/pedidos");
  }

  // El aviso de corte, EN LÍNEA y no como acuse posterior.
  // ---------------------------------------------------------------------------
  // El dato ya se calculaba, pero se mostraba **después** de crear el pedido,
  // dentro del bloque de éxito. Eso es un acuse, no un aviso: llega cuando la
  // decisión ya se tomó. El patrón del tablero es «formulario de alta con aviso
  // en línea», y la diferencia es justo esa — el seller tiene que saber que va a
  // salir mañana MIENTRAS llena el formulario, no cuando ya lo mandó.
  //
  // Se evalúa sin zona (`zonaId: null`): la zona depende de la comuna, que
  // todavía no se escribió. La ventana por defecto del seller es la que aplica
  // salvo override por zona, y avisar con la general es mejor que no avisar.
  const cliente = crearClienteServiceRole();
  const [evaluacion, tenantFila] = await Promise.all([
    evaluarVentanaCorte(cliente, {
      tenantId: sesion.usuario.tenantId,
      sellerId: sesion.usuario.sellerId,
      zonaId: null,
      tipoEntrega: "same_day",
    }).catch(() => null),
    cliente
      .from("tenants")
      .select("nombre_fantasia")
      .eq("id", sesion.usuario.tenantId)
      .maybeSingle(),
  ]);

  const avisoCorte =
    evaluacion?.corteRiesgo && evaluacion.ventana
      ? {
          horaCorte: evaluacion.ventana.horaCorte,
          nombreCourier:
            (tenantFila.data?.nombre_fantasia as string | undefined) ?? "tu empresa de despacho",
        }
      : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/portal/pedidos"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
          Mis pedidos
        </Link>
        <h1 className="font-heading text-2xl font-semibold">Crear pedido same-day</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          El envío quedará en estado <em>pendiente de asignación</em> hasta que el courier lo
          asigne a un conductor. Puedes cargar varios envíos seguidos: el formulario
          queda listo para el siguiente apenas confirmas uno.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <FormularioNuevoPedido avisoCorte={avisoCorte} />
      </div>
    </div>
  );
}
