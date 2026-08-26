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
import { CheckCircle2 } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerConexionesPorSeller } from "@/modules/integraciones/ml";
import { BADGE_ESTADO_PEDIDO } from "@/lib/ui/traduccion-estados";
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
import {
  estadoPedidoParaSeller,
  hitoLineaPortal,
  textoLlegada,
} from "@/lib/ui/vocabulario-portal";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { DialogoReportar } from "../../incidencias/dialogo-reportar";
import { Retorno, destinoRetorno } from "@/components/app-shell/retorno";

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
  mlOrderId: string | null;
  mlUserId: string | null;
  /** El código con que el seller identifica el envío. */
  codigoInterno: string | null;
  /** Fecha civil comprometida ('YYYY-MM-DD'), para el «llega». */
  fechaCompromiso: string | null;
  /** La tarifa con la que se le va a cobrar esta entrega. */
  tarifaAplicableId: string | null;
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
// Línea de tiempo simple. Habla el idioma del seller, igual que el resto de la
// hoja: los cuatro hitos salen de `hitoLineaPortal` (RF-020/021).
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
  searchParams: Promise<{ volver?: string }>;
}

export default async function PaginaDetallePedidoSeller({ params, searchParams }: Props) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    redirect("/portal");
  }

  const { pedidoId } = await params;
  const { volver } = await searchParams;
  const sellerId = sesion.usuario.sellerId;
  const tenantId = sesion.usuario.tenantId;

  const cliente = crearClienteServiceRole();

  // -------------------------------------------------------------------------
  // Query del pedido — doble filtro seller_id + tenant_id (aislamiento seller)
  // -------------------------------------------------------------------------
  const { data: filaPedido, error: errorPedido } = await cliente
    .from("pedidos")
    .select(
      // `codigo_interno` y `fecha_compromiso` para el encabezado; `tarifa_aplicable_id`
      // para poder decir qué se le va a cobrar — el bloque de dinero que la hoja
      // no tenía.
      "id, tenant_id, seller_id, estado, ml_shipment_id, ml_order_id, ml_user_id, codigo_interno, destinatario_nombre, destinatario_telefono, destinatario_direccion, destinatario_comuna, instrucciones_entrega, fecha_compromiso, fecha_compromiso_hora, creado_en, tipo_pedido, fuente, tracking_token, tarifa_aplicable_id, cancelado_en, cancelado_por_usuario_id, motivo_cancelacion",
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
    mlOrderId: (filaPedido.ml_order_id as string | null) ?? null,
    mlUserId: (filaPedido.ml_user_id as string | null) ?? null,
    codigoInterno: (filaPedido.codigo_interno as string | null) ?? null,
    fechaCompromiso: (filaPedido.fecha_compromiso as string | null) ?? null,
    tarifaAplicableId: (filaPedido.tarifa_aplicable_id as string | null) ?? null,
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
  const idVisible = pedido.codigoInterno ?? pedido.mlShipmentId ?? `#${idCorto(pedido.id)}`;

  // El nombre del courier, para hablar de él por su nombre y no como «tu
  // empresa de despacho».
  const { data: tenantFila } = await cliente
    .from("tenants")
    .select("nombre_fantasia")
    .eq("id", tenantId)
    .maybeSingle();
  const nombreCourier =
    (tenantFila?.nombre_fantasia as string | undefined) ?? "tu empresa de despacho";

  // -------------------------------------------------------------------------
  // Lo que le van a cobrar por esta entrega.
  // -------------------------------------------------------------------------
  // 🐞 EL BLOQUE DE DINERO NO EXISTÍA. La consulta no traía tarifa ni período:
  // el seller veía a dónde va su paquete y no cuánto le va a costar, que es la
  // otra mitad de la pregunta. Y es la información que después reclama por
  // teléfono al ver el total del mes.
  //
  // Se lee la LÍNEA DE COBRO si ya existe —es la cifra real, la que se va a
  // facturar— y si todavía no (el pedido no se entregó), la tarifa vigente como
  // estimación, dicha como estimación.
  let cobro: {
    montoClp: number;
    concepto: string;
    /** `true` cuando sale de la línea ya generada; `false` cuando es la tarifa. */
    esDefinitivo: boolean;
    periodoEtiqueta: string | null;
    periodoAbierto: boolean;
  } | null = null;

  {
    const { data: linea } = await cliente
      .schema("dinero")
      .from("lineas_cobro")
      .select("monto_final_clp, concepto, periodo_cobro_id, anulada")
      .eq("pedido_id", pedidoId)
      .eq("tenant_id", tenantId)
      .eq("anulada", false)
      .maybeSingle();

    if (linea) {
      let periodoEtiqueta: string | null = null;
      let periodoAbierto = false;
      if (linea.periodo_cobro_id) {
        const { data: per } = await cliente
          .schema("dinero")
          .from("periodos_cobro")
          .select("fecha_inicio, fecha_fin, estado")
          .eq("id", linea.periodo_cobro_id as string)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (per) {
          periodoEtiqueta = etiquetaPeriodo(per.fecha_inicio as string, per.fecha_fin as string);
          periodoAbierto = per.estado === "abierto";
        }
      }
      cobro = {
        montoClp: Number(linea.monto_final_clp),
        concepto: (linea.concepto as string | null) ?? "Entrega",
        esDefinitivo: true,
        periodoEtiqueta,
        periodoAbierto,
      };
    } else if (pedido.tarifaAplicableId) {
      const { data: tarifa } = await cliente
        .from("tarifas")
        .select("monto_clp, tipo_entrega")
        .eq("id", pedido.tarifaAplicableId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (tarifa) {
        cobro = {
          montoClp: Number(tarifa.monto_clp),
          // `tipo_entrega` es el identificador de la tarifa ('flex',
          // 'same_day'): imprimirlo crudo daba «Entrega flex» y, peor,
          // «Entrega same_day» con guion bajo a la vista.
          concepto:
            (tarifa.tipo_entrega as string) === "same_day"
              ? "Entrega del día"
              : "Entrega Flex",
          esDefinitivo: false,
          periodoEtiqueta: null,
          periodoAbierto: false,
        };
      }
    }
  }

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
      <Retorno href={destinoRetorno("/portal/pedidos", volver)} etiqueta="Volver a mis pedidos" />

      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {/* El titular es el DESTINATARIO, no el identificador del envío: el
              seller entra acá porque su cliente le escribió, y lo busca por
              nombre. El código queda debajo, que es donde sirve para citarlo. */}
          <h1 className="font-heading text-xl font-semibold">{pedido.destinatarioNombre}</h1>
          <p className="rx-num text-xs text-fg-muted">
            {idVisible} · {etiquetaFuentePedido(pedido.fuente)}
          </p>
          <p className="text-sm text-fg-muted">
            {textoLlegada(pedido.fechaCompromiso, hoyEnSantiago(), pedido.estado)}
          </p>
        </div>
        <BadgeEstado
          variante={BADGE_ESTADO_PEDIDO[pedido.estado]} eje="pedido" valor={pedido.estado}
          texto={estadoPedidoParaSeller(pedido.estado)}
          className="px-3 py-1 text-sm"
        />
      </div>

      {/* El aviso de Flex, que faltaba entero.
          ------------------------------------------------------------------
          Un pedido Flex ya se veía distinto —sin seguimiento propio, sin
          etiqueta, sin cancelar— pero **por omisión y sin decir nada**: el
          seller abría la hoja, encontraba tres cosas menos que en un same-day y
          cero explicación de por qué. */}
      {pedido.tipoPedido === "flex" ? (
        <div className="border border-line bg-bg-sunken px-4 py-3.5">
          <p className="text-sm leading-relaxed text-fg-muted">
            <strong className="font-medium text-fg">Este pedido lo sigue Mercado Libre.</strong>{" "}
            Tu comprador recibe el seguimiento por ahí, no por nosotros, y la prueba de entrega
            oficial también queda allá. Acá ves lo que registra el courier.
          </p>
          {/* El puente a la otra mitad. Si el seller necesita la prueba de
              entrega oficial o el chat con su comprador, tiene que ir a Mercado
              Libre — y hasta acá esta hoja no le decía ni eso ni con qué
              número buscar. Se da el número de venta en vez de un enlace
              directo: la URL de detalle de una venta no está documentada y un
              enlace roto desde el portal es peor que no tenerlo. */}
          {pedido.mlOrderId ? (
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              En Mercado Libre es la venta{" "}
              <span className="rx-num font-medium text-fg">#{pedido.mlOrderId}</span>.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Línea de tiempo del estado */}
      <SeccionTimeline estado={pedido.estado} />

      {/* Lo que te van a cobrar — el bloque que la hoja no tenía.
          ------------------------------------------------------------------
          El seller veía a dónde va su paquete y no cuánto le va a costar. Y es
          justo la mitad que reclama por teléfono al ver el total del mes. */}
      {cobro ? (
        <section
          aria-labelledby="cobro-titulo"
          className="space-y-1.5 border border-line bg-bg-raised px-4 py-3.5"
        >
          <h2
            id="cobro-titulo"
            className="text-[10px] font-medium tracking-[0.12em] text-fg-muted uppercase"
          >
            Lo que te van a cobrar
          </h2>
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-fg">{cobro.concepto}</span>
            <span className="rx-num text-lg font-semibold text-fg">
              {formatearCLP(cobro.montoClp)}
            </span>
          </p>
          {/* Estimación y cifra facturable NO se dicen igual: una entrega que
              todavía no ocurrió puede terminar sin cobrarse. */}
          <p className="text-xs leading-relaxed text-fg-muted">
            {cobro.esDefinitivo
              ? cobro.periodoEtiqueta
                ? `Va en tu período ${cobro.periodoEtiqueta}, que ${
                    cobro.periodoAbierto ? "todavía está abierto" : "ya está cerrado"
                  }.`
                : "Ya está registrada. Entra en tu próximo período de cobro."
              : "Es la tarifa que aplica hoy. Se cobra solo si la entrega se hace: si no llega, no se te cobra."}
          </p>
        </section>
      ) : null}

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

          {/* Aquí vivían «Referencia interna» —un UUID cortado— y «N° de
              seguimiento ML». El primero no significa nada para el seller; el
              segundo ya encabeza la hoja como código del envío. Se dejan solo
              si el código de arriba es OTRO, para no perder el dato. */}
          {pedido.mlShipmentId && pedido.mlShipmentId !== idVisible && (
            <div>
              <dt className="text-xs text-muted-foreground">N° de seguimiento ML</dt>
              <dd className="rx-num mt-0.5 text-xs text-muted-foreground">
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

      {/* Acciones, todas juntas al pie.
          ------------------------------------------------------------------
          Antes estaban repartidas en tres secciones distintas —copiar el enlace
          dentro de «Seguimiento en vivo», la etiqueta dentro de «Etiqueta con
          QR», cancelar dentro de «Acciones»—, así que no se leían como lo que
          son: las cosas que el seller puede hacer con este pedido.

          «Reportar un problema» aparece SIEMPRE, y es la novedad: la bienvenida
          la prometía desde antes de que existiera. */}
      <section aria-labelledby="acciones-titulo" className="space-y-2 border-t border-line pt-4">
        <h2
          id="acciones-titulo"
          className="text-[10px] font-medium tracking-[0.12em] text-fg-muted uppercase"
        >
          Qué puedes hacer
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          <DialogoReportar
            pedidos={[]}
            nombreCourier={nombreCourier}
            pedidoFijo={{ id: pedido.id, etiqueta: `${idVisible} · ${pedido.destinatarioNombre}` }}
            variante="secundaria"
          />
          {puedeCancelarSeller ? <DialogCancelarPedido pedidoId={pedido.id} /> : null}
        </div>

        {/* Por qué NO se puede cancelar, dicho. Antes la sección simplemente no
            se renderizaba para Flex, y el seller no sabía si el botón faltaba
            o si no existía. */}
        {!puedeCancelarSeller ? (
          <p className="text-sm leading-relaxed text-fg-muted">
            {pedido.tipoPedido === "flex"
              ? "Este pedido no se puede cancelar desde acá: lo gobierna Mercado Libre."
              : yaSalioARuta
                ? "Este pedido ya salió a ruta y no se puede cancelar desde acá. Si necesitas detenerlo, escríbele al courier."
                : "Este pedido ya no se puede cancelar."}
          </p>
        ) : null}
      </section>
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
                {hitoLineaPortal(paso.estado)}
              </p>
            </li>
          ))}
        </ol>

        {/* Estado de novedad — se muestra aparte, la línea feliz no lo representa */}
        {novedad && (
          <div className="mt-4 rounded-lg bg-warning-subtle px-3 py-2.5 text-sm text-warning-subtle-foreground">
            {/* El mismo hecho, dicho igual que arriba. Decía «Fallido» —la
                palabra del courier— tres centímetros debajo de un distintivo
                que dice «Nadie recibió», y en la misma pantalla. */}
            Este pedido se salió de la línea:{" "}
            <span className="font-semibold">{estadoPedidoParaSeller(estado).toLowerCase()}</span>.
          </div>
        )}
      </div>
    </section>
  );
}
