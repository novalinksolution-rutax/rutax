/**
 * Detalle del pedido — Pantalla 1-B (Flujo 1)
 *
 * Server Component. Muestra estado, historial, incidencias y acciones según rol.
 * Las acciones interactivas (cambiar estado, abrir incidencia, reasignar) se
 * delegan a Client Components.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { MapPinOff, Loader2 } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerPedido, listarIncidenciasDePedido } from "@/modules/operacion/index";
import { obtenerPruebaEntregaPorPedido } from "@/modules/operacion/pruebas-entrega";
import { listarEvidenciasPorPedido } from "@/modules/operacion/evidencias-entrega";
import { obtenerTrazaDineroPorPedido } from "@/modules/dinero/index";
import {
  mapaNombresSellers,
  mapaNombresConductores,
  mapaNombresUsuarios,
  type UsuarioBasico,
} from "@/modules/identidad/consultas";
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarIncidencias,
  puedeAjustarOperacionDiaria,
  puedeVerConciliacion,
  puedeVerBitacoraAuditoria,
  puedeGestionarLiquidacionesConductores,
  puedeEmitirFacturas,
  puedeVerReportesEjecutivos,
} from "@/modules/identidad/capacidades";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { podLoGobiernaLaFuente } from "@/modules/operacion/fuente";
import { Retorno, destinoRetorno } from "@/components/app-shell/retorno";
import { PanelTrazabilidadFinanciera } from "@/components/dinero/panel-trazabilidad-financiera";
import {
  traducirEstadoPedido,
  traducirTipoIncidencia,
  traducirEstadoIncidencia,
  BADGE_ESTADO_PEDIDO,
  BADGE_ESTADO_INCIDENCIA,
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
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { DrawerCambioEstado } from "./drawer-cambio-estado";
import { DrawerIncidencia } from "./drawer-incidencia";
import { DialogReasignacion } from "./dialog-reasignacion";
import { BotonDescargarEtiqueta } from "./boton-descargar-etiqueta";
import { disponibilidadEtiqueta } from "@/modules/operacion/etiqueta-disponible";
import { BotonReubicar } from "./boton-reubicar";
import { DialogCancelarPedido } from "./dialog-cancelar-pedido";
import { armarBitacoraPedido, type EntradaBitacora } from "@/modules/operacion/bitacora-pedido";
import { BotonReintentarLectura } from "./boton-reintentar-lectura";
import { DialogAnular } from "./acciones-corregir-dinero";
import { accionAnularCobroPedido, accionAnularLiquidacionPedido } from "./acciones-dinero";
import { ZonaConsecuencia, FilaConsecuencia } from "@/components/ui/zona-consecuencia";
import { VisorPod } from "./visor-pod";
import { VisorEvidencias } from "./visor-evidencias";
import { DialogReclasificarIncidencia } from "./dialog-reclasificar-incidencia";
import { ACCIONES_HISTORIAL_ESTADO_PEDIDO } from "./historial-estados";
import { formatearFechaHora, formatearHora } from "@/lib/formato-cl";

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
    .in("accion", ACCIONES_HISTORIAL_ESTADO_PEDIDO)
    .order("creado_en", { ascending: false })
    .limit(20);
  return data ?? [];
}

/**
 * TODA la bitácora del pedido, no solo lo que movió su estado.
 *
 * ⚠️ Sin filtro de `accion`, al revés que `cargarHistorialEstados`: el
 * seguimiento narra el viaje del paquete y esto da cuenta de lo que se HIZO
 * sobre él —una etiqueta descargada, una línea de dinero anulada—, que es
 * justamente lo que el seguimiento omite.
 */
async function cargarBitacoraCompleta(pedidoId: string, tenantId: string) {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .from("bitacora_auditoria")
    .select("id, creado_en, accion, actor_tipo, actor_usuario_id, detalle")
    .eq("entidad_id", pedidoId)
    .eq("tenant_id", tenantId)
    .order("creado_en", { ascending: false })
    .limit(50);
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
  /**
   * `volver` trae de dónde vino, para que el retorno lleve al listado que el
   * coordinador estaba mirando —con sus filtros— y no al listado de fábrica.
   *
   * ⚠️ Viene de la URL, así que **es una redirección abierta si se usa tal
   * cual**. `destinoRetorno` solo acepta una barra inicial: `//sitio-malo.cl`,
   * `/\evil.cl`, `https://…` y `javascript:` caen al destino interno.
   */
  searchParams: Promise<{ traza?: string; volver?: string }>;
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

  const puedeVerBitacora = puedeVerBitacoraAuditoria(sesion.usuario);

  /* ==========================================================================
   * 🔴 `allSettled`, NO `all` — «falla de lectura ≠ objeto vacío»
   * ==========================================================================
   * Tablero P3, decisión n.º 6. Con `Promise.all`, que fallara UNA lectura
   * secundaria —el dinero, el POD— tumbaba la carga entera y la pantalla se
   * iba al `error.tsx`: el pedido EXISTE y no se podía ver nada de él.
   *
   * Y el modo de fallo silencioso era peor todavía: varios de estos cargadores
   * devuelven `data ?? []` ante un error de PostgREST, o sea que un fallo de
   * lectura se veía **idéntico a «no hay nada»**. Un pedido cuyo historial no
   * se pudo leer se mostraba como un pedido sin historial, y sobre eso alguien
   * decide si cambiarle el estado.
   *
   * Ahora cada lectura falla por su cuenta, la pantalla se pinta con lo que sí
   * llegó, y **lo que faltó se dice con nombre y apellido**.
   * ======================================================================== */
  const lecturas = await Promise.allSettled([
    cargarHistorialEstados(pedidoId, tenantId),
    cargarAsignacion(pedidoId, tenantId),
    obtenerPruebaEntregaPorPedido(crearClienteServiceRole(), pedidoId, tenantId),
    listarEvidenciasPorPedido(crearClienteServiceRole(), pedidoId, tenantId),
    gateDinero
      ? obtenerTrazaDineroPorPedido(crearClienteServiceRole(), tenantId, pedidoId)
      : Promise.resolve(null),
    puedeVerBitacora ? cargarBitacoraCompleta(pedidoId, tenantId) : Promise.resolve([]),
  ]);

  const ROTULOS_LECTURA: string[] = [
    "el seguimiento",
    "la asignación",
    "la prueba de entrega",
    "las evidencias",
    "el dinero",
    "la bitácora",
  ];

  const lecturasFallidas = lecturas
    .map((r, i) => (r.status === "rejected" ? ROTULOS_LECTURA[i] : null))
    .filter((x): x is string => x !== null);

  const valor = <T,>(i: number, porDefecto: T): T =>
    lecturas[i].status === "fulfilled" ? ((lecturas[i] as PromiseFulfilledResult<T>).value ?? porDefecto) : porDefecto;

  const historial = valor<Record<string, unknown>[]>(0, []);
  const asignacion = valor<Awaited<ReturnType<typeof cargarAsignacion>>>(1, null);
  const pod = valor<Awaited<ReturnType<typeof obtenerPruebaEntregaPorPedido>>>(2, null);
  const evidencias = valor<Awaited<ReturnType<typeof listarEvidenciasPorPedido>>>(3, []);
  const traza = valor<Awaited<ReturnType<typeof obtenerTrazaDineroPorPedido>> | null>(4, null);
  const bitacoraCruda = valor<Record<string, unknown>[]>(5, []);

  // ⚠️ El dinero se trata aparte del resto: es la única lectura cuyo fallo hace
  // PELIGROSA una acción. Anular un cobro que no pudimos leer es anular a
  // ciegas, así que la zona de consecuencia se bloquea con su motivo.
  const falloElDinero = lecturas[4].status === "rejected";

  // Nombres legibles (seller y conductor) en vez de UUIDs. Best-effort: si la
  // resolución falla, la pantalla cae al UUID sin bloquear el render.
  let sellerNombre: string | null = null;
  let conductorNombre: string | null = null;
  // Quién canceló (§6.1) — puede ser un usuario interno o el propio seller
  // (ejecutor='seller' vía portal). `tipoUsuario` es lo que distingue el texto;
  // nunca se expone al seller (esta resolución vive solo en la pantalla interna).
  let canceladoPorTexto: string | null = null;
  try {
    const [sellers, conductores, usuarios] = await Promise.all([
      mapaNombresSellers(crearClienteServiceRole(), tenantId, [pedido.sellerId]),
      asignacion?.driver_id
        ? mapaNombresConductores(crearClienteServiceRole(), tenantId, [asignacion.driver_id])
        : Promise.resolve({} as Record<string, string>),
      pedido.canceladoPorUsuarioId
        ? mapaNombresUsuarios(crearClienteServiceRole(), tenantId, [pedido.canceladoPorUsuarioId])
        : Promise.resolve({} as Record<string, UsuarioBasico>),
    ]);
    sellerNombre = sellers[pedido.sellerId] ?? null;
    conductorNombre = asignacion?.driver_id ? (conductores[asignacion.driver_id] ?? null) : null;
    if (pedido.canceladoPorUsuarioId) {
      const actor = usuarios[pedido.canceladoPorUsuarioId];
      if (actor) {
        canceladoPorTexto =
          actor.tipoUsuario === "seller" ? `${actor.nombreCompleto} (seller)` : actor.nombreCompleto;
      }
    }
  } catch {
    // sin bloquear — quedan los UUIDs/valores por defecto como fallback.
  }

  /* Autores de la bitácora y del seguimiento, en UNA sola consulta.
     Best-effort: si falla, las líneas quedan sin nombre pero la pantalla se
     pinta — un registro sin autor sigue diciendo qué pasó y cuándo. */
  let nombresAutores: Record<string, UsuarioBasico> = {};
  const idsAutores = [
    ...new Set(
      [...bitacoraCruda, ...historial]
        .map((f) => (f as Record<string, unknown>).actor_usuario_id)
        .filter((v): v is string => typeof v === "string"),
    ),
  ];
  if (idsAutores.length > 0) {
    try {
      nombresAutores = await mapaNombresUsuarios(crearClienteServiceRole(), tenantId, idsAutores);
    } catch {
      // sin bloquear.
    }
  }
  const bitacora = armarBitacoraPedido(bitacoraCruda, nombresAutores);

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
  // Cancelar es SOLO same-day (docs/arquitectura/edicion-y-cancelacion-de-
  // pedidos.md §3.2 — un Flex vivo lo gobierna Mercado Envíos) y solo desde la
  // ventana que la máquina de estados ya admite para 'interno'. Sin lista
  // hardcodeada: si la máquina de estados cambia, este gate cambia con ella.
  const puedeCancelar =
    puedeAjustar && pedido.tipoPedido === "same_day" && esTransicionValida(pedido.estado, "cancelado", "interno");

  const incidenciasAbiertas = incidencias.filter(
    (i) => i.estado === "abierta" || i.estado === "en_gestion",
  );

  return (
    <div className="space-y-6">
      {/* El retorno explícito del sistema. Antes era un enlace propio con sus
          clases a mano; ahora es el mismo componente que el resto del producto,
          y **conserva los filtros de origen** en vez de mandar al listado de
          fábrica. Nombra el destino: «Volver» a secas obliga a adivinar. */}
      <Retorno href={destinoRetorno("/operaciones", sp.volver)} etiqueta="Volver a pedidos" />

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
            eje="pedido"
            valor={pedido.estado}
          />
        </div>

      </div>

      {/* =====================================================================
       * DOS COLUMNAS.
       * ---------------------------------------------------------------------
       * Antes esta pantalla eran DIEZ bloques apilados en el orden en que se
       * fueron construyendo (encabezado, geocoding, POD, evidencias,
       * cancelación, historial, incidencias, asignación, dinero, acciones), y
       * las acciones quedaban al final. Quien abre un pedido casi siempre viene
       * a HACER algo —reasignar, cambiar estado, abrir incidencia— así que
       * tenía que recorrer la pantalla entera para llegar a lo que buscaba.
       *
       * Izquierda: la historia del pedido, que se lee de arriba a abajo.
       * Derecha: la ficha operativa y las acciones, fijas al hacer scroll.
       * ================================================================== */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* ---------------- Columna izquierda — la historia ---------------- */}
        <div className="space-y-6">
          {/* ── Lectura incompleta ────────────────────────────────────────
              Tablero P3, decisión n.º 6: «falla de lectura ≠ objeto vacío».
              La identidad del pedido se mantiene arriba —el encabezado ya está
              pintado— y acá se dice QUÉ no se pudo leer. Antes esto no existía:
              con `Promise.all` la pantalla entera se caía, y con los cargadores
              que devuelven `[]` ante un error, un fallo se veía idéntico a «no
              hay nada». */}
          {lecturasFallidas.length > 0 && (
            <AvisoLecturaIncompleta partes={lecturasFallidas} />
          )}

          {/* Cancelación: si el pedido está cancelado, es el titular de la
              pantalla y va primero. Estado neutral, nunca destructivo — no es
              una alarma (§6.1/§16). */}
          {pedido.estado === "cancelado" && (
            <section aria-labelledby="cancelacion-titulo">
              <h2 id="cancelacion-titulo" className="mb-3 text-base font-semibold">
                Cancelación
              </h2>
              <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Cancelado el</dt>
                    <dd className="mt-0.5 font-medium">
                      {pedido.canceladoEn
                        ? formatearFechaHora(pedido.canceladoEn)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Cancelado por</dt>
                    <dd className="mt-0.5 font-medium">
                      {canceladoPorTexto ?? "Sincronización automática (Mercado Libre)"}
                    </dd>
                  </div>
                </dl>
                {pedido.motivoCancelacion && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground">Motivo</p>
                    <p className="mt-0.5 italic">&ldquo;{pedido.motivoCancelacion}&rdquo;</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Entrega — NUEVO. La pantalla no mostraba la fecha comprometida en
              ninguna parte, aunque el listado la lleva como columna y toda la
              operación se juega contra el corte de las 21–22 h. Tampoco las
              instrucciones de entrega ni el aviso de corte en riesgo, que
              existían en el modelo y no se renderizaban.
              Deliberadamente NO incluye el teléfono del destinatario: es dato
              personal y agregarlo a una pantalla nueva es una decisión de
              privacidad, no de maquetación. */}
          <section aria-labelledby="entrega-titulo">
            <h2 id="entrega-titulo" className="mb-3 text-base font-semibold">
              Entrega
            </h2>
            <div className="rounded-lg border bg-card p-4 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Fecha comprometida</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {pedido.fechaCompromiso ?? "Sin fecha"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Hora comprometida</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {pedido.fechaCompromisoHora
                      ? formatearHora(pedido.fechaCompromisoHora)
                      : "Sin hora de corte"}
                  </dd>
                </div>
                {pedido.instruccionesEntrega && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">Instrucciones</dt>
                    <dd className="mt-0.5 italic">{pedido.instruccionesEntrega}</dd>
                  </div>
                )}
              </dl>
              {pedido.corteRiesgo && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-warning-subtle px-2.5 py-1 text-xs font-medium text-warning-subtle-foreground">
                  Ingresó cerca del corte — el mismo día queda ajustado
                </p>
              )}
            </div>
          </section>

          {/* ── Seguimiento ───────────────────────────────────────────────
              Se llamaba «Historial de estados». El tablero P3 lo nombra
              SEGUIMIENTO y lo pone PRIMERO de la columna: quien abre un pedido
              pregunta «¿en qué va?» antes que ninguna otra cosa, y la respuesta
              es la línea de hitos con su autor. */}
          <section aria-labelledby="historial-titulo">
            <h2 id="historial-titulo" className="mb-3 text-base font-semibold">
              Seguimiento
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
                        {/* 🔴 El AUTOR, no solo «cambiado manualmente». El
                            tablero pide autor en cada hito —«asignado a R.
                            Muñoz · por C. Rojas»— y esta línea decía que hubo
                            una mano detrás sin decir de quién, que es la mitad
                            inútil del dato. */}
                        <p className="text-xs text-muted-foreground">
                          {entrada.actor_usuario_id
                            ? `${nombresAutores[entrada.actor_usuario_id]?.nombreCompleto ?? "Usuario no encontrado"} · ${formatearFechaHora(entrada.creado_en)}`
                            : `Sincronización automática · ${formatearFechaHora(entrada.creado_en)}`}
                        </p>
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

          {/* ── Prueba de entrega ─────────────────────────────────────────
              Antes eran dos piezas sueltas y sin encabezado: el visor de POD
              solo se pintaba si existía, así que cuando no había prueba la
              pantalla no decía NADA — ni que faltaba, ni de quién dependía. Un
              hueco se lee como «acá no va nada». */}
          <section aria-labelledby="prueba-titulo">
            <h2 id="prueba-titulo" className="mb-3 text-base font-semibold">
              Prueba de entrega
            </h2>
            {pod && <VisorPod pod={pod} />}

            <VisorEvidencias evidencias={evidencias} />

            {!pod && evidencias.length === 0 && (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                Todavía no hay prueba: el conductor la registra al cerrar la parada.
              </p>
            )}
          </section>

          {/* ── Incidencias ───────────────────────────────────────────────
              La sección ya no desaparece cuando no hay ninguna: decir «sin
              incidencias» es información —significa que el pedido va limpio— y
              su ausencia obligaba a deducirlo de un hueco. */}
          <section aria-labelledby="incidencias-titulo">
            <h2 id="incidencias-titulo" className="mb-3 text-base font-semibold">
              Incidencias
            </h2>
            {incidenciasAbiertas.length > 0 ? (
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
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                Sin incidencias en este pedido.
              </p>
            )}
          </section>

          {/* Estado de geocoding — es diagnóstico, así que baja hasta aquí. El
              aviso corto ya vive en el encabezado; este bloque es el detalle
              con la acción de reubicar, y solo aparece cuando hace falta. */}
          <SeccionGeocoding pedido={pedido} pendienteRancio={geoRancio} puedeReubicar={puedeAjustar} />

          {/* Dinero — trazabilidad financiera bidireccional (§1.1 P1 del audit).
              Gateada a roles financieros: no se renderiza en el DOM para el
              resto de roles (no basta con ocultar vía CSS). Va en esta columna
              porque es material de lectura y necesita ancho. */}
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
        </div>

        {/* ------ Columna derecha — ficha operativa y acciones, siempre a la
                   vista al hacer scroll de la columna izquierda. ------------ */}
        <div className="space-y-6 lg:sticky lg:top-6">
          {/* Acciones primero: es lo que viene a hacer la mayoría de quienes
              abren un pedido. Antes era el último bloque de la pantalla. */}
          <AccionesPedido
            pedido={pedido}
            asignacion={asignacion}
            conductorNombre={conductorNombre}
            puedeAsignar={puedeAsignar}
            puedeIncidencias={puedeIncidencias}
            puedeAjustar={puedeAjustar}
            esTerminal={esTerminal}
          />

          {/* 🔴 Zona y bitácora van PEGADAS a las acciones, no al final de la
              columna. El tablero las dibuja seguidas —acciones → zona →
              bitácora— y con Asignación y Ficha en medio, en el teléfono el
              botón «Más acciones» y la zona que advierte quedaban separados por
              dos pantallazos de material de consulta. Asignación y Ficha bajan:
              son referencia, se miran cuando hace falta cotejar algo. */}
          {/* ── Zona de consecuencia ─────────────────────────────────────────
              Tablero P3, decisión n.º 2. Va AL FINAL y con marco propio: lo
              grave no se mezcla con lo reversible.

              🔴 Las dos anulaciones de dinero entran acá por PRIMERA VEZ.
              `AccionesCorregirDinero` existía, sus Server Actions existían, y
              no tenía un solo llamador en todo el repo: desde esta pantalla no
              había forma de anular el cobro ni la liquidación de un pedido. */}
          <ZonaConsecuenciaPedido
            pedido={pedido}
            traza={traza}
            sellerNombre={sellerNombre}
            conductorNombre={conductorNombre}
            puedeCancelar={puedeCancelar}
            puedeAnularDinero={puedeVerConciliacion(sesion.usuario) && !falloElDinero}
            motivoBloqueo={
              falloElDinero
                ? "No pudimos leer el dinero de este pedido. Anular una línea sin verla sería a ciegas."
                : null
            }
          />

          {/* ── Bitácora del pedido ───────────────────────────────────────
              Tablero P3, decisión n.º 4: «la auditoría es contexto, no
              consecuencia». Va a la vista y sin abrir nada, JUSTO DEBAJO de la
              zona de consecuencia, para que quien está por hacer algo grave ya
              vea el registro donde va a quedar.

              Solo para quien tiene `ver_bitacora_auditoria` —dueño y
              administración—. Regla dura del sistema: un rol sin la capacidad
              no ve la opción; nada de candados ni bloques grises. */}
          {puedeVerBitacora && <BitacoraDelPedido entradas={bitacora} />}

          {/* Asignación: quién lo tiene. Justo bajo las acciones porque es el
              contexto con el que se decide reasignar. */}
          <section aria-labelledby="asignacion-titulo">
            <h2 id="asignacion-titulo" className="mb-3 text-base font-semibold">
              Asignación
            </h2>
            <div className="rounded-lg border bg-card p-4 text-sm">
              {asignacion ? (
                <dl className="grid gap-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Conductor</dt>
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

          {/* Ficha — los identificadores del pedido. Estaban en el encabezado,
              como una rejilla de cuatro columnas que competía con el nombre del
              destinatario. Aquí son lo que de verdad son: material de consulta
              que se mira cuando hace falta cotejar un ID con Mercado Libre. */}
          <section aria-labelledby="ficha-titulo">
            <h2 id="ficha-titulo" className="mb-3 text-base font-semibold">
              Ficha
            </h2>
            <div className="rounded-lg border bg-card p-4 text-sm">
              <dl className="grid gap-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Fuente</dt>
                  <dd className="font-medium">{etiquetaFuentePedido(pedido.fuente)}</dd>
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
                  <dd className="font-mono text-xs break-all">{pedido.id}</dd>
                </div>
                {pedido.mlShipmentId && (
                  <div>
                    <dt className="text-xs text-muted-foreground">ML Shipment ID</dt>
                    <dd className="font-mono text-xs break-all text-muted-foreground">
                      {pedido.mlShipmentId}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

/**
 * Aviso de lectura incompleta.
 *
 * Dice QUÉ faltó, no «hubo un error»: la diferencia entre «no pudimos leer el
 * dinero» y «no pudimos leer el seguimiento» decide si la persona puede seguir
 * trabajando o no. Y advierte contra la acción concreta que sería peligrosa
 * sobre datos a medias.
 */
/**
 * «a, b y c» — no `join(", ")`.
 *
 * ⚠️ Y por eso la frase dice «falló leer» y no «falló la lectura de»: los
 * rótulos llevan artículo («el dinero»), así que la preposición producía «de el
 * dinero». Se arregla en la frase, no en los rótulos: quitarles el artículo los
 * dejaría sin poder usarse en ninguna otra oración.
 */
function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

function AvisoLecturaIncompleta({ partes }: { partes: string[] }) {
  return (
    <div
      role="alert"
      className="border border-attention-line bg-attention-bg px-4 py-3 text-sm text-attention-fg"
    >
      <p className="font-semibold">No pudimos cargar el detalle completo</p>
      <p className="mt-1">
        El pedido existe: lo que falló fue leer{" "}
        <span className="font-medium">{enumerar(partes)}</span>. No lo cambies de estado hasta
        verlo completo.
      </p>
      <BotonReintentarLectura />
    </div>
  );
}

/**
 * Bitácora del pedido — quién hizo qué, y cuándo.
 *
 * Lista, no tabla: son tres columnas de las cuales dos son cortas y la del
 * medio manda. En una tabla, la hora y el autor compiten con lo único que se
 * viene a leer.
 */
function BitacoraDelPedido({ entradas }: { entradas: EntradaBitacora[] }) {
  return (
    <section aria-labelledby="bitacora-titulo">
      <h2 id="bitacora-titulo" className="mb-3 text-base font-semibold">
        Bitácora de este pedido
      </h2>
      <div className="rounded-lg border bg-card p-4">
        {entradas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay nada registrado sobre este pedido.
          </p>
        ) : (
          <ol className="space-y-2.5">
            {entradas.map((e) => (
              <li key={e.id} className="text-sm">
                <p className="text-fg">
                  <span className="font-mono text-xs text-fg-subtle tabular-nums">
                    {formatearFechaHora(e.creadoEn)}
                  </span>{" "}
                  <span className="font-medium">{e.autor ?? "Rutax"}</span> {e.frase}
                </p>
                {e.motivo && (
                  <p className="mt-0.5 text-xs text-muted-foreground italic">
                    &ldquo;{e.motivo}&rdquo;
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// Zona de consecuencia del pedido
// =============================================================================

function ZonaConsecuenciaPedido({
  pedido,
  traza,
  sellerNombre,
  conductorNombre,
  puedeCancelar,
  puedeAnularDinero,
  motivoBloqueo,
}: {
  pedido: Pedido;
  traza: Awaited<ReturnType<typeof obtenerTrazaDineroPorPedido>> | null;
  sellerNombre: string | null;
  conductorNombre: string | null;
  puedeCancelar: boolean;
  puedeAnularDinero: boolean;
  /** Por qué las acciones de dinero no están disponibles. `null` = sí lo están. */
  motivoBloqueo: string | null;
}) {
  // Una línea ya anulada no se puede volver a anular: ofrecer el botón sería
  // prometer una acción que el servidor rechaza («la línea ya está anulada»).
  const hayCobro = Boolean(traza?.cobro && !traza.cobro.anulada);
  const hayLiquidacion = Boolean(traza?.liquidacion && !traza.liquidacion.anulada);
  const anularCobro = puedeAnularDinero && hayCobro;
  const anularLiquidacion = puedeAnularDinero && hayLiquidacion;

  // Regla dura del sistema: un rol sin la capacidad NO VE la opción. Si no
  // queda ninguna, la zona entera desaparece — nada de marcos rojos vacíos.
  if (!puedeCancelar && !anularCobro && !anularLiquidacion && !motivoBloqueo) return null;

  return (
    <ZonaConsecuencia resumen="Las tres piden motivo escrito y quedan a tu nombre. Anular una línea de dinero no deshace la entrega: solo saca la plata del período.">
      {/* 🔴 Deshabilitado CON MOTIVO, no escondido. El tablero es explícito:
          «si no pudimos leer el dinero, anularlo sería a ciegas». Ocultar la
          acción haría creer que este pedido no tiene línea que anular. */}
      {motivoBloqueo && (
        <p className="border border-fault-line/60 bg-bg-raised px-3 py-2 text-xs text-fg-muted">
          {motivoBloqueo}
        </p>
      )}
      {anularCobro && (
        <FilaConsecuencia descripcion="Anular el cobro al seller">
          <DialogAnular
            pedidoId={pedido.id}
            titulo="Vas a anular el cobro de este pedido"
            descripcion={
              <>
                La línea sale del período y el seller deja de verla. Queda registrada
                como anulada con tu nombre y tu motivo, <strong>no se borra</strong>. Si
                el período ya estuviera facturado, esto no se puede hacer.
              </>
            }
            ayudaMotivo="Queda en la bitácora, con tu nombre."
            accion={accionAnularCobroPedido}
            etiquetaBoton="Anular"
            textoConfirmar="Anular el cobro"
          />
        </FilaConsecuencia>
      )}

      {anularLiquidacion && (
        <FilaConsecuencia descripcion="Anular la liquidación al conductor">
          <DialogAnular
            pedidoId={pedido.id}
            titulo="Vas a quitarle esta línea a la liquidación del conductor"
            descripcion={
              <>
                El conductor va a ver la línea anulada <strong>con tu motivo</strong> en su
                liquidación y en su PDF. Si ya le pagaste este período, esto no lo
                devuelve: hay que ajustarlo en el próximo.
              </>
            }
            ayudaMotivo="Lo lee el conductor, en su liquidación y en su PDF."
            accion={accionAnularLiquidacionPedido}
            etiquetaBoton="Anular"
            textoConfirmar="Anular la línea"
          />
        </FilaConsecuencia>
      )}

      {puedeCancelar && (
        <FilaConsecuencia descripcion="Cancelar el pedido">
          <DialogCancelarPedido
            pedidoId={pedido.id}
            codigoVisible={pedido.codigoInterno ?? pedido.mlShipmentId ?? pedido.id.slice(0, 8)}
            sellerNombre={sellerNombre}
            conductorNombre={conductorNombre}
            // ⚠️ En Flex el seguimiento del comprador lo gobierna Mercado Libre y
            // nuestra página ni responde: prometer que «va a decir que se
            // canceló» sería falso justo en la fuente que hoy es casi toda la
            // operación.
            seguimientoEsDeRutax={!podLoGobiernaLaFuente(pedido.fuente)}
          />
        </FilaConsecuencia>
      )}
    </ZonaConsecuencia>
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
                {formatearFechaHora(pedido.geocodificadoEn)}
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
          <BadgeEstado
                  variante={BADGE_ESTADO_INCIDENCIA[incidencia.estado]}
                  texto={traducirEstadoIncidencia(incidencia.estado)}
                  eje="incidencia"
                  valor={incidencia.estado}
                />
        </div>
      </div>
    </li>
  );
}

/**
 * Una acción de peldaño 1, con su rótulo.
 * =============================================================================
 * Tablero P3: «lo reversible como lista, con su rótulo `reversible`». El rótulo
 * existe para que la reversibilidad se sepa ANTES de tocar — que es la mitad de
 * la escalera de fricción que no vive en los diálogos.
 *
 * ⚠️ El rótulo va DEBAJO del control y no al lado. En el tablero la columna es
 * ancha y caben los dos en una línea; acá mide 20 rem, y meter el rótulo al
 * costado deja el botón en un ancho distinto por acción según lo que mida su
 * texto. La lista se lee peor y el rótulo deja de escanearse.
 */
function AccionReversible({ children }: { children: React.ReactNode }) {
  return (
    <div>
      {children}
      <span className="mt-0.5 block text-right font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
        reversible
      </span>
    </div>
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
}: {
  pedido: Pedido;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  asignacion: any;
  conductorNombre: string | null;
  /** Para la consecuencia de cancelar: a quién deja de cobrársele. */
  puedeAsignar: boolean;
  puedeIncidencias: boolean;
  puedeAjustar: boolean;
  esTerminal: boolean;
}) {
  const tieneAsignacion = !!asignacion;
  const esPendiente = pedido.estado === "pendiente_asignacion";
  // La reasignación solo es válida si la máquina de estados admite volver a
  // 'pendiente_asignacion' desde el estado actual (hoy solo desde 'asignado' —
  // una vez en_ruta, la vía es marcarlo 'fallido' y reasignar desde ahí).
  const puedeReasignar =
    tieneAsignacion && esTransicionValida(pedido.estado, "pendiente_asignacion", "interno");
  // 🔴 **No basta con «no es terminal».** Mercado Libre solo sirve la etiqueta
  // mientras el envío está en `ready_to_ship`/`ready_to_print`: en cuanto sale
  // a la calle deja de darla, y hasta hoy el botón se mostraba igual, el
  // courier hacía clic, esperaba, y recibía un 502 genérico por lo que en
  // realidad era el estado normal de un pedido en ruta. Ver
  // `etiqueta-disponible.ts`.
  const etiqueta = disponibilidadEtiqueta({
    tipoPedido: pedido.tipoPedido,
    mlShipmentId: pedido.mlShipmentId ?? null,
    estadoMl: pedido.estadoMl ?? null,
    estado: pedido.estado,
  });
  const puedeDescargarEtiqueta = puedeAsignar && etiqueta.disponible;

  /**
   * 🔴 **Cuando NO se puede, hay que decirlo.** La regla calcula una frase por
   * cada motivo justamente para eso, y esta pantalla no la mostraba: si la
   * etiqueta no estaba disponible no se pintaba ni el botón ni una explicación,
   * y el courier se quedaba mirando un hueco sin saber si esperar, reintentar o
   * desistir. El silencio se lee como «acá no va nada», no como «hoy no».
   *
   * No se dice en dos casos, y por razones distintas: en un pedido terminal la
   * sección entera no se renderiza, y a quien no puede asignar tampoco le sirve
   * saberlo — nunca iba a ver el botón.
   */
  const frasesSinEtiqueta =
    puedeAsignar && !etiqueta.disponible && etiqueta.motivo !== "terminal"
      ? etiqueta.frase
      : null;

  // Sin ninguna acción visible: no renderizar nada. `DrawerCambioEstado` (el
  // único botón que gatea `puedeAjustar`) se auto-oculta cuando no hay ningún
  // estado destino válido — y un pedido terminal NUNCA tiene uno (la máquina de
  // estados no admite transiciones de salida desde un estado terminal). Sin el
  // `&& !esTerminal` aquí, el título "Acciones" quedaba huérfano en cualquier
  // pedido terminal cuando el usuario tenía `puedeAjustar` pero ninguna otra
  // capacidad: el título se pintaba y no había ni un botón debajo.
  const hayAcciones =
    (puedeAsignar && (esPendiente || puedeReasignar)) ||
    (puedeIncidencias && !esTerminal) ||
    (puedeAjustar && !esTerminal) ||
    puedeDescargarEtiqueta;

  if (!hayAcciones) return null;

  return (
    <section aria-labelledby="acciones-titulo">
      <h2 id="acciones-titulo" className="mb-3 text-base font-semibold">
        Acciones
      </h2>
      {/* `grid` y no `flex flex-wrap`: en la columna lateral cada acción ocupa
          su propia fila a ancho completo, en vez de partirse en dos columnas
          desiguales según la longitud del texto. */}
      <div className="grid gap-2">
        {puedeAsignar && esPendiente && (
          <AccionReversible>
            <Link
              href={`/manifiestos?asignarPedido=${pedido.id}`}
              className="block rounded-lg border bg-card px-4 py-2 text-center text-sm font-medium hover:bg-muted transition-colors"
            >
              Asignar a manifiesto
            </Link>
          </AccionReversible>
        )}

        {puedeAsignar && puedeReasignar && (
          <AccionReversible>
            <DialogReasignacion
            pedidoId={pedido.id}
            estadoActual={pedido.estado}
            conductorActual={conductorNombre ?? asignacion.driver_id}
              manifiestoActual={asignacion.manifiestos?.nombre ?? asignacion.manifiesto_id}
            />
          </AccionReversible>
        )}

        {puedeIncidencias && !esTerminal && (
          <AccionReversible>
            <DrawerIncidencia pedidoId={pedido.id} sellerId={pedido.sellerId} />
          </AccionReversible>
        )}

        {/* ⚠️ **«Cambiar de estado» va SIN rótulo, a propósito.** Es el único
            de esta lista que no es de peldaño 1: puede llevar el pedido a un
            estado TERMINAL —entregado, fallido— y de ahí la máquina de estados
            no admite salida. Rotularlo «reversible» sería mentir sobre la única
            acción de la lista que no lo es.

            Lo que le corresponde según el tablero es peldaño 2 —modal con la
            consecuencia en números y tercera salida—, y eso es una decisión
            pendiente, no algo que se arregle poniéndole otra etiqueta. */}
        {puedeAjustar && (
          <DrawerCambioEstado
            pedidoId={pedido.id}
            estadoActual={pedido.estado}
          />
        )}

        {puedeDescargarEtiqueta && (
          <AccionReversible>
            <BotonDescargarEtiqueta pedidoId={pedido.id} esSameDay={pedido.tipoPedido === "same_day"} />
          </AccionReversible>
        )}

        {frasesSinEtiqueta && (
          <p className="rounded-lg border border-dashed px-4 py-2 text-center text-xs text-muted-foreground">
            {frasesSinEtiqueta}
          </p>
        )}

        {/* 🔴 «Cancelar el pedido» ya NO vive acá: se fue a la zona de
            consecuencia. Estaba en esta misma lista y con el mismo peso visual
            que «Abrir una incidencia», o sea que la gravedad solo aparecía
            dentro del diálogo — cuando la persona ya había hecho clic. */}
      </div>
    </section>
  );
}
