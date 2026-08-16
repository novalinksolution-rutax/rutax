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
import { BadgeEstado } from "@/components/ui/badge-estado";
import { VisorPodSeller, type PodSeller } from "./visor-pod-seller";
import { BotonCopiarTracking } from "./boton-copiar-tracking";
import { DialogCancelarPedido } from "./dialog-cancelar-pedido";
import { BloqueEtiqueta } from "../bloque-etiqueta";
import { ESTADOS_TERMINALES } from "@/modules/operacion/tipos";
import type { EstadoPedido, FuentePedido } from "@/modules/operacion/tipos";
import { esTransicionValida } from "@/modules/operacion/maquina-estados";
import { puedeGestionarPedidosPropios } from "@/modules/identidad/capacidades";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";

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
  fuente: FuentePedido;
  destinatarioNombre: string;
  destinatarioTelefono: string | null;
  instruccionesEntrega: string | null;
  /** Token opaco para el link público de seguimiento. Solo same-day. */
  trackingToken: string | null;
  // Columnas de cancelación (migración 20260811000003) — §6.1/§9 del diseño.
  canceladoEn: string | null;
  canceladoPorUsuarioId: string | null;
  motivoCancelacion: string | null;
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

/**
 * true si el estado es una "novedad" fuera de la línea feliz (mostrar aparte,
 * banner de advertencia). 'cancelado' NO cuenta como novedad de advertencia:
 * es un estado neutral (no una alarma) y ya tiene su propia sección
 * "Cancelación" con motivo + quién, en tono neutral — repetirlo aquí en
 * warning-subtle lo pintaría como algo que requiere atención cuando no la
 * requiere (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md, tarea 17 de
 * §11: "el rojo del sistema está reservado a lo accionable").
 */
function esEstadoDeNovedad(estado: EstadoPedido): boolean {
  return estado === "fallido" || estado === "fallido_manual" || estado === "devuelto";
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
      "id, tenant_id, seller_id, estado, ml_shipment_id, ml_user_id, destinatario_nombre, destinatario_telefono, destinatario_direccion, destinatario_comuna, instrucciones_entrega, fecha_compromiso_hora, creado_en, tipo_pedido, fuente, tracking_token, cancelado_en, cancelado_por_usuario_id, motivo_cancelacion",
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
    fuente: (filaPedido.fuente as FuentePedido | null) ?? "ml_flex",
    destinatarioNombre: filaPedido.destinatario_nombre as string,
    destinatarioTelefono: (filaPedido.destinatario_telefono as string | null) ?? null,
    instruccionesEntrega: (filaPedido.instrucciones_entrega as string | null) ?? null,
    trackingToken: (filaPedido.tracking_token as string | null) ?? null,
    canceladoEn: (filaPedido.cancelado_en as string | null) ?? null,
    canceladoPorUsuarioId: (filaPedido.cancelado_por_usuario_id as string | null) ?? null,
    motivoCancelacion: (filaPedido.motivo_cancelacion as string | null) ?? null,
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

  // "Quién canceló" (§6.1/§16), sin exponer el nombre de un usuario interno al
  // portal (minimización — el seller no necesita saber cuál persona del
  // courier lo hizo). Solo se distingue por tipo_usuario; el caso más común
  // ("lo cancelé yo mismo") se resuelve por comparación directa de sesión.
  let canceladoPorTexto: string | null = null;
  if (pedido.canceladoEn) {
    if (!pedido.canceladoPorUsuarioId) {
      canceladoPorTexto = "Sincronización automática";
    } else if (pedido.canceladoPorUsuarioId === sesion.usuarioId) {
      canceladoPorTexto = "Tú";
    } else {
      try {
        const { data: actor } = await cliente
          .schema("identidad")
          .from("usuarios_perfil")
          .select("tipo_usuario")
          .eq("id", pedido.canceladoPorUsuarioId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        canceladoPorTexto = actor?.tipo_usuario === "seller" ? "Tu equipo" : "El courier";
      } catch {
        canceladoPorTexto = null;
      }
    }
  }

  // Ventana de cancelación del seller (docs/arquitectura/edicion-y-cancelacion-
  // de-pedidos.md §3.1): llega hasta 'asignado', nunca 'en_ruta' — y solo
  // same-day, sin excepción (un Flex vivo lo gobierna Mercado Envíos).
  const puedeCancelarSeller =
    puedeGestionarPedidosPropios(sesion.usuario) &&
    pedido.tipoPedido === "same_day" &&
    esTransicionValida(pedido.estado, "cancelado", "seller");
  const yaSalioARuta = pedido.tipoPedido === "same_day" && pedido.estado === "en_ruta";

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
            {etiquetaFuentePedido(pedido.fuente)}
          </p>
        </div>
        <BadgeEstado
          variante={BADGE_ESTADO_PEDIDO[pedido.estado]}
          texto={traducirEstadoPedido(pedido.estado)}
          className="px-3 py-1 text-sm"
        />
      </div>

      {/* Línea de tiempo del estado */}
      <SeccionTimeline estado={pedido.estado} />

      {/* Cancelación (§6.1/§16): solo si el pedido ya está cancelado. Estado
          neutral — nunca en tono destructivo, no es una alarma. */}
      {pedido.estado === "cancelado" && (
        <SeccionCancelacion
          canceladoEn={pedido.canceladoEn}
          canceladoPorTexto={canceladoPorTexto}
          motivo={pedido.motivoCancelacion}
        />
      )}

      {/* Seguimiento en vivo (solo same-day — Flex usa el seguimiento de ML) */}
      {pedido.tipoPedido === "same_day" && pedido.trackingToken && (
        <section aria-labelledby="tracking-titulo" className="rounded-lg border bg-card p-4 sm:p-5">
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

      {/* Etiqueta imprimible con QR (solo same-day, nunca en estados terminales
          — §16: no tiene sentido imprimir la etiqueta de un pedido cancelado). */}
      {pedido.tipoPedido === "same_day" && !ESTADOS_TERMINALES.includes(pedido.estado) && (
        <section aria-labelledby="etiqueta-titulo" className="rounded-lg border bg-card p-4 sm:p-5">
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
      <section aria-labelledby="detalle-titulo" className="rounded-lg border bg-card p-4 sm:p-5">
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
            <div className="rounded-lg border bg-card px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No se ha registrado la prueba de entrega para este pedido todavía.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Acciones — solo same-day, según la ventana del seller (§3.1). En
          'en_ruta' no hay botón: el paquete ya va en el vehículo, y una
          cancelación unilateral desde el portal desincroniza al conductor sin
          que el courier se entere. */}
      {(puedeCancelarSeller || yaSalioARuta) && (
        <section aria-labelledby="acciones-titulo" className="rounded-lg border bg-card p-4 sm:p-5">
          <h2
            id="acciones-titulo"
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Acciones
          </h2>
          {puedeCancelarSeller ? (
            <DialogCancelarPedido pedidoId={pedido.id} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Este pedido ya salió a ruta. Si necesitas cancelarlo, contacta al courier.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

// =============================================================================
// Sección de cancelación — motivo + quién, en tono neutral (§6.1/§16)
// =============================================================================

function SeccionCancelacion({
  canceladoEn,
  canceladoPorTexto,
  motivo,
}: {
  canceladoEn: string | null;
  canceladoPorTexto: string | null;
  motivo: string | null;
}) {
  return (
    <section aria-labelledby="cancelacion-titulo" className="rounded-lg border bg-card p-4 sm:p-5">
      <h2
        id="cancelacion-titulo"
        className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Cancelación
      </h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Cancelado el</dt>
          <dd className="mt-0.5 font-medium">
            {canceladoEn ? formatearFechaHora(canceladoEn) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Cancelado por</dt>
          <dd className="mt-0.5 font-medium">{canceladoPorTexto ?? "—"}</dd>
        </div>
      </dl>
      {motivo && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">Motivo</p>
          <p className="mt-0.5 italic">&ldquo;{motivo}&rdquo;</p>
        </div>
      )}
    </section>
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
      <div className="rounded-lg border bg-card p-4 sm:p-5">
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
