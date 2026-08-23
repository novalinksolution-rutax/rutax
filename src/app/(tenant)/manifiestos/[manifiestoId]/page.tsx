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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { Manifiesto, EstadoManifiesto, Pedido, EstadoPedido } from "@/modules/operacion/tipos";
import { ordenarParadasConSecuencia } from "@/modules/operacion/orden-paradas";
import { obtenerOrigenRutaDelCourier } from "@/modules/operacion/ruta-manifiesto";
import { ESTADOS_TERMINALES_PEDIDO } from "@/modules/operacion/metricas";
import { BotonConfirmarManifiesto } from "./boton-confirmar-manifiesto";
import { BotonCancelarManifiesto } from "./boton-cancelar-manifiesto";
import { BotonCompletarManifiesto } from "./boton-completar-manifiesto";
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

async function cargarPedidosAsignados(
  manifiestoId: string,
  tenantId: string,
): Promise<PedidoAsignado[]> {
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

  if (error || !data) return [];

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

  const [manifiesto, pedidosAsignadosSinOrden, origenRuta] = await Promise.all([
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

  const puedeAsignar = puedeAsignarYReasignarPedidos(sesion.usuario);
  const puedeCrearManifiesto = puedeGenerarManifiestos(sesion.usuario);
  const esBorrador = manifiesto.estado === "borrador";
  const esConfirmado = manifiesto.estado === "confirmado";
  const hayPedidos = pedidosAsignados.length > 0;

  // Rutear NO se limita al borrador, a propósito: reordenar a media tarde —
  // porque una calle se cortó o porque el motor mandó al conductor a cruzar el
  // Mapocho dos veces — es el caso de uso, no la excepción. El único límite es
  // el que impone la propia función SQL: un manifiesto `completado` o
  // `cancelado` no se rutea, porque sería reescribir historia.
  const manifiestoCerrado =
    manifiesto.estado === "completado" || manifiesto.estado === "cancelado";
  const puedeRutear = puedeAsignar && !manifiestoCerrado;

  // Paradas que NO llegaron a un estado final. Es lo que el diálogo de cierre
  // le advierte al coordinador: cerrar el manifiesto NO las entrega, y seguirán
  // apareciendo para asignar hasta que alguien les dé estado.
  const paradasAbiertas = pedidosAsignados.filter(
    ({ pedido }) => !ESTADOS_TERMINALES_PEDIDO.includes(pedido.estado),
  ).length;

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
  }));

  return (
    <div className="space-y-6">
      {/* Volver */}
      <Retorno href={destinoRetorno("/manifiestos", volver)} etiqueta="Volver a manifiestos" />

      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{manifiesto.nombre}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conductor: <span className="font-medium text-foreground">{nombreConductor}</span>
            {" — "}
            Fecha: <span className="font-medium text-foreground">{manifiesto.fechaOperacion}</span>
          </p>
          {manifiesto.notas && (
            <p className="mt-1 text-sm text-muted-foreground italic">{manifiesto.notas}</p>
          )}
        </div>
        <Badge
          variant={BADGE_ESTADO_MANIFIESTO[manifiesto.estado]}
          className="px-3 py-1 text-sm"
          aria-label={`Estado: ${traducirEstadoManifiesto(manifiesto.estado)}`}
        >
          {traducirEstadoManifiesto(manifiesto.estado)}
        </Badge>
      </div>

      {/* Paradas + ruta. El panel es un componente de cliente porque el
          reordenamiento manual vive en el navegador: mover una parada recalcula
          los tramos en el acto y solo se va al servidor al guardar, con la
          secuencia completa. */}
      {hayPedidos ? (
        <div className="space-y-3">
          {esBorrador && puedeAsignar && (
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <Link href={`/preparacion/asignar?conductor=${manifiesto.driverId}`}>
                  <Plus className="size-4" aria-hidden="true" />
                  Agregar pedidos
                </Link>
              </Button>
            </div>
          )}
          <PanelRuta
            manifiestoId={manifiestoId}
            paradas={paradas}
            origen={origenRuta}
            puedeRutear={puedeRutear}
            puedeQuitar={esBorrador && puedeAsignar}
          />
        </div>
      ) : (
        <EmptyState
          icon={Package}
          titulo="Este manifiesto no tiene pedidos todavía"
          descripcion="Agrega pedidos pendientes para armar la ruta del conductor."
          accion={
            esBorrador && puedeAsignar ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/preparacion/asignar?conductor=${manifiesto.driverId}`}>Agregar pedidos</Link>
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Acciones según estado */}
      {(esBorrador && (puedeAsignar || puedeCrearManifiesto)) && (
        <section aria-labelledby="acciones-titulo" className="flex flex-wrap gap-3">
          <h2 id="acciones-titulo" className="sr-only">Acciones del manifiesto</h2>

          {puedeAsignar && (
            <Link
              href={`/preparacion/asignar?conductor=${manifiesto.driverId}`}
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              <Plus className="size-4" aria-hidden="true" />
              Agregar pedidos
            </Link>
          )}

          {puedeAsignar && (
            <BotonConfirmarManifiesto
              manifiestoId={manifiestoId}
              nombreConductor={nombreConductor}
              totalPedidos={pedidosAsignados.length}
              habilitado={hayPedidos}
            />
          )}

          {puedeCrearManifiesto && (
            <BotonCancelarManifiesto
              manifiestoId={manifiestoId}
            />
          )}
        </section>
      )}

      {esConfirmado && (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Manifiesto confirmado.{" "}
          <Link
            href={`/conductor/manifiesto`}
            className="font-medium text-foreground hover:underline"
          >
            Ver como lo ve el conductor
          </Link>
        </div>
      )}

      {/* Cerrar una ruta que quedó abierta. El conductor solo puede cerrar la de
          HOY —su app resuelve el manifiesto vigente por `fecha_operacion`—, así
          que un manifiesto de ayer todavía `en_ruta` no lo podía cerrar nadie:
          él ya no lo ve y el coordinador no tenía botón. La Server Action
          `actionCompletarManifiesto` existía desde antes, sin un solo llamador. */}
      {manifiesto.estado === "en_ruta" && puedeAsignar && (
        <section aria-labelledby="cerrar-titulo" className="space-y-2">
          <h2 id="cerrar-titulo" className="sr-only">
            Cerrar el manifiesto
          </h2>
          <BotonCompletarManifiesto
            manifiestoId={manifiestoId}
            driverId={manifiesto.driverId}
            nombreConductor={nombreConductor}
            paradasAbiertas={paradasAbiertas}
          />
        </section>
      )}
    </div>
  );
}
