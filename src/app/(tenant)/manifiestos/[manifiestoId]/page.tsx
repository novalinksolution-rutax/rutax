/**
 * Vista del manifiesto — Pantalla 2-B (Flujo 2)
 *
 * Server Component. Encabezado con estado en badge, lista de pedidos asignados
 * (editable si estado = borrador, solo lectura si no), botones de acción según
 * estado y dialog de confirmación antes de confirmar.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Package } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAsignarYReasignarPedidos, puedeGenerarManifiestos } from "@/modules/identidad/capacidades";
import { mapaNombresConductores } from "@/modules/identidad/consultas";
import {
  traducirEstadoManifiesto,
  traducirEstadoPedido,
  BADGE_ESTADO_MANIFIESTO,
  BADGE_ESTADO_PEDIDO,
} from "@/lib/ui/traduccion-estados";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { BloqueTrazabilidad } from "@/components/ui/bloque-trazabilidad";
import { obtenerTrazabilidad } from "@/modules/identidad/trazabilidad";
import type { Manifiesto, EstadoManifiesto, Pedido, EstadoPedido } from "@/modules/operacion/tipos";
import { ordenarParadasConSecuencia } from "@/modules/operacion/orden-paradas";
import { etiquetaFechaCivilCorta } from "@/lib/ui/rango-fecha";
import {
  hoyEnSantiago,
  limitesDelDiaSantiago,
  combinarFechaHoraSantiago,
  sumarDiasCalendario,
} from "@/lib/fecha-santiago";
import { obtenerOrigenRutaDelCourier } from "@/modules/operacion/ruta-manifiesto";
import { ESTADOS_TERMINALES_PEDIDO } from "@/modules/operacion/metricas";
import { detectarPedidosSinTarifa } from "@/modules/operacion/tarifas";
import { BotonConfirmarManifiesto } from "./boton-confirmar-manifiesto";
import { BotonCancelarManifiesto } from "./boton-cancelar-manifiesto";
import { BotonCompletarManifiesto } from "./boton-completar-manifiesto";
import { BotonRedistribuir } from "./boton-redistribuir";
import { PanelRuta, type ParadaVista } from "./panel-ruta";
import { Retorno, destinoRetorno } from "@/components/app-shell/retorno";

// =============================================================================
// Tipos auxiliares
// =============================================================================

interface PedidoAsignado {
  asignacionId: string;
  pedido: Pedido;
  /**
   * Secuencia persistida de la parada dentro del manifiesto (etapa 7,
   * `asignaciones_pedido.orden_ruta`). `null` = este manifiesto no está ruteado,
   * o esta parada quedó sin ubicar.
   */
  ordenRuta: number | null;
}

// =============================================================================
// Carga de datos
// =============================================================================

async function cargarManifiesto(
  manifiestoId: string,
  tenantId: string,
): Promise<Manifiesto | null> {
  const cliente = crearClienteServiceRole();
  const { data, error } = await cliente
    .from("manifiestos")
    .select("*")
    .eq("id", manifiestoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) return null;

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

/**
 * Las paradas del manifiesto, o `null` si NO SE PUDIERON LEER.
 *
 * La distinción no es formalismo. Antes devolvía `[]` ante cualquier error, y el
 * vacío de la pantalla decía «este manifiesto no tiene pedidos todavía» — o sea
 * que una consulta caída se leía como un manifiesto vacío. Con la flota por
 * salir, eso invita a cancelarlo o a redistribuirlo: dos actos irreversibles
 * sobre 28 paradas que están perfectamente ahí.
 */
async function cargarPedidosAsignados(
  manifiestoId: string,
  tenantId: string,
): Promise<PedidoAsignado[] | null> {
  const cliente = crearClienteServiceRole();
  const { data, error } = await cliente
    .from("asignaciones_pedido")
    .select(
      // ⚠️ `lat, long` y las demás columnas de geocoding NO estaban en esta
      // lista, aunque el mapeo de abajo las leía desde el 2026 — así que
      // llegaban siempre en `null`. No molestaba a nadie mientras esta pantalla
      // solo mostrara direcciones; con la etapa 7 sí: sin ellas TODA parada se
      // pinta como "sin ubicación" y el panel de ruta no puede medir un tramo.
      // Si agregas una columna al mapeo, agrégala también aquí.
      "id, pedido_id, orden_ruta, pedidos(id, tenant_id, seller_id, tipo_pedido, fuente, origen, ml_order_id, ml_shipment_id, id_externo, referencia_externa, estado, estado_ml, subestado_ml, ultima_sync_ml_en, driver_id_asignado, destinatario_nombre, destinatario_direccion, destinatario_comuna, destinatario_telefono, instrucciones_entrega, fecha_compromiso, tarifa_aplicable_id, notas_internas, creado_en, actualizado_en, lat, long, geo_estado, geo_confianza, geocodificado_en, cobertura_estado)",
    )
    .eq("manifiesto_id", manifiestoId)
    .eq("tenant_id", tenantId)
    .eq("activa", true);

  if (error || !data) return null;

  return data
    .map((row: Record<string, unknown>) => {
      const p = row.pedidos as Record<string, unknown> | null;
      if (!p) return null;
      return {
        asignacionId: row.id as string,
        ordenRuta: (row.orden_ruta as number | null) ?? null,
        pedido: {
          id: p.id as string,
          tenantId: p.tenant_id as string,
          sellerId: p.seller_id as string,
          tipoPedido: p.tipo_pedido as Pedido["tipoPedido"],
          fuente: p.fuente as Pedido["fuente"],
          origen: p.origen as Pedido["origen"],
          idExterno: (p.id_externo as string | null) ?? null,
          referenciaExterna: (p.referencia_externa as string | null) ?? null,
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
        } satisfies Pedido,
      };
    })
    .filter((x): x is PedidoAsignado => x !== null);
}

async function cargarNombreConductor(driverId: string, tenantId: string): Promise<string> {
  // Mismo origen que la lista de manifiestos: `identidad.conductores` por tenant.
  try {
    const cliente = crearClienteServiceRole();
    const mapa = await mapaNombresConductores(cliente, tenantId, [driverId]);
    return mapa[driverId] ?? driverId;
  } catch {
    return driverId;
  }
}

// =============================================================================
// Página
// =============================================================================

interface Props {
  params: Promise<{ manifiestoId: string }>;
  searchParams: Promise<{ volver?: string }>;
}

export default async function PaginaDetalleManifiesto({ params, searchParams }: Props) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  const { manifiestoId } = await params;
  const { volver } = await searchParams;
  const tenantId = sesion.usuario.tenantId;

  const [manifiesto, paradasLeidas, origenRuta] = await Promise.all([
    cargarManifiesto(manifiestoId, tenantId),
    cargarPedidosAsignados(manifiestoId, tenantId),
    // La bodega desde la que sale la flota: origen de la ruta y punto desde el
    // que se mide el primer tramo. Puede no estar configurada todavía — el panel
    // lo dice y esconde las distancias en vez de inventarlas.
    obtenerOrigenRutaDelCourier(crearClienteServiceRole(), tenantId),
  ]);

  if (!manifiesto) notFound();

  // El MISMO orden que verá el conductor en la PWA y en la app nativa: la
  // secuencia persistida (`orden_ruta`, etapa 7) si el manifiesto está ruteado,
  // y el alfabético por comuna y dirección (D-04 / RF-025) como respaldo cuando
  // no lo está. Las tres pantallas pasan por `ordenarParadasConSecuencia` para
  // que no puedan volver a divergir.
  // `null` = falla de lectura. La pantalla lo dice y esconde todo lo que
  // dependa de saber cuántas paradas hay.
  const fallaDeLectura = paradasLeidas === null;
  const pedidosAsignadosSinOrden = paradasLeidas ?? [];

  const asignacionPorPedidoId = new Map(
    pedidosAsignadosSinOrden.map((pa) => [pa.pedido.id, pa] as const),
  );
  const ordenPorPedidoId = new Map(
    pedidosAsignadosSinOrden.map((pa) => [pa.pedido.id, pa.ordenRuta] as const),
  );
  const pedidosAsignados = ordenarParadasConSecuencia(
    pedidosAsignadosSinOrden.map((pa) => pa.pedido),
    ordenPorPedidoId,
  ).map((pedido) => asignacionPorPedidoId.get(pedido.id)!);

  const nombreConductor = await cargarNombreConductor(manifiesto.driverId, tenantId);

  // «hoy» cuando corresponde: es la ruta que se está mirando en vivo, y decirlo
  // ahorra tener que comparar la fecha con la de la cabeza.
  const etiquetaDelDia =
    manifiesto.fechaOperacion === hoyEnSantiago()
      ? "hoy"
      : etiquetaFechaCivilCorta(manifiesto.fechaOperacion);

  // La bitácora del manifiesto. Hasta hoy TODO lo que le pasaba a un manifiesto
  // quedaba registrado y no se veía desde ninguna pantalla: había que entrar al
  // backstage. Acá es donde se necesita — al lado de las acciones que la
  // escriben.
  //
  // Son DOS orígenes, y el segundo no es un capricho: «se cayó el conductor» se
  // registra contra la entidad `conductor` —ahí es donde pertenece, porque mueve
  // paradas de varios manifiestos— pero se **ejecuta desde esta pantalla**, con
  // la bitácora justo debajo del botón. Leyendo solo `manifiesto`, el
  // coordinador redistribuye 15 paradas y el recuadro de abajo sigue diciendo
  // «todavía no hay movimientos registrados».
  //
  // Las del conductor se acotan a la VENTANA OPERATIVA del manifiesto: una caída
  // de ayer no es un hecho de esta ruta. La ventana llega hasta las 06:00 del día
  // siguiente y no hasta la medianoche, porque el corte es a las 21:00–22:00 y el
  // cierre puede pasarse de las doce; entre medianoche y el amanecer no ocurre
  // nada operativo, así que lo que se registre ahí pertenece al día que terminó.
  const ventana = {
    desde: limitesDelDiaSantiago(manifiesto.fechaOperacion).desde,
    hasta: combinarFechaHoraSantiago(
      sumarDiasCalendario(manifiesto.fechaOperacion, 1),
      "06:00",
    ),
  };

  const cliente = crearClienteServiceRole();
  const [hechosManifiesto, hechosConductor] = await Promise.all([
    obtenerTrazabilidad(cliente, tenantId, "manifiesto", manifiestoId, { limite: 8 }).catch(
      () => [],
    ),
    obtenerTrazabilidad(cliente, tenantId, "conductor", manifiesto.driverId, {
      acciones: ["operacion.conductor_caido", "operacion.redistribucion_completada"],
      limite: 8,
    }).catch(() => []),
  ]);

  const bitacora = [
    ...hechosManifiesto,
    ...hechosConductor.filter((h) => {
      const cuando = new Date(h.cuando);
      return cuando >= ventana.desde && cuando < ventana.hasta;
    }),
  ]
    .sort((a, b) => b.cuando.localeCompare(a.cuando))
    .slice(0, 8);

  const puedeAsignar = puedeAsignarYReasignarPedidos(sesion.usuario);
  const puedeCrearManifiesto = puedeGenerarManifiestos(sesion.usuario);
  const esBorrador = manifiesto.estado === "borrador";
  const esConfirmado = manifiesto.estado === "confirmado";
  const enRuta = manifiesto.estado === "en_ruta";
  const hayPedidos = pedidosAsignados.length > 0;

  // Paradas que NO llegaron a un estado final. Es lo que el diálogo de cierre
  // le advierte al coordinador: cerrar el manifiesto NO las entrega, y seguirán
  // apareciendo para asignar hasta que alguien les dé estado.
  const paradasAbiertas = pedidosAsignados.filter(
    ({ pedido }) => !ESTADOS_TERMINALES_PEDIDO.includes(pedido.estado),
  ).length;

  // Cuántas ya cerró el conductor. Es el complemento de `paradasAbiertas`, y va
  // en el distintivo del encabezado: «28 paradas · 14 cerradas» dice de un
  // vistazo si la ruta va por la mitad.
  const paradasCerradas = pedidosAsignados.length - paradasAbiertas;

  // Las paradas que se van a entregar sin poder cobrarse. El reparo va pegado a
  // la parada, no en un aviso arriba: quien lee la ruta necesita saber CUAL, y
  // un contador general no se puede accionar desde esta pantalla.
  const sinTarifa = await detectarPedidosSinTarifa(
    crearClienteServiceRole(),
    { tenantId, fecha: manifiesto.fechaOperacion },
    pedidosAsignados.map(({ pedido }) => ({
      id: pedido.id,
      sellerId: pedido.sellerId,
      tipoPedido: pedido.tipoPedido,
    })),
  ).catch(() => new Set<string>());

  const paradas: ParadaVista[] = pedidosAsignados.map(({ asignacionId, pedido, ordenRuta }) => ({
    pedidoId: pedido.id,
    asignacionId,
    destinatarioNombre: pedido.destinatarioNombre,
    destinatarioComuna: pedido.destinatarioComuna,
    destinatarioDireccion: pedido.destinatarioDireccion,
    fechaCompromiso: pedido.fechaCompromiso,
    estadoTexto: traducirEstadoPedido(pedido.estado),
    estadoVariante: BADGE_ESTADO_PEDIDO[pedido.estado],
    lat: pedido.lat,
    long: pedido.long,
    ruteada: ordenRuta !== null,
    cerrada: ESTADOS_TERMINALES_PEDIDO.includes(pedido.estado),
    sinTarifa: sinTarifa.has(pedido.id),
  }));

  return (
    <div className="space-y-6">
      {/* Volver */}
      <Retorno href={destinoRetorno("/manifiestos", volver)} etiqueta="Volver a manifiestos" />

      {/* Encabezado */}
      {/* El título es el CONDUCTOR, no el nombre del manifiesto: se entra acá
          para ver la ruta de alguien. El nombre del documento queda debajo, que
          es donde sirve para hablar de él.

          ⛔ El tablero pone en el subtítulo «Bodega Quilicura → punto de término
          en Ñuñoa». El punto de término NO aparece, y no es un olvido: bajo
          subordinación laboral el consentimiento solo es libre si negarse no
          queda a la vista del jefe, así que la salida tiene que ser idéntica
          exista o no (`docs/seguridad/punto-de-termino-conductor.md` §4).
          Mostrarlo reabre esa revisión. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold">{nombreConductor}</h1>
          <p className="rx-num mt-0.5 text-xs text-fg-muted">
            {/* La fecha escrita, no el ISO crudo. Y ojo: `fecha_operacion` es una
                fecha CIVIL ('YYYY-MM-DD'), así que pasa por
                `etiquetaFechaCivilCorta` y no por los formateadores de instante
                — `new Date("2026-08-24")` es medianoche UTC, o sea el 23 por la
                tarde en Santiago, y el encabezado mostraría el día anterior. */}
            {etiquetaDelDia} · {manifiesto.nombre}
            {origenRuta?.nombre ? ` · sale desde ${origenRuta.nombre}` : ""}
          </p>
          {manifiesto.notas && (
            <p className="mt-1 text-sm text-fg-muted italic">{manifiesto.notas}</p>
          )}
          {/* Los tres distintivos del tablero. El de km solo aparece si la ruta
              está calculada: sin secuencia no hay kilometraje que declarar, y un
              «0 km» se leería como que la ruta no tiene distancia. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <BadgeEstado
              variante={BADGE_ESTADO_MANIFIESTO[manifiesto.estado]}
              eje="manifiesto"
              valor={manifiesto.estado}
              texto={traducirEstadoManifiesto(manifiesto.estado)}
            />
            {hayPedidos ? (
              <span className="rx-num border border-line px-1.5 py-0.5 text-[11px] text-fg-muted">
                {pedidosAsignados.length} paradas · {paradasCerradas} cerradas
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* --- Las dos columnas ----------------------------------------------
          Ancha: la secuencia de la ruta. Angosta: acciones, zona de consecuencia
          y bitácora. Antes las acciones eran una fila suelta bajo la tabla y la
          bitácora no existía en pantalla. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {/* ⚠️ FALLA DE LECTURA — el estado que antes se disfrazaba de vacío.
              No se ofrece «reintentar»: recargar la página es lo mismo y no
              inventa un botón que puede fallar igual. Lo importante es la
              advertencia de no actuar a ciegas. */}
          {fallaDeLectura ? (
            <div className="border border-fault-line bg-fault-bg px-4 py-3.5">
              <p className="text-sm leading-relaxed text-fault-fg">
                <strong className="font-medium">No se pudieron leer las paradas.</strong> El
                manifiesto existe y puede tener paradas asignadas: esta pantalla no las está
                viendo. No lo canceles ni redistribuyas hasta poder verlas — recarga en unos
                segundos.
              </p>
            </div>
          ) : hayPedidos ? (
            /* El panel es un componente de cliente por convención con el
               resto de esta pantalla, pero desde 2026-09-05 es de solo
               lectura: el cálculo y el reordenamiento manual se retiraron de
               la web (ver la cabecera de panel-ruta.tsx). */
            <PanelRuta
              manifiestoId={manifiestoId}
              paradas={paradas}
              origen={origenRuta}
              puedeQuitar={esBorrador && puedeAsignar}
            />
          ) : (
            <EmptyState
              icon={Package}
              titulo="Esta ruta no tiene ni una parada"
              descripcion={textoVacioSegunEstado(manifiesto.estado, nombreConductor)}
              accion={
                esBorrador && puedeAsignar ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/preparacion/asignar?conductor=${manifiesto.driverId}`}>
                      Agregar pedidos
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>

        <aside className="space-y-5">
          {esBorrador && (puedeAsignar || puedeCrearManifiesto) && !fallaDeLectura ? (
            <section className="flex flex-col items-stretch gap-2">
              <Rotulo>Acciones</Rotulo>
              {puedeAsignar ? (
                <Button asChild variant="outline" size="sm" className="w-full justify-start">
                  <Link href={`/preparacion/asignar?conductor=${manifiesto.driverId}`}>
                    <Plus className="size-4" aria-hidden="true" />
                    Agregar pedidos
                  </Link>
                </Button>
              ) : null}
              {puedeAsignar ? (
                <BotonConfirmarManifiesto
                  manifiestoId={manifiestoId}
                  nombreConductor={nombreConductor}
                  totalPedidos={pedidosAsignados.length}
                  habilitado={hayPedidos}
                />
              ) : null}
            </section>
          ) : null}

          {/* Acá había un enlace «Ver como lo ve el conductor», que abría la
              PWA. La PWA se retiró el 24-08-2026 y el conductor trabaja en la
              app nativa, que el coordinador no puede abrir desde su escritorio.
              Se dice lo que SÍ ocurre en vez de ofrecer una vista que ya no
              existe: un enlace roto en una pantalla de operación es peor que no
              tener enlace. */}
          {esConfirmado ? (
            <p className="border border-line bg-bg-sunken px-3 py-2.5 text-sm text-fg-muted">
              Manifiesto confirmado. Sus paradas ya le aparecen al conductor en la app, en el
              orden de la ruta.
            </p>
          ) : null}

          {/* Cerrar una ruta que quedó abierta. El conductor solo puede cerrar
              la de HOY —su app resuelve el manifiesto vigente por
              `fecha_operacion`—, así que un manifiesto de ayer todavía `en_ruta`
              no lo podía cerrar nadie. */}
          {enRuta && puedeAsignar && !fallaDeLectura ? (
            <section className="flex flex-col items-stretch gap-2">
              <Rotulo>Cerrar la ruta</Rotulo>
              <BotonCompletarManifiesto
                manifiestoId={manifiestoId}
                driverId={manifiesto.driverId}
                nombreConductor={nombreConductor}
                paradasAbiertas={paradasAbiertas}
              />
            </section>
          ) : null}

          {/* --- Zona de consecuencia ------------------------------------------
              Las acciones que cambian algo de verdad, juntas y enmarcadas, con
              su recordatorio de que todo queda registrado. Mezcladas entre
              «agregar pedidos» pierden el peso que tienen. */}
          {/* ⚠️ La zona entera se apaga ante una falla de lectura: son los dos
              actos irreversibles de la pantalla, y ejecutarlos sin poder ver las
              paradas es exactamente lo que el estado de falla advierte. */}
          {!fallaDeLectura && puedeAsignar && (esBorrador || esConfirmado || enRuta) ? (
            <section className="space-y-2.5 border border-fault-line p-3">
              <Rotulo tono="fault">Zona de consecuencia · todo en la bitácora</Rotulo>

              {/* Se cayó el conductor: la acción existía desde F6 y su único
                  llamador vivía en la pantalla de conductores. El momento en que
                  se necesita es este — mirando la ruta que se quedó sin quien la
                  haga. */}
              {esConfirmado || enRuta ? (
                <div className="space-y-1.5">
                  <p className="text-xs leading-relaxed text-fg-muted">
                    Reparte sus paradas abiertas entre los conductores que siguen en ruta. Las
                    que no encuentren receptor quedan en la bandeja sin conductor.
                  </p>
                  <BotonRedistribuir
                    conductorId={manifiesto.driverId}
                    nombreConductor={nombreConductor}
                    fecha={manifiesto.fechaOperacion}
                    paradasAbiertas={paradasAbiertas}
                  />
                </div>
              ) : null}

              {puedeCrearManifiesto && esBorrador ? (
                <div className="space-y-1.5">
                  <p className="text-xs leading-relaxed text-fg-muted">
                    Cancelar devuelve las paradas a la bandeja sin conductor. Queda con tu
                    nombre y con el motivo que escribas.
                  </p>
                  <BotonCancelarManifiesto
                    manifiestoId={manifiestoId}
                    paradas={pedidosAsignados.length}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          {/* --- Bitácora ------------------------------------------------------ */}
          <section className="space-y-2 border-t border-line pt-4">
            <Rotulo>Bitácora</Rotulo>
            <BloqueTrazabilidad
              hechos={bitacora}
              vacio="Todavía no hay movimientos registrados en este manifiesto."
            />
          </section>
        </aside>
      </div>
    </div>
  );
}

/**
 * Qué decir cuando la ruta no tiene ni una parada.
 * -----------------------------------------------------------------------------
 * El vacío dice **qué ve el conductor**: es la pregunta que llega por teléfono a
 * las 15:50 —«jefe, ¿y mi ruta?»— y hasta hoy no se podía responder desde
 * ninguna pantalla.
 *
 * Y depende del estado, porque «tu ruta todavía no está lista» es lo que ve un
 * conductor con manifiesto EN BORRADOR. Escribir eso bajo un manifiesto
 * completado —que fue el primer intento, y se vio en pantalla— es decirle al
 * coordinador que agregue paradas a una ruta que ya se cerró.
 */
function textoVacioSegunEstado(estado: EstadoManifiesto, nombreConductor: string): string {
  switch (estado) {
    case "borrador":
      return `${nombreConductor} ve «tu ruta todavía no está lista». Agrégale pedidos o cancela el manifiesto para que pueda ir a retirar.`;
    case "confirmado":
    case "en_ruta":
      return `Está confirmado y sin paradas: ${nombreConductor} abre la app y no encuentra nada que entregar. Si le quitaron las paradas, ciérralo para que no le quede una ruta viva.`;
    case "completado":
      return `Se cerró sin ninguna parada. ${nombreConductor} no entregó nada con este manifiesto.`;
    case "cancelado":
      return "Se canceló y sus paradas volvieron a la bandeja. No hay nada que hacer acá.";
  }
}

/** El rótulo en versalitas que encabeza cada región de la columna derecha. */
function Rotulo({
  children,
  tono,
}: {
  children: React.ReactNode;
  tono?: "fault";
}) {
  return (
    <p
      className={`text-[10px] font-medium tracking-[0.12em] uppercase ${
        tono === "fault" ? "text-fault-fg" : "text-fg-muted"
      }`}
    >
      {children}
    </p>
  );
}
