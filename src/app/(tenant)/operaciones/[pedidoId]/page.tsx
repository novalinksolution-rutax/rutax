/**
 * Detalle del pedido — Pantalla 1-B (Flujo 1)
 *
 * Server Component. Muestra estado, historial, incidencias y acciones según rol.
 * Las acciones interactivas (cambiar estado, abrir incidencia, reasignar) se
 * delegan a Client Components.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, MapPinOff, Loader2 } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerPedido, listarIncidenciasDePedido } from "@/modules/operacion/index";
import { obtenerPruebaEntregaPorPedido } from "@/modules/operacion/pruebas-entrega";
import { listarEvidenciasPorPedido } from "@/modules/operacion/evidencias-entrega";
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarIncidencias,
  puedeAjustarOperacionDiaria,
} from "@/modules/identidad/capacidades";
import { Badge } from "@/components/ui/badge";
import {
  traducirEstadoPedido,
  traducirTipoIncidencia,
  traducirEstadoIncidencia,
  BADGE_ESTADO_PEDIDO,
  BADGE_ESTADO_INCIDENCIA,
  UMBRAL_INCIDENCIA_SIN_GESTION_HORAS,
  esIncidenciaSinGestion,
  horasDesde,
  traducirGeoEstado,
  traducirCoberturaEstado,
  BADGE_GEO_ESTADO,
  BADGE_COBERTURA_ESTADO,
  requiereRevisionGeo,
} from "@/lib/ui/traduccion-estados";
import { ESTADOS_TERMINALES } from "@/modules/operacion/tipos";
import type { Pedido, Incidencia } from "@/modules/operacion/tipos";
import { DrawerCambioEstado } from "./drawer-cambio-estado";
import { DrawerIncidencia } from "./drawer-incidencia";
import { DialogReasignacion } from "./dialog-reasignacion";
import { BotonDescargarEtiqueta } from "./boton-descargar-etiqueta";
import { VisorPod } from "./visor-pod";
import { VisorEvidencias } from "./visor-evidencias";
import { DialogReclasificarIncidencia } from "./dialog-reclasificar-incidencia";

// =============================================================================
// Carga de datos
// =============================================================================

async function cargarDatos(pedidoId: string, tenantId: string) {
  const cliente = crearClienteServiceRole();
  const [pedido, incidencias] = await Promise.all([
    obtenerPedido(cliente, pedidoId, tenantId),
    listarIncidenciasDePedido(cliente, pedidoId, tenantId),
  ]);
  return { pedido, incidencias };
}

async function cargarHistorialEstados(pedidoId: string, tenantId: string) {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .from("bitacora_auditoria")
    .select("*")
    .eq("entidad_id", pedidoId)
    .eq("tenant_id", tenantId)
    .in("accion", ["pedido.estado_corregido_manual"])
    .order("creado_en", { ascending: false })
    .limit(20);
  return data ?? [];
}

async function cargarAsignacion(pedidoId: string, tenantId: string) {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .from("asignaciones_pedido")
    .select("id, driver_id, manifiesto_id, asignado_en, manifiestos(nombre, fecha_operacion)")
    .eq("pedido_id", pedidoId)
    .eq("tenant_id", tenantId)
    .eq("activa", true)
    .maybeSingle();
  return data;
}

// =============================================================================
// Página
// =============================================================================

interface Props {
  params: Promise<{ pedidoId: string }>;
}

export default async function PaginaDetallePedido({ params }: Props) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  const { pedidoId } = await params;
  const tenantId = sesion.usuario.tenantId;

  const { pedido, incidencias } = await cargarDatos(pedidoId, tenantId);
  if (!pedido) notFound();

  const [historial, asignacion, pod, evidencias] = await Promise.all([
    cargarHistorialEstados(pedidoId, tenantId),
    cargarAsignacion(pedidoId, tenantId),
    obtenerPruebaEntregaPorPedido(crearClienteServiceRole(), pedidoId, tenantId),
    listarEvidenciasPorPedido(crearClienteServiceRole(), pedidoId, tenantId),
  ]);

  const puedeAsignar = puedeAsignarYReasignarPedidos(sesion.usuario);
  const puedeIncidencias = puedeGestionarIncidencias(sesion.usuario);
  const puedeAjustar = puedeAjustarOperacionDiaria(sesion.usuario);
  const esTerminal = ESTADOS_TERMINALES.includes(pedido.estado);

  // El dinero por pedido (cobro/período/factura/liquidación/pago) ya NO se
  // muestra en el detalle operativo: se consolida a nivel conductor en
  // Liquidaciones (dinero/liquidaciones) y a nivel seller en Conciliación /
  // Estado de cuenta. El motor entrega→dinero sigue registrando cada línea; solo
  // cambia dónde se presenta (consolidado, no por pedido).

  const incidenciasAbiertas = incidencias.filter(
    (i) => i.estado === "abierta" || i.estado === "en_gestion",
  );

  return (
    <div className="space-y-6">
      {/* Volver */}
      <Link
        href="/operaciones"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Volver a pedidos
      </Link>

      {/* Sección A — Encabezado */}
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{pedido.destinatarioNombre}</h1>
            <p className="mt-1 text-muted-foreground">
              {pedido.destinatarioDireccion}, {pedido.destinatarioComuna}
            </p>
            {/* Badge discreto en el encabezado cuando la dirección requiere revisión */}
            {requiereRevisionGeo(pedido.geoEstado, pedido.coberturaEstado) && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-destructive-subtle px-2.5 py-1 text-xs font-medium text-destructive-subtle-foreground">
                <MapPinOff className="size-3.5" aria-hidden="true" />
                Dirección requiere revisión antes de rutear
              </div>
            )}
            {/* Indicador sutil si el geocoding está en curso */}
            {pedido.geoEstado === "pendiente" && !requiereRevisionGeo(pedido.geoEstado, pedido.coberturaEstado) && (
              <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                Ubicando dirección…
              </div>
            )}
          </div>
          <Badge variant={BADGE_ESTADO_PEDIDO[pedido.estado]} className="px-3 py-1 text-sm">
            {traducirEstadoPedido(pedido.estado)}
          </Badge>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Tipo</dt>
            <dd className="font-medium capitalize">{pedido.tipoPedido === "flex" ? "Flex" : "Same-day"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Seller</dt>
            <dd className="font-medium">
              <Link href={`/sellers/${pedido.sellerId}`} className="hover:underline">
                {pedido.sellerId}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">ID interno</dt>
            <dd className="font-mono text-xs">{pedido.id}</dd>
          </div>
          {pedido.mlShipmentId && (
            <div>
              <dt className="text-xs text-muted-foreground">ML Shipment ID</dt>
              <dd className="font-mono text-xs text-muted-foreground">{pedido.mlShipmentId}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Sección A.2 — Estado de geocoding (solo cuando es relevante) */}
      <SeccionGeocoding pedido={pedido} />

      {/* Sección A.3 — Prueba de entrega (POD) del ciclo same-day propio */}
      {pod && <VisorPod pod={pod} />}

      {/* Sección A.4 — Evidencias informativas (capa paralela a ML Flex) */}
      <VisorEvidencias evidencias={evidencias} />

      {/* Sección B — Historial de estados */}
      <section aria-labelledby="historial-titulo">
        <h2 id="historial-titulo" className="mb-3 text-base font-semibold">
          Historial de estados
        </h2>
        <div className="rounded-xl border bg-card p-4">
          {historial.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Estado actual:{" "}
              <span className="font-medium">{traducirEstadoPedido(pedido.estado)}</span>
              {" "}— Sincronización automática
            </p>
          ) : (
            <ol className="space-y-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {historial.map((entrada: any) => (
                <li key={entrada.id} className="flex gap-3 text-sm">
                  <div className="mt-0.5 flex-shrink-0">
                    <div className="size-2 rounded-full bg-primary" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {traducirEstadoPedido(entrada.detalle?.estado_anterior)}{" "}
                      <span aria-hidden="true">→</span>{" "}
                      {traducirEstadoPedido(entrada.detalle?.estado_nuevo)}
                    </p>
                    {entrada.actor_usuario_id && (
                      <p className="text-xs text-muted-foreground">
                        Cambiado manualmente el{" "}
                        {new Date(entrada.creado_en).toLocaleString("es-CL")}
                      </p>
                    )}
                    {entrada.detalle?.motivo && (
                      <p className="mt-0.5 text-xs text-muted-foreground italic">
                        &ldquo;{entrada.detalle.motivo}&rdquo;
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* Sección C — Incidencias abiertas */}
      {incidenciasAbiertas.length > 0 && (
        <section aria-labelledby="incidencias-titulo">
          <h2 id="incidencias-titulo" className="mb-3 text-base font-semibold">
            Incidencias activas
          </h2>
          <ul className="space-y-2">
            {incidenciasAbiertas.map((inc) => (
              <TargetaIncidencia
                key={inc.id}
                incidencia={inc}
                pedidoId={pedidoId}
                puedeReclasificar={puedeIncidencias}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Sección D — Asignación actual */}
      <section aria-labelledby="asignacion-titulo">
        <h2 id="asignacion-titulo" className="mb-3 text-base font-semibold">
          Asignación
        </h2>
        <div className="rounded-xl border bg-card p-4 text-sm">
          {asignacion ? (
            <dl className="grid grid-cols-2 gap-2">
              <div>
                <dt className="text-xs text-muted-foreground">Conductor</dt>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <dd className="font-medium">{asignacion.driver_id}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Manifiesto</dt>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <dd className="font-medium">{(asignacion as any).manifiestos?.nombre ?? asignacion.manifiesto_id}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Fecha de operación</dt>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <dd>{(asignacion as any).manifiestos?.fecha_operacion ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted-foreground">
              Sin conductor asignado — pendiente de asignación.
            </p>
          )}
        </div>
      </section>

      {/* Sección E — Acciones disponibles según rol */}
      <AccionesPedido
        pedido={pedido}
        asignacion={asignacion}
        puedeAsignar={puedeAsignar}
        puedeIncidencias={puedeIncidencias}
        puedeAjustar={puedeAjustar}
        esTerminal={esTerminal}
        tenantId={tenantId}
        usuarioId={sesion.usuarioId}
      />
    </div>
  );
}

// =============================================================================
// Sección de geocoding — visible solo cuando hay información relevante
// (pendiente, no_resuelto, fuera_cobertura, sin_tarifa_zona, requiere_revision)
// "resuelto"+"tarifada" no muestran nada para no ensuciar la pantalla.
// =============================================================================

function SeccionGeocoding({ pedido }: { pedido: Pedido }) {
  const geoOk = pedido.geoEstado === "resuelto";
  const coberturaOk = pedido.coberturaEstado === "tarifada";

  // Si todo está bien, no mostrar nada
  if (geoOk && coberturaOk) return null;

  const esPendiente = pedido.geoEstado === "pendiente";
  const requiereRevision = requiereRevisionGeo(pedido.geoEstado, pedido.coberturaEstado);

  return (
    <section aria-labelledby="geo-titulo">
      <h2 id="geo-titulo" className="mb-3 text-base font-semibold">
        Verificación de dirección
      </h2>
      <div
        className={[
          "rounded-xl border p-4 text-sm",
          requiereRevision
            ? "border-destructive-subtle bg-destructive-subtle/40"
            : "border-border bg-muted/30",
        ].join(" ")}
      >
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Estado geocoding */}
          <div>
            <dt className="text-xs text-muted-foreground">Ubicación</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              {esPendiente ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  {traducirGeoEstado(pedido.geoEstado)}
                </span>
              ) : (
                <Badge variant={BADGE_GEO_ESTADO[pedido.geoEstado]}>
                  {traducirGeoEstado(pedido.geoEstado)}
                </Badge>
              )}
            </dd>
          </div>

          {/* Estado cobertura */}
          {!esPendiente && (
            <div>
              <dt className="text-xs text-muted-foreground">Cobertura / tarifa</dt>
              <dd className="mt-0.5">
                <Badge variant={BADGE_COBERTURA_ESTADO[pedido.coberturaEstado]}>
                  {traducirCoberturaEstado(pedido.coberturaEstado)}
                </Badge>
              </dd>
            </div>
          )}

          {/* Coordenadas — solo si resuelto */}
          {geoOk && pedido.lat !== null && pedido.long !== null && (
            <div>
              <dt className="text-xs text-muted-foreground">Coordenadas</dt>
              <dd className="font-mono text-xs text-muted-foreground tabular-nums">
                {pedido.lat.toFixed(6)}, {pedido.long.toFixed(6)}
              </dd>
            </div>
          )}

          {/* Fecha geocodificación */}
          {pedido.geocodificadoEn && (
            <div>
              <dt className="text-xs text-muted-foreground">Geocodificado</dt>
              <dd className="text-xs text-muted-foreground">
                {new Date(pedido.geocodificadoEn).toLocaleString("es-CL")}
              </dd>
            </div>
          )}
        </dl>

        {/* Confianza — solo si hay valor */}
        {pedido.geoConfianza !== null && (
          <p className="mt-2 text-xs text-muted-foreground">
            Confianza del proveedor: {Math.round(pedido.geoConfianza * 100)}%
          </p>
        )}

        {/* Guía de acción cuando requiere revisión */}
        {requiereRevision && (
          <p className="mt-3 text-xs font-medium text-destructive-subtle-foreground">
            Verifica la dirección con el seller antes de asignar este pedido a un manifiesto.
          </p>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// Tarjeta de incidencia
// =============================================================================

function TargetaIncidencia({
  incidencia,
  pedidoId,
  puedeReclasificar,
}: {
  incidencia: Incidencia;
  pedidoId: string;
  puedeReclasificar: boolean;
}) {
  const sinGestion = esIncidenciaSinGestion(incidencia.estado, incidencia.abiertaEn);
  const horas = Math.floor(horasDesde(incidencia.abiertaEn));

  return (
    <li
      className={`rounded-xl border p-4 ${incidencia.estado === "abierta" ? "border-destructive-subtle bg-destructive-subtle/50" : "border-warning-subtle bg-warning-subtle/50"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{traducirTipoIncidencia(incidencia.tipo)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Abierta hace {horas}h
            {incidencia.descripcion && ` — ${incidencia.descripcion}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sinGestion && (
            <span className="rounded-full bg-destructive-subtle px-2 py-0.5 text-xs font-semibold text-destructive-subtle-foreground">
              Sin gestión: {horas}h
            </span>
          )}
          {puedeReclasificar && (
            <DialogReclasificarIncidencia
              pedidoId={pedidoId}
              incidenciaId={incidencia.id}
              tipoActual={incidencia.tipo}
            />
          )}
          <Badge variant={BADGE_ESTADO_INCIDENCIA[incidencia.estado]}>
            {traducirEstadoIncidencia(incidencia.estado)}
          </Badge>
        </div>
      </div>
    </li>
  );
}

// =============================================================================
// Bloque de acciones (Client Component wrapper)
// =============================================================================

function AccionesPedido({
  pedido,
  asignacion,
  puedeAsignar,
  puedeIncidencias,
  puedeAjustar,
  esTerminal,
  tenantId,
  usuarioId,
}: {
  pedido: Pedido;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  asignacion: any;
  puedeAsignar: boolean;
  puedeIncidencias: boolean;
  puedeAjustar: boolean;
  esTerminal: boolean;
  tenantId: string;
  usuarioId: string;
}) {
  const tieneAsignacion = !!asignacion;
  const esPendiente = pedido.estado === "pendiente_asignacion";
  // Flex requiere ml_shipment_id (etiqueta de ML); same-day genera su propia
  // etiqueta interna con QR y no depende de ningún campo de Mercado Libre.
  const puedeDescargarEtiqueta =
    puedeAsignar && (!!pedido.mlShipmentId || pedido.tipoPedido === "same_day");

  // Sin ninguna acción visible: no renderizar nada
  const hayAcciones =
    (puedeAsignar && (esPendiente || tieneAsignacion)) ||
    (puedeIncidencias && !esTerminal) ||
    puedeAjustar ||
    puedeDescargarEtiqueta;

  if (!hayAcciones) return null;

  return (
    <section aria-labelledby="acciones-titulo">
      <h2 id="acciones-titulo" className="mb-3 text-base font-semibold">
        Acciones
      </h2>
      <div className="flex flex-wrap gap-3">
        {puedeAsignar && esPendiente && (
          <Link
            href={`/manifiestos?asignarPedido=${pedido.id}`}
            className="rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Asignar a manifiesto
          </Link>
        )}

        {puedeAsignar && tieneAsignacion && (
          <DialogReasignacion
            pedidoId={pedido.id}
            estadoActual={pedido.estado}
            conductorActual={asignacion.driver_id}
            manifiestoActual={asignacion.manifiestos?.nombre ?? asignacion.manifiesto_id}
          />
        )}

        {puedeIncidencias && !esTerminal && (
          <DrawerIncidencia
            pedidoId={pedido.id}
            sellerId={pedido.sellerId}
          />
        )}

        {puedeAjustar && (
          <DrawerCambioEstado
            pedidoId={pedido.id}
            estadoActual={pedido.estado}
          />
        )}

        {puedeDescargarEtiqueta && (
          <BotonDescargarEtiqueta pedidoId={pedido.id} esSameDay={pedido.tipoPedido === "same_day"} />
        )}
      </div>
    </section>
  );
}
