/**
 * Detalle del pedido para conductor — Pantalla 3-B (Flujo 3, PWA)
 *
 * Solo lectura. Sin ninguna acción de cambio de estado (B-2).
 * Texto grande, legible en movimiento. Enlace Google Maps + tel:.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, MapPin, Phone, AlertTriangle } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  traducirEstadoPedido,
  traducirTipoIncidencia,
  COLOR_ESTADO_PEDIDO,
} from "@/lib/ui/traduccion-estados";
import type { EstadoPedido, Pedido, Incidencia, TipoIncidencia } from "@/modules/operacion/tipos";

// =============================================================================
// Carga de datos
// =============================================================================

async function cargarPedidoConductor(
  pedidoId: string,
  driverId: string,
  tenantId: string,
): Promise<{ pedido: Pedido; incidenciaAbierta: Incidencia | null } | null> {
  const cliente = crearClienteServiceRole();

  // Verificar que el pedido está asignado a este conductor (aislamiento del conductor)
  const { data: asignacion } = await cliente
    .from("asignaciones_pedido")
    .select("pedido_id")
    .eq("pedido_id", pedidoId)
    .eq("driver_id", driverId)
    .eq("tenant_id", tenantId)
    .eq("activa", true)
    .maybeSingle();

  if (!asignacion) return null;

  const { data: p } = await cliente
    .from("pedidos")
    .select("*")
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!p) return null;

  const pedido: Pedido = {
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
  };

  // Buscar incidencia abierta
  const { data: incidencias } = await cliente
    .from("incidencias")
    .select("*")
    .eq("pedido_id", pedidoId)
    .eq("tenant_id", tenantId)
    .in("estado", ["abierta", "en_gestion"])
    .limit(1);

  const inc = incidencias?.[0] as Record<string, unknown> | undefined;
  const incidenciaAbierta: Incidencia | null = inc
    ? {
        id: inc.id as string,
        tenantId: inc.tenant_id as string,
        pedidoId: inc.pedido_id as string,
        sellerId: inc.seller_id as string,
        tipo: inc.tipo as TipoIncidencia,
        estado: inc.estado as Incidencia["estado"],
        descripcion: (inc.descripcion as string | null) ?? null,
        notasResolucion: (inc.notas_resolucion as string | null) ?? null,
        afectaCobro: (inc.afecta_cobro as boolean) ?? false,
        afectaLiquidacion: (inc.afecta_liquidacion as boolean) ?? false,
        abiertaPorUsuarioId: (inc.abierta_por_usuario_id as string | null) ?? null,
        resueltaPorUsuarioId: (inc.resuelta_por_usuario_id as string | null) ?? null,
        abiertaEn: inc.abierta_en as string,
        resueltaEn: (inc.resuelta_en as string | null) ?? null,
        creadoEn: inc.creado_en as string,
        actualizadoEn: inc.actualizado_en as string,
      }
    : null;

  return { pedido, incidenciaAbierta };
}

// =============================================================================
// Página
// =============================================================================

interface Props {
  params: Promise<{ pedidoId: string }>;
}

export default async function PaginaDetallePedidoConductor({ params }: Props) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) redirect("/login");

  const { pedidoId } = await params;
  const tenantId = sesion.usuario.tenantId;
  const driverId = sesion.usuario.driverId;

  const resultado = await cargarPedidoConductor(pedidoId, driverId, tenantId);
  if (!resultado) notFound();

  const { pedido, incidenciaAbierta } = resultado;

  // URL de Google Maps con la dirección completa
  const direccionCompleta = [pedido.destinatarioDireccion, pedido.destinatarioComuna, "Santiago"]
    .filter(Boolean)
    .join(", ");
  const urlGoogleMaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccionCompleta)}`;

  return (
    <div className="space-y-5 pb-6">
      {/* Volver */}
      <Link
        href="/conductor/manifiesto"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[48px]"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Volver al manifiesto
      </Link>

      {/* Estado actual — badge grande */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{pedido.destinatarioNombre}</h1>
        <span
          className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium flex-shrink-0 ${COLOR_ESTADO_PEDIDO[pedido.estado]}`}
        >
          {traducirEstadoPedido(pedido.estado)}
        </span>
      </div>

      {/* Dirección con enlace a Google Maps */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-start gap-3">
          <MapPin className="size-5 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-base font-medium">
              {pedido.destinatarioDireccion}
            </p>
            <p className="text-sm text-muted-foreground">{pedido.destinatarioComuna}</p>
          </div>
        </div>
        <a
          href={urlGoogleMaps}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          <MapPin className="size-4" aria-hidden="true" />
          Abrir en Google Maps
        </a>
      </div>

      {/* Teléfono (si existe) — enlace tel: */}
      {pedido.destinatarioTelefono && (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <Phone className="size-5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
            <div className="flex-1 space-y-1">
              <p className="text-xs text-muted-foreground">Teléfono del destinatario</p>
              <a
                href={`tel:${pedido.destinatarioTelefono}`}
                className="block min-h-[48px] flex items-center text-lg font-semibold text-primary hover:underline"
              >
                {pedido.destinatarioTelefono}
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Instrucciones de entrega (si existen) */}
      {pedido.instruccionesEntrega && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            Instrucciones de entrega
          </p>
          <p className="text-sm text-blue-900">{pedido.instruccionesEntrega}</p>
        </div>
      )}

      {/* Incidencia abierta — solo informativo (B-2) */}
      {incidenciaAbierta && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-1">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600 flex-shrink-0" aria-hidden="true" />
            <p className="text-sm font-semibold text-amber-800">
              Hay una incidencia abierta: {traducirTipoIncidencia(incidenciaAbierta.tipo)}
            </p>
          </div>
          <p className="text-xs text-amber-700">
            Si tienes información nueva, comenta con tu coordinador.
          </p>
        </div>
      )}
    </div>
  );
}
