/**
 * Selector de pedidos para el manifiesto — Pantalla 2-C (Flujo 2)
 *
 * Server Component. Lista pedidos en estado pendiente_asignacion con checkboxes,
 * filtros por seller y comuna, barra sticky al fondo. Advertencia obligatoria si
 * algún pedido seleccionado ya tiene conductor asignado (B-5).
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import type { Manifiesto, EstadoManifiesto, Pedido, EstadoPedido } from "@/modules/operacion/tipos";
import { SelectorPedidosManifiesto } from "./selector-pedidos-manifiesto";

// =============================================================================
// Tipos auxiliares
// =============================================================================

interface PedidoDisponible {
  pedido: Pedido;
  /** Nombre del conductor si ya está asignado (estado = asignado) */
  nombreConductorActual: string | null;
  /** Nombre del manifiesto actual si ya está asignado */
  nombreManifiestoActual: string | null;
}

// =============================================================================
// Carga de datos
// =============================================================================

async function cargarManifiesto(
  manifiestoId: string,
  tenantId: string,
): Promise<Manifiesto | null> {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .from("manifiestos")
    .select("*")
    .eq("id", manifiestoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id as string,
    tenantId: data.tenant_id as string,
    driverId: data.driver_id as string,
    nombre: data.nombre as string,
    fechaOperacion: data.fecha_operacion as string,
    estado: data.estado as EstadoManifiesto,
    notas: (data.notas as string | null) ?? null,
    creadoPorUsuarioId: (data.creado_por_usuario_id as string | null) ?? null,
    confirmadoEn: (data.confirmado_en as string | null) ?? null,
    completadoEn: (data.completado_en as string | null) ?? null,
    creadoEn: data.creado_en as string,
    actualizadoEn: data.actualizado_en as string,
  };
}

async function cargarPedidosDisponibles(
  tenantId: string,
  filtroSellerId?: string,
  filtroComuna?: string,
): Promise<PedidoDisponible[]> {
  const cliente = crearClienteServiceRole();

  // Traer pedidos en estado pendiente_asignacion (y asignado para advertencia)
  let query = cliente
    .from("pedidos")
    .select("*")
    .eq("tenant_id", tenantId)
    .in("estado", ["pendiente_asignacion", "asignado"])
    .order("fecha_compromiso", { ascending: true });

  if (filtroSellerId) query = query.eq("seller_id", filtroSellerId);
  if (filtroComuna) query = query.ilike("destinatario_comuna", `%${filtroComuna}%`);

  const { data, error } = await query.limit(100);
  if (error || !data) return [];

  const pedidos: Pedido[] = (data as Record<string, unknown>[]).map((p) => ({
    id: p.id as string,
    tenantId: p.tenant_id as string,
    sellerId: p.seller_id as string,
    tipoPedido: p.tipo_pedido as Pedido["tipoPedido"],
    origen: p.origen as Pedido["origen"],
    mlOrderId: (p.ml_order_id as string | null) ?? null,
    mlShipmentId: (p.ml_shipment_id as string | null) ?? null,
    estado: p.estado as EstadoPedido,
    estadoMl: (p.estado_ml as string | null) ?? null,
    subestadoMl: (p.subestado_ml as string | null) ?? null,
    ultimaSyncMlEn: (p.ultima_sync_ml_en as string | null) ?? null,
    driverIdAsignado: (p.driver_id_asignado as string | null) ?? null,
    destinatarioNombre: p.destinatario_nombre as string,
    destinatarioDireccion: p.destinatario_direccion as string,
    destinatarioComuna: p.destinatario_comuna as string,
    destinatarioTelefono: (p.destinatario_telefono as string | null) ?? null,
    instruccionesEntrega: (p.instrucciones_entrega as string | null) ?? null,
    fechaCompromiso: (p.fecha_compromiso as string | null) ?? null,
    tarifaAplicableId: (p.tarifa_aplicable_id as string | null) ?? null,
    notasInternas: (p.notas_internas as string | null) ?? null,
    creadoEn: p.creado_en as string,
    actualizadoEn: p.actualizado_en as string,
  }));

  // Para los pedidos ya asignados, buscar el conductor y manifiesto actuales
  const pedidosAsignados = pedidos.filter((p) => p.estado === "asignado");
  const nombresMap = new Map<string, { conductor: string | null; manifiesto: string | null }>();

  if (pedidosAsignados.length > 0) {
    const { data: asignaciones } = await cliente
      .from("asignaciones_pedido")
      .select("pedido_id, driver_id, manifiestos(nombre), perfiles_usuario:driver_id(nombre_completo)")
      .in(
        "pedido_id",
        pedidosAsignados.map((p) => p.id),
      )
      .eq("tenant_id", tenantId)
      .eq("activa", true);

    (asignaciones ?? []).forEach((a: Record<string, unknown>) => {
      const perfil = a.perfiles_usuario as Record<string, unknown> | null;
      const manifiestoData = a.manifiestos as Record<string, unknown> | null;
      nombresMap.set(a.pedido_id as string, {
        conductor: (perfil?.nombre_completo as string | null) ?? (a.driver_id as string),
        manifiesto: (manifiestoData?.nombre as string | null) ?? null,
      });
    });
  }

  return pedidos.map((pedido) => ({
    pedido,
    nombreConductorActual: nombresMap.get(pedido.id)?.conductor ?? null,
    nombreManifiestoActual: nombresMap.get(pedido.id)?.manifiesto ?? null,
  }));
}

async function cargarSellers(tenantId: string): Promise<{ id: string; nombre: string }[]> {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .from("sellers")
    .select("id, razon_social")
    .eq("tenant_id", tenantId)
    .order("razon_social");
  return (data ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    nombre: (s.razon_social as string) ?? (s.id as string),
  }));
}

// =============================================================================
// Página
// =============================================================================

interface Props {
  params: Promise<{ manifiestoId: string }>;
  searchParams: Promise<{ seller?: string; comuna?: string }>;
}

export default async function PaginaAsignarPedidos({ params, searchParams }: Props) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    redirect("/manifiestos");
  }

  const { manifiestoId } = await params;
  const sp = await searchParams;
  const tenantId = sesion.usuario.tenantId;

  const manifiesto = await cargarManifiesto(manifiestoId, tenantId);
  if (!manifiesto) notFound();

  // Solo se puede asignar pedidos si el manifiesto está en borrador
  if (manifiesto.estado !== "borrador") {
    redirect(`/manifiestos/${manifiestoId}`);
  }

  const [pedidosDisponibles, sellers] = await Promise.all([
    cargarPedidosDisponibles(tenantId, sp.seller, sp.comuna),
    cargarSellers(tenantId),
  ]);

  return (
    <div className="space-y-6 pb-28">
      {/* Volver */}
      <Link
        href={`/manifiestos/${manifiestoId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Volver al manifiesto
      </Link>

      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold">Agregar pedidos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manifiesto: <span className="font-medium text-foreground">{manifiesto.nombre}</span>
        </p>
      </div>

      {/* Filtros */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-seller" className="text-xs font-medium text-muted-foreground">
            Seller
          </label>
          <select
            id="f-seller"
            name="seller"
            defaultValue={sp.seller ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos los sellers</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-comuna" className="text-xs font-medium text-muted-foreground">
            Comuna
          </label>
          <input
            id="f-comuna"
            name="comuna"
            type="text"
            defaultValue={sp.comuna ?? ""}
            placeholder="Ej: Providencia"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Filtrar
        </button>
        {(sp.seller || sp.comuna) && (
          <Link
            href={`/manifiestos/${manifiestoId}/asignar`}
            className="h-9 flex items-center px-3 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Limpiar
          </Link>
        )}
      </form>

      {/* Lista de pedidos con selector interactivo */}
      <SelectorPedidosManifiesto
        manifiestoId={manifiestoId}
        pedidosDisponibles={pedidosDisponibles}
      />
    </div>
  );
}
