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
import { obtenerTrazaDineroPorPedido } from "@/modules/dinero/index";
import { mapaNombresSellers, mapaNombresConductores } from "@/modules/identidad/consultas";
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarIncidencias,
  puedeAjustarOperacionDiaria,
  puedeVerConciliacion,
  puedeGestionarLiquidacionesConductores,
  puedeEmitirFacturas,
  puedeVerReportesEjecutivos,
} from "@/modules/identidad/capacidades";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { PanelTrazabilidadFinanciera } from "@/components/dinero/panel-trazabilidad-financiera";
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
  geocodingPendienteRancio,
} from "@/lib/ui/traduccion-estados";
import { ESTADOS_TERMINALES } from "@/modules/operacion/tipos";
import type { Pedido, Incidencia } from "@/modules/operacion/tipos";
import { esTransicionValida } from "@/modules/operacion/maquina-estados";
import { DrawerCambioEstado } from "./drawer-cambio-estado";
import { DrawerIncidencia } from "./drawer-incidencia";
import { DialogReasignacion } from "./dialog-reasignacion";
import { BotonDescargarEtiqueta } from "./boton-descargar-etiqueta";
import { BotonReubicar } from "./boton-reubicar";
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
  searchParams: Promise<{ traza?: string }>;
}

export default async function PaginaDetallePedido({ params, searchParams }: Props) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  const { pedidoId } = await params;
  const sp = await searchParams;
  const tenantId = sesion.usuario.tenantId;

  const { pedido, incidencias } = await cargarDatos(pedidoId, tenantId);
  if (!pedido) notFound();

  // Trazabilidad financiera (§1.1 P1 del audit): gateada a roles financieros —
  // conciliación, liquidaciones de conductores, facturación o reportes
  // ejecutivos. Solo se consulta si el gate pasa, para no gastar la query
  // cuando la sección ni siquiera se va a renderizar.
  const gateDinero =
    puedeVerConciliacion(sesion.usuario) ||
    puedeGestionarLiquidacionesConductores(sesion.usuario) ||
    puedeEmitirFacturas(sesion.usuario) ||
    puedeVerReportesEjecutivos(sesion.usuario);

  const [historial, asignacion, pod, evidencias, traza] = await Promise.all([
    cargarHistorialEstados(pedidoId, tenantId),
    cargarAsignacion(pedidoId, tenantId),
    obtenerPruebaEntregaPorPedido(crearClienteServiceRole(), pedidoId, tenantId),
    listarEvidenciasPorPedido(crearClienteServiceRole(), pedidoId, tenantId),
    gateDinero
      ? obtenerTrazaDineroPorPedido(crearClienteServiceRole(), tenantId, pedidoId)
      : Promise.resolve(null),
  ]);

  // Nombres legibles (seller y conductor) en vez de UUIDs. Best-effort: si la
  // resolución falla, la pantalla cae al UUID sin bloquear el render.
  let sellerNombre: string | null = null;
  let conductorNombre: string | null = null;
  try {
    const [sellers, conductores] = await Promise.all([
      mapaNombresSellers(crearClienteServiceRole(), tenantId, [pedido.sellerId]),
      asignacion?.driver_id
        ? mapaNombresConductores(crearClienteServiceRole(), tenantId, [asignacion.driver_id])
        : Promise.resolve({} as Record<string, string>),
    ]);
    sellerNombre = sellers[pedido.sellerId] ?? null;
    conductorNombre = asignacion?.driver_id ? (conductores[asignacion.driver_id] ?? null) : null;
  } catch {
    // sin bloquear — quedan los UUIDs como fallback.
  }

  const puedeAsignar = puedeAsignarYReasignarPedidos(sesion.usuario);
  const puedeIncidencias = puedeGestionarIncidencias(sesion.usuario);
  const puedeAjustar = puedeAjustarOperacionDiaria(sesion.usuario);
  // El geocoding corre en segundos tras la ingesta; si sigue pendiente pasado
  // el umbral, está atascado (no en curso) y no debe mostrarse un spinner eterno.
  const geoRancio = geocodingPendienteRancio(
    pedido.geoEstado,
    pedido.geocodificadoEn,
    pedido.creadoEn,
  );
  const esTerminal = ESTADOS_TERMINALES.includes(pedido.estado);
  const pedidoEntregado = pedido.estado === "entregado" || pedido.estado === "entregado_manual";

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
            <h1 className="text-2xl font-semibold">{pedido.destinatarioNombre}</h1>
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
            {/* Geocoding en curso (spinner) vs. atascado (estado estático). */}
            {pedido.geoEstado === "pendiente" && !requiereRevisionGeo(pedido.geoEstado, pedido.coberturaEstado) && (
              geoRancio ? (
                <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-warning-subtle-foreground">
                  <MapPinOff className="size-3.5" aria-hidden="true" />
                  Ubicación pendiente
                </div>
              ) : (
                <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  Ubicando dirección…
                </div>
              )
            )}
          </div>
          <BadgeEstado
            variante={BADGE_ESTADO_PEDIDO[pedido.estado]}
            className="px-3 py-1 text-sm"
            texto={traducirEstadoPedido(pedido.estado)}
          />
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
                {sellerNombre ?? pedido.sellerId}
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
      <SeccionGeocoding pedido={pedido} pendienteRancio={geoRancio} puedeReubicar={puedeAjustar} />

      {/* Sección A.3 — Prueba de entrega (POD) del ciclo same-day propio */}
      {pod && <VisorPod pod={pod} />}

      {/* Sección A.4 — Evidencias informativas (capa paralela a ML Flex) */}
      <VisorEvidencias evidencias={evidencias} />

      {/* Sección B — Historial de estados */}
      <section aria-labelledby="historial-titulo">
        <h2 id="historial-titulo" className="mb-3 text-base font-semibold">
          Historial de estados
        </h2>
        <div className="rounded-lg border bg-card p-4">
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
        <div className="rounded-lg border bg-card p-4 text-sm">
          {asignacion ? (
            <dl className="grid grid-cols-2 gap-2">
              <div>
                <dt className="text-xs text-muted-foreground">Conductor</dt>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <dd className="font-medium">{conductorNombre ?? asignacion.driver_id}</dd>
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

      {/* Sección D.1 — Dinero (trazabilidad financiera bidireccional, §1.1 P1
          del audit). Gateada a roles financieros — no se renderiza en el DOM
          para el resto de roles (no basta con ocultar vía CSS). */}
      {gateDinero && traza && (
        <section aria-labelledby="dinero-titulo">
          <h2 id="dinero-titulo" className="mb-3 text-base font-semibold">
            Dinero
          </h2>
          <PanelTrazabilidadFinanciera
            traza={traza}
            pedidoId={pedido.id}
            pedidoEntregado={pedidoEntregado}
            abrirPorDefecto={sp.traza === "1"}
          />
        </section>
      )}

      {/* Sección E — Acciones disponibles según rol */}
      <AccionesPedido
        pedido={pedido}
        asignacion={asignacion}
        conductorNombre={conductorNombre}
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

function SeccionGeocoding({
  pedido,
  pendienteRancio,
  puedeReubicar,
}: {
  pedido: Pedido;
  pendienteRancio: boolean;
  puedeReubicar: boolean;
}) {
  const geoOk = pedido.geoEstado === "resuelto";
  const coberturaOk = pedido.coberturaEstado === "tarifada";

  // Si todo está bien, no mostrar nada
  if (geoOk && coberturaOk) return null;

  const esPendiente = pedido.geoEstado === "pendiente";
  // Pendiente pero en curso (job recién disparado) → spinner legítimo.
  const enCurso = esPendiente && !pendienteRancio;
  const requiereRevision = requiereRevisionGeo(pedido.geoEstado, pedido.coberturaEstado);
  // El geocoding es el problema (no la cobertura/tarifa): reintentar ubicación
  // tiene sentido solo aquí. `sin_tarifa_zona` es un vacío de tarifa, no de geo.
  const geoAtascado =
    (esPendiente && pendienteRancio) ||
    pedido.geoEstado === "no_resuelto" ||
    pedido.geoEstado === "fuera_cobertura";

  return (
    <section aria-labelledby="geo-titulo">
      <h2 id="geo-titulo" className="mb-3 text-base font-semibold">
        Verificación de dirección
      </h2>
      <div
        className={[
          "rounded-lg border p-4 text-sm",
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
              {enCurso ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  {traducirGeoEstado(pedido.geoEstado)}
                </span>
              ) : esPendiente ? (
                <Badge variant={BADGE_GEO_ESTADO[pedido.geoEstado]}>Ubicación pendiente</Badge>
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

        {/* Explicación cuando la ubicación quedó pendiente y no se resolvió sola */}
        {esPendiente && pendienteRancio && (
          <p className="mt-3 text-xs text-muted-foreground">
            La ubicación quedó pendiente y no se resolvió automáticamente. Reintenta para
            geocodificar la dirección.
          </p>
        )}

        {/* Reintentar ubicación — solo si el geocoding es lo que está atascado */}
        {geoAtascado && puedeReubicar && <BotonReubicar pedidoId={pedido.id} />}
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
      className={`rounded-lg border p-4 ${incidencia.estado === "abierta" ? "border-destructive-subtle bg-destructive-subtle/50" : "border-warning-subtle bg-warning-subtle/50"}`}
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
            <span className="rounded-md bg-destructive-subtle px-2 py-0.5 text-xs font-semibold text-destructive-subtle-foreground">
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
          <BadgeEstado variante={BADGE_ESTADO_INCIDENCIA[incidencia.estado]} texto={traducirEstadoIncidencia(incidencia.estado)} />
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
  conductorNombre,
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
  conductorNombre: string | null;
  puedeAsignar: boolean;
  puedeIncidencias: boolean;
  puedeAjustar: boolean;
  esTerminal: boolean;
  tenantId: string;
  usuarioId: string;
}) {
  const tieneAsignacion = !!asignacion;
  const esPendiente = pedido.estado === "pendiente_asignacion";
  // La reasignación solo es válida si la máquina de estados admite volver a
  // 'pendiente_asignacion' desde el estado actual (hoy solo desde 'asignado' —
  // una vez en_ruta, la vía es marcarlo 'fallido' y reasignar desde ahí).
  const puedeReasignar =
    tieneAsignacion && esTransicionValida(pedido.estado, "pendiente_asignacion", "interno");
  // Flex requiere ml_shipment_id (etiqueta de ML); same-day genera su propia
  // etiqueta interna con QR y no depende de ningún campo de Mercado Libre.
  const puedeDescargarEtiqueta =
    puedeAsignar && (!!pedido.mlShipmentId || pedido.tipoPedido === "same_day");

  // Sin ninguna acción visible: no renderizar nada
  const hayAcciones =
    (puedeAsignar && (esPendiente || puedeReasignar)) ||
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

        {puedeAsignar && puedeReasignar && (
          <DialogReasignacion
            pedidoId={pedido.id}
            estadoActual={pedido.estado}
            conductorActual={conductorNombre ?? asignacion.driver_id}
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
