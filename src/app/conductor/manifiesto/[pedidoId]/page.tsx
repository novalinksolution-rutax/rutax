/**
 * Detalle del pedido para conductor — Pantalla 3-B (Flujo 3, PWA)
 *
 * Solo lectura para Flex. Para same-day en estado 'en_ruta': acciones de
 * entrega/fallo con captura de foto y GPS (Bloque 2).
 *
 * FRONTERA DURA: las acciones de entrega aparecen SOLO si tipoPedido==='same_day'
 * Y estado==='en_ruta'. Para Flex, banner permanente de solo lectura.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, MapPin, Navigation, Phone, AlertTriangle, Clock } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { urlGoogleMapsBusqueda, urlWazeBusqueda } from "@/lib/ui/mapas";
import { Badge } from "@/components/ui/badge";
import {
  traducirEstadoPedido,
  traducirTipoIncidencia,
  BADGE_ESTADO_PEDIDO,
} from "@/lib/ui/traduccion-estados";
import type { EstadoPedido, Pedido, Incidencia, TipoIncidencia } from "@/modules/operacion/tipos";
import { obtenerEtaSameDay, formatearEtaSameDay } from "@/modules/operacion/eta-same-day";
import { AccionesSameDay, BannerFlexSoloLectura } from "./acciones-same-day";

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
    // Columnas de geocoding (migración 0013 — F4, ítem 1.1)
    lat: (p.lat as number | null) ?? null,
    long: (p.long as number | null) ?? null,
    geoEstado: ((p.geo_estado as string | null) ?? 'pendiente') as import("@/modules/operacion/tipos").EstadoGeocoding,
    geoConfianza: (p.geo_confianza as number | null) ?? null,
    geocodificadoEn: (p.geocodificado_en as string | null) ?? null,
    coberturaEstado: ((p.cobertura_estado as string | null) ?? 'pendiente') as import("@/modules/operacion/tipos").CoberturaEstado,
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

  // Enlaces de navegación (Google Maps + Waze) a la dirección de la parada.
  const direccionCompleta = [pedido.destinatarioDireccion, pedido.destinatarioComuna, "Santiago"]
    .filter(Boolean)
    .join(", ");
  const urlGoogleMaps = urlGoogleMapsBusqueda(direccionCompleta);
  const urlWaze = urlWazeBusqueda(direccionCompleta);

  // ETA (solo same-day)
  const esSameDay = pedido.tipoPedido === "same_day";
  const estaEnRuta = pedido.estado === "en_ruta";
  const esFlex = pedido.tipoPedido === "flex";

  const etaStr = esSameDay
    ? formatearEtaSameDay(obtenerEtaSameDay(pedido))
    : null;

  return (
    <div className="space-y-5 pb-28">
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
        <Badge
          variant={BADGE_ESTADO_PEDIDO[pedido.estado]}
          className="shrink-0 px-3 py-1 text-sm"
        >
          {traducirEstadoPedido(pedido.estado)}
        </Badge>
      </div>

      {/* ETA same-day (si existe) */}
      {etaStr && estaEnRuta && (
        <div className="flex items-center gap-2 rounded-xl bg-info-subtle px-4 py-3 text-info-subtle-foreground">
          <Clock className="size-4 flex-shrink-0" aria-hidden="true" />
          <p className="text-sm">
            Entrega prometida para las <span className="font-semibold">{etaStr}</span>
          </p>
        </div>
      )}

      {/* Banner Flex — solo lectura */}
      {esFlex && <BannerFlexSoloLectura />}

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
        <div className="grid grid-cols-2 gap-2">
          <a
            href={urlGoogleMaps}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-info px-4 text-sm font-semibold text-info-foreground transition-colors hover:bg-info/90"
          >
            <MapPin className="size-4" aria-hidden="true" />
            Google Maps
          </a>
          <a
            href={urlWaze}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-info bg-card px-4 text-sm font-semibold text-info transition-colors hover:bg-info-subtle"
          >
            <Navigation className="size-4" aria-hidden="true" />
            Waze
          </a>
        </div>
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
                className="flex min-h-[48px] items-center text-lg font-semibold text-primary hover:underline"
              >
                {pedido.destinatarioTelefono}
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Instrucciones de entrega (si existen) */}
      {pedido.instruccionesEntrega && (
        <div className="space-y-1 rounded-xl bg-info-subtle p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-info-subtle-foreground">
            Instrucciones de entrega
          </p>
          <p className="text-sm text-info-subtle-foreground">{pedido.instruccionesEntrega}</p>
        </div>
      )}

      {/* Incidencia abierta — solo informativo */}
      {incidenciaAbierta && (
        <div className="space-y-1 rounded-xl bg-warning-subtle p-4 text-warning-subtle-foreground">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <p className="text-sm font-semibold">
              Hay una incidencia abierta: {traducirTipoIncidencia(incidenciaAbierta.tipo)}
            </p>
          </div>
          <p className="text-xs opacity-80">
            Si tienes información nueva, comenta con tu coordinador.
          </p>
        </div>
      )}

      {/* ====================================================================
          FRONTERA DURA: acciones de entrega SOLO para same-day en_ruta.
          Para Flex → el banner superior ya indica que deben usar la app Flex.
          ==================================================================== */}
      {esSameDay && estaEnRuta && (
        <section aria-labelledby="acciones-entrega-titulo">
          <h2 id="acciones-entrega-titulo" className="sr-only">
            Acciones de entrega
          </h2>
          <AccionesSameDay pedidoId={pedido.id} />
        </section>
      )}

      {/* Estado terminal — pedido ya resuelto */}
      {(pedido.estado === "entregado" || pedido.estado === "fallido") && (
        <div className="rounded-xl bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
          {pedido.estado === "entregado"
            ? "Este pedido fue marcado como entregado."
            : "Este pedido fue marcado como no entregado."}
        </div>
      )}
    </div>
  );
}
