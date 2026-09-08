/**
 * Carga TODO lo que muestra el detalle de un manifiesto, en un solo payload
 * serializable.
 * =============================================================================
 * Vive aparte de `page.tsx` porque lo usan DOS superficies con la misma
 * información: la página de detalle (deep-link) y el panel lateral que se abre
 * al tocar una fila del listado (`vista-previa.tsx`). Un solo cargador para las
 * dos evita que la página y el panel muestren cosas distintas del mismo
 * manifiesto.
 *
 * El payload es plano y serializable a propósito: cruza del servidor al panel
 * (Client Component) tal cual.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { puedeAsignarYReasignarPedidos, puedeGenerarManifiestos } from "@/modules/identidad/capacidades";
import { mapaNombresConductores } from "@/modules/identidad/consultas";
import { traducirEstadoPedido, BADGE_ESTADO_PEDIDO } from "@/lib/ui/traduccion-estados";
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
import { obtenerTrazabilidad } from "@/modules/identidad/trazabilidad";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import type { ParadaVista } from "./panel-ruta";

type HechoTrazabilidad = Awaited<ReturnType<typeof obtenerTrazabilidad>>[number];

export interface DatosDetalleManifiesto {
  manifiestoId: string;
  driverId: string;
  nombreConductor: string;
  estado: EstadoManifiesto;
  nombre: string;
  notas: string | null;
  fechaOperacion: string;
  etiquetaDelDia: string;
  origen: { nombre: string; lat: number; long: number } | null;
  paradas: ParadaVista[];
  bitacora: HechoTrazabilidad[];
  fallaDeLectura: boolean;
  totalPedidos: number;
  paradasAbiertas: number;
  paradasCerradas: number;
  puede: { asignar: boolean; crearManifiesto: boolean };
}

interface PedidoAsignado {
  asignacionId: string;
  pedido: Pedido;
  ordenRuta: number | null;
}

async function cargarManifiesto(
  cliente: SupabaseClient,
  manifiestoId: string,
  tenantId: string,
): Promise<Manifiesto | null> {
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
  cliente: SupabaseClient,
  manifiestoId: string,
  tenantId: string,
): Promise<PedidoAsignado[] | null> {
  const { data, error } = await cliente
    .from("asignaciones_pedido")
    .select(
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
          lat: (p.lat as number | null) ?? null,
          long: (p.long as number | null) ?? null,
          geoEstado: ((p.geo_estado as string | null) ?? "pendiente") as Pedido["geoEstado"],
          geoConfianza: (p.geo_confianza as number | null) ?? null,
          geocodificadoEn: (p.geocodificado_en as string | null) ?? null,
          coberturaEstado: ((p.cobertura_estado as string | null) ?? "pendiente") as Pedido["coberturaEstado"],
        } satisfies Pedido,
      };
    })
    .filter((x): x is PedidoAsignado => x !== null);
}

/**
 * Devuelve el payload completo, o `null` si el manifiesto no existe en el
 * tenant. El resto de las lecturas (paradas, bitácora, tarifas) toleran el
 * fallo, igual que la página original: una consulta caída degrada el payload,
 * no lo tumba.
 */
export async function cargarDetalleManifiesto(
  cliente: SupabaseClient,
  tenantId: string,
  usuario: UsuarioActual,
  manifiestoId: string,
): Promise<DatosDetalleManifiesto | null> {
  const [manifiesto, paradasLeidas, origen] = await Promise.all([
    cargarManifiesto(cliente, manifiestoId, tenantId),
    cargarPedidosAsignados(cliente, manifiestoId, tenantId),
    obtenerOrigenRutaDelCourier(cliente, tenantId).catch(() => null),
  ]);

  if (!manifiesto) return null;

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

  const nombreConductor = await mapaNombresConductores(cliente, tenantId, [manifiesto.driverId])
    .then((m) => m[manifiesto.driverId] ?? manifiesto.driverId)
    .catch(() => manifiesto.driverId);

  const etiquetaDelDia =
    manifiesto.fechaOperacion === hoyEnSantiago()
      ? "hoy"
      : etiquetaFechaCivilCorta(manifiesto.fechaOperacion);

  const ventana = {
    desde: limitesDelDiaSantiago(manifiesto.fechaOperacion).desde,
    hasta: combinarFechaHoraSantiago(sumarDiasCalendario(manifiesto.fechaOperacion, 1), "06:00"),
  };

  const [hechosManifiesto, hechosConductor] = await Promise.all([
    obtenerTrazabilidad(cliente, tenantId, "manifiesto", manifiestoId, { limite: 8 }).catch(() => []),
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

  const paradasAbiertas = pedidosAsignados.filter(
    ({ pedido }) => !ESTADOS_TERMINALES_PEDIDO.includes(pedido.estado),
  ).length;
  const paradasCerradas = pedidosAsignados.length - paradasAbiertas;

  const sinTarifa = await detectarPedidosSinTarifa(
    cliente,
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

  return {
    manifiestoId,
    driverId: manifiesto.driverId,
    nombreConductor,
    estado: manifiesto.estado,
    nombre: manifiesto.nombre,
    notas: manifiesto.notas,
    fechaOperacion: manifiesto.fechaOperacion,
    etiquetaDelDia,
    origen,
    paradas,
    bitacora,
    fallaDeLectura,
    totalPedidos: pedidosAsignados.length,
    paradasAbiertas,
    paradasCerradas,
    puede: {
      asignar: puedeAsignarYReasignarPedidos(usuario),
      crearManifiesto: puedeGenerarManifiestos(usuario),
    },
  };
}
