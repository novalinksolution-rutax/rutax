/**
 * Detalle del pedido — Portal del seller (Visor POD incluido)
 *
 * Server Component. Solo lectura. El seller solo ve SUS pedidos (doble filtro
 * seller_id + tenant_id). El POD se consulta a través de la vista
 * `public.pruebas_entrega_seller` (SECURITY DEFINER) que NO expone foto_path,
 * lat, long ni precision_m — nunca se accede a `operacion.pruebas_entrega`
 * directamente desde el portal.
 *
 * Es el propio pedido del seller (no una vista pública): se muestran nombre,
 * teléfono, dirección e instrucciones del destinatario sin restricción de
 * minimización — a diferencia de `/tracking/[token]`, que es pública y sí
 * minimiza esos datos.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Package, CheckCircle2 } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerConexionesPorSeller } from "@/modules/integraciones/ml";
import {
  traducirEstadoPedido,
  BADGE_ESTADO_PEDIDO,
} from "@/lib/ui/traduccion-estados";
import { Badge } from "@/components/ui/badge";
import { VisorPodSeller, type PodSeller } from "./visor-pod-seller";
import { BotonCopiarTracking } from "./boton-copiar-tracking";
import { BloqueEtiqueta } from "../bloque-etiqueta";
import type { EstadoPedido } from "@/modules/operacion/tipos";

export const metadata: Metadata = {
  title: "Detalle del pedido",
};

// =============================================================================
// Tipos internos de la consulta
// =============================================================================

interface PedidoDetalle {
  id: string;
  tenantId: string;
  sellerId: string;
  estado: EstadoPedido;
  mlShipmentId: string | null;
  mlUserId: string | null;
  direccionDestinatario: string;
  comunaDestinatario: string;
  fechaCompromisoHora: string | null;
  creadoEn: string;
  tipoPedido: "flex" | "same_day";
  destinatarioNombre: string;
  destinatarioTelefono: string | null;
  instruccionesEntrega: string | null;
  /** Token opaco para el link público de seguimiento. Solo same-day. */
  trackingToken: string | null;
}

// =============================================================================
// Línea de tiempo simple (mismo vocabulario de `traducirEstadoPedido`, para
// consistencia con la página pública de tracking — RF-020/021).
// =============================================================================

/** Pasos "felices" del ciclo de vida — se muestran siempre en este orden. */
const PASOS_TIMELINE: EstadoPedido[] = ["pendiente_asignacion", "asignado", "en_ruta", "entregado"];

interface PasoTimeline {
  estado: EstadoPedido;
  alcanzado: boolean;
  actual: boolean;
}

/** Construye los pasos de la línea de tiempo según el estado actual del pedido. */
function construirTimeline(estadoActual: EstadoPedido): PasoTimeline[] {
  // Estados "de novedad" (fallido/cancelado/devuelto/correcciones manuales) no
  // tienen una posición fija en la línea feliz — se muestran aparte.
  const indiceActual = PASOS_TIMELINE.indexOf(estadoActual);

  if (indiceActual === -1) {
    // entregado_manual cuenta como "entregado" para la línea de tiempo.
    const equivalente = estadoActual === "entregado_manual" ? "entregado" : null;
    const idxEquivalente = equivalente ? PASOS_TIMELINE.indexOf(equivalente) : -1;
    return PASOS_TIMELINE.map((estado, i) => ({
      estado,
      alcanzado: idxEquivalente !== -1 && i <= idxEquivalente,
      actual: false,
    }));
  }

  return PASOS_TIMELINE.map((estado, i) => ({
    estado,
    alcanzado: i <= indiceActual,
    actual: i === indiceActual,
  }));
}

/** true si el estado es una "novedad" fuera de la línea feliz (mostrar aparte). */
function esEstadoDeNovedad(estado: EstadoPedido): boolean {
  return (
    estado === "fallido" ||
    estado === "fallido_manual" ||
    estado === "cancelado" ||
    estado === "devuelto"
  );
}

// =============================================================================
// Helpers
// =============================================================================

function idCorto(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function formatearFechaCorta(fechaIso: string): string {
  try {
    return new Date(fechaIso).toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/Santiago",
    });
  } catch {
    return fechaIso;
  }
}

function formatearFechaHora(fechaIso: string): string {
  try {
    return new Date(fechaIso).toLocaleString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Santiago",
    });
  } catch {
    return fechaIso;
  }
}

// Estados en los que puede existir un POD
const ESTADOS_CON_POD: EstadoPedido[] = [
  "entregado",
  "entregado_manual",
  "fallido",
  "fallido_manual",
];

// =============================================================================
// Página
// =============================================================================

interface Props {
  params: Promise<{ pedidoId: string }>;
}

export default async function PaginaDetallePedidoSeller({ params }: Props) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    redirect("/portal");
  }

  const { pedidoId } = await params;
  const sellerId = sesion.usuario.sellerId;
  const tenantId = sesion.usuario.tenantId;

  const cliente = crearClienteServiceRole();

  // -------------------------------------------------------------------------
  // Query del pedido — doble filtro seller_id + tenant_id (aislamiento seller)
  // -------------------------------------------------------------------------
  const { data: filaPedido, error: errorPedido } = await cliente
    .from("pedidos")
    .select(
      "id, tenant_id, seller_id, estado, ml_shipment_id, ml_user_id, destinatario_nombre, destinatario_telefono, destinatario_direccion, destinatario_comuna, instrucciones_entrega, fecha_compromiso_hora, creado_en, tipo_pedido, tracking_token",
    )
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .eq("seller_id", sellerId) // CRÍTICO: aislamiento seller
    .maybeSingle();

  if (errorPedido) {
    return (
      <div className="mx-auto max-w-2xl">
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No se pudo cargar el pedido. Intenta recargar la página.
        </div>
      </div>
    );
  }

  if (!filaPedido) notFound();

  const pedido: PedidoDetalle = {
    id: filaPedido.id as string,
    tenantId: filaPedido.tenant_id as string,
    sellerId: filaPedido.seller_id as string,
    estado: filaPedido.estado as EstadoPedido,
    mlShipmentId: (filaPedido.ml_shipment_id as string | null) ?? null,
    mlUserId: (filaPedido.ml_user_id as string | null) ?? null,
    direccionDestinatario: filaPedido.destinatario_direccion as string,
    comunaDestinatario: filaPedido.destinatario_comuna as string,
    fechaCompromisoHora: (filaPedido.fecha_compromiso_hora as string | null) ?? null,
    creadoEn: filaPedido.creado_en as string,
    tipoPedido: filaPedido.tipo_pedido as "flex" | "same_day",
    destinatarioNombre: filaPedido.destinatario_nombre as string,
    destinatarioTelefono: (filaPedido.destinatario_telefono as string | null) ?? null,
    instruccionesEntrega: (filaPedido.instrucciones_entrega as string | null) ?? null,
    trackingToken: (filaPedido.tracking_token as string | null) ?? null,
  };

  // -------------------------------------------------------------------------
  // Query POD — usa la vista `public.pruebas_entrega_seller` (SECURITY DEFINER)
  // que filtra columnas sensibles (foto_path, lat, long, precision_m).
  // Solo se intenta si el estado del pedido puede tener POD.
  // -------------------------------------------------------------------------
  let pod: PodSeller | null = null;
  const estadoTienePod = ESTADOS_CON_POD.includes(pedido.estado);

  if (estadoTienePod) {
    const { data: filaPod } = await cliente
      .from("pruebas_entrega_seller") // vista pública sin geo ni foto_path
      .select(
        "id, pedido_id, tenant_id, tipo_resultado, es_valido, capturado_en, tipo_incidencia, tiene_foto",
      )
      .eq("pedido_id", pedidoId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (filaPod) {
      pod = {
        id: filaPod.id as string,
        pedidoId: filaPod.pedido_id as string,
        tenantId: filaPod.tenant_id as string,
        tipoResultado: filaPod.tipo_resultado as "entregado" | "fallido",
        esValido: filaPod.es_valido as boolean,
        capturadoEn: filaPod.capturado_en as string,
        tipoIncidencia: (filaPod.tipo_incidencia as string | null) ?? null,
        tieneFoto: filaPod.tiene_foto as boolean,
      };
    }
  }

  // Cuenta de origen — solo se muestra si el seller tiene MÁS DE UNA cuenta ML.
  let cuentaOrigen: string | null = null;
  try {
    const conexiones = await obtenerConexionesPorSeller(sellerId);
    if (conexiones.length > 1 && pedido.mlUserId) {
      const c = conexiones.find((x) => x.mlUserId === pedido.mlUserId);
      if (c) cuentaOrigen = c.alias?.trim() || c.mlNickname?.trim() || `···${(c.mlUserId ?? "").slice(-4)}`;
    }
  } catch {
    // best-effort — sin la fila si falla la lectura de conexiones.
  }

  // Identificador legible para el usuario
  const idVisible = pedido.mlShipmentId ?? `#${idCorto(pedido.id)}`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Breadcrumb / Volver */}
      <Link
        href="/portal/pedidos"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Volver a mis pedidos
      </Link>

      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Package className="size-5 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {idVisible}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {pedido.tipoPedido === "flex" ? "Flex (Mercado Libre)" : "Same-day"}
          </p>
        </div>
        <Badge variant={BADGE_ESTADO_PEDIDO[pedido.estado]} className="px-3 py-1 text-sm">
          {traducirEstadoPedido(pedido.estado)}
        </Badge>
      </div>

      {/* Línea de tiempo del estado */}
      <SeccionTimeline estado={pedido.estado} />

      {/* Seguimiento en vivo (solo same-day — Flex usa el seguimiento de ML) */}
      {pedido.tipoPedido === "same_day" && pedido.trackingToken && (
        <section aria-labelledby="tracking-titulo" className="rounded-xl border bg-card p-4 sm:p-5">
          <h2
            id="tracking-titulo"
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Seguimiento en vivo
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Comparte este enlace con el destinatario para que siga el pedido en tiempo real.
          </p>
          <BotonCopiarTracking trackingToken={pedido.trackingToken} />
        </section>
      )}

      {/* Etiqueta imprimible con QR (solo same-day) */}
      {pedido.tipoPedido === "same_day" && (
        <section aria-labelledby="etiqueta-titulo" className="rounded-xl border bg-card p-4 sm:p-5">
          <h2
            id="etiqueta-titulo"
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Etiqueta con QR
          </h2>
          <BloqueEtiqueta pedidoId={pedido.id} />
        </section>
      )}

      {/* Detalle del pedido */}
      <section aria-labelledby="detalle-titulo" className="rounded-xl border bg-card p-4 sm:p-5">
        <h2
          id="detalle-titulo"
          className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Información del envío
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Destinatario — es el pedido del propio seller, sin restricción de minimización */}
          <div>
            <dt className="text-xs text-muted-foreground">Destinatario</dt>
            <dd className="mt-0.5 font-medium">{pedido.destinatarioNombre}</dd>
          </div>

          {pedido.destinatarioTelefono && (
            <div>
              <dt className="text-xs text-muted-foreground">Teléfono</dt>
              <dd className="mt-0.5 font-medium">{pedido.destinatarioTelefono}</dd>
            </div>
          )}

          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Dirección de entrega</dt>
            <dd className="mt-0.5 font-medium">
              {pedido.direccionDestinatario}
              <span className="ml-1 text-muted-foreground font-normal">
                — {pedido.comunaDestinatario}
              </span>
            </dd>
          </div>

          {pedido.instruccionesEntrega && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Instrucciones para el conductor</dt>
              <dd className="mt-0.5 text-muted-foreground">{pedido.instruccionesEntrega}</dd>
            </div>
          )}

          {/* Fecha compromiso */}
          {pedido.fechaCompromisoHora && (
            <div>
              <dt className="text-xs text-muted-foreground">Fecha compromiso</dt>
              <dd className="mt-0.5 font-medium">
                {formatearFechaHora(pedido.fechaCompromisoHora)}
              </dd>
            </div>
          )}

          {/* Fecha de ingreso */}
          <div>
            <dt className="text-xs text-muted-foreground">Fecha de ingreso</dt>
            <dd className="mt-0.5 text-muted-foreground">
              {formatearFechaCorta(pedido.creadoEn)}
            </dd>
          </div>

          {/* ID de referencia */}
          <div>
            <dt className="text-xs text-muted-foreground">Referencia interna</dt>
            <dd className="mt-0.5 font-mono text-xs text-muted-foreground">
              #{idCorto(pedido.id)}
            </dd>
          </div>

          {/* ML Shipment ID (solo si existe) */}
          {pedido.mlShipmentId && (
            <div>
              <dt className="text-xs text-muted-foreground">N° de seguimiento ML</dt>
              <dd className="mt-0.5 font-mono text-xs text-muted-foreground">
                {pedido.mlShipmentId}
              </dd>
            </div>
          )}

          {/* Cuenta de origen — solo si el seller tiene más de una cuenta ML */}
          {cuentaOrigen && (
            <div>
              <dt className="text-xs text-muted-foreground">Cuenta de origen</dt>
              <dd className="mt-0.5 font-medium">{cuentaOrigen}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Sección POD — solo si el estado del pedido puede tenerlo */}
      {estadoTienePod && (
        <section aria-labelledby="pod-titulo">
          <h2
            id="pod-titulo"
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Resultado de la entrega
          </h2>
          {pod ? (
            <VisorPodSeller pod={pod} />
          ) : (
            <div className="rounded-xl border bg-card px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No se ha registrado la prueba de entrega para este pedido todavía.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// =============================================================================
// Línea de tiempo del estado
// =============================================================================

function SeccionTimeline({ estado }: { estado: EstadoPedido }) {
  const novedad = esEstadoDeNovedad(estado);
  const pasos = construirTimeline(estado);

  return (
    <section aria-labelledby="timeline-titulo">
      <h2
        id="timeline-titulo"
        className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Estado actual
      </h2>
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <ol className="flex flex-col gap-0 sm:flex-row sm:items-start sm:gap-0">
          {pasos.map((paso, i) => (
            <li key={paso.estado} className="flex flex-1 items-start gap-3 sm:flex-col sm:items-center sm:gap-2 sm:text-center">
              <div className="flex flex-col items-center sm:w-full sm:flex-row">
                <div
                  className={[
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    paso.alcanzado
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  {paso.alcanzado ? <CheckCircle2 className="size-3.5" /> : i + 1}
                </div>
                {i < pasos.length - 1 && (
                  <div
                    className={[
                      "w-px flex-1 sm:h-px sm:w-full",
                      "min-h-6 sm:min-h-0",
                      paso.alcanzado ? "bg-primary" : "bg-border",
                    ].join(" ")}
                    aria-hidden="true"
                  />
                )}
              </div>
              <p
                className={[
                  "pb-4 text-xs sm:pb-0",
                  paso.actual ? "font-semibold text-foreground" : "text-muted-foreground",
                ].join(" ")}
              >
                {traducirEstadoPedido(paso.estado)}
              </p>
            </li>
          ))}
        </ol>

        {/* Estado de novedad — se muestra aparte, la línea feliz no lo representa */}
        {novedad && (
          <div className="mt-4 rounded-lg bg-warning-subtle px-3 py-2.5 text-sm text-warning-subtle-foreground">
            Estado actual: <span className="font-semibold">{traducirEstadoPedido(estado)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
