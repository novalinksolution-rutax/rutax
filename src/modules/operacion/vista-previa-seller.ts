import "server-only";

/**
 * La vista previa de un pedido, para el SELLER.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 POR QUÉ NO REUSA `armarVistaPreviaPedido`
 * -----------------------------------------------------------------------------
 * Sería la tentación obvia y **filtraría al conductor**: aquella devuelve
 * `quien.conductorNombre`, su id, el número de parada de la ruta y la bitácora
 * del pedido. Nada de eso es del seller —es la operación interna de su courier—
 * y ninguna de esas piezas se apaga sola por el rol.
 *
 * Reusarla «filtrando en la pantalla» sería peor todavía: los campos igual
 * viajarían al navegador en la carga del panel, donde cualquiera los lee. La
 * regla del proyecto es que lo que el seller no debe ver **no se consulta**.
 *
 * -----------------------------------------------------------------------------
 * QUÉ SÍ VE, Y POR QUÉ CADA COSA
 * -----------------------------------------------------------------------------
 * · **Su código y su destinatario** — con eso busca el pedido cuando su cliente
 *   le escribe.
 * · **El seguimiento sin nombres** — «Retirado», «En camino», «Entregado» con
 *   sus horas. Que lo retiraron le importa; quién, no.
 * · **La prueba de entrega** — es la respuesta a «mi cliente dice que no
 *   llegó». Sale de la vista `pruebas_entrega_seller`, que no expone la ruta de
 *   la foto ni la coordenada; la imagen se sirve aparte por URL firmada.
 * · **Lo que le van a cobrar** y en qué período. Su lado del dinero, nunca el
 *   del conductor.
 * · **Si tiene una incidencia abierta**, que es lo único accionable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { puedeImprimirEtiqueta } from "./etiqueta-disponible";
import { podLoGobiernaLaFuente } from "./fuente";
import { obtenerPedido } from "./pedidos";

export interface HitoSeller {
  texto: string;
  en: string;
}

export interface VistaPreviaSeller {
  id: string;
  codigo: string | null;
  destinatario: string;
  estado: string;
  fuente: string;
  fechaCompromiso: string | null;
  donde: { direccion: string; comuna: string };
  seguimiento: HitoSeller[];
  /** `null` = todavía no hay prueba. */
  prueba: {
    resultado: "entregado" | "fallido";
    capturadoEn: string;
    tieneFoto: boolean;
    tipoIncidencia: string | null;
  } | null;
  dinero: { montoClp: number | null; periodoEtiqueta: string | null } | null;
  incidenciasAbiertas: number;
  /**
   * Solo cuando la fuente NO gobierna el seguimiento. En Flex el comprador ya
   * tiene el de Mercado Libre y este enlace no le sirve a nadie.
   */
  trackingToken: string | null;
  etiquetaDisponible: boolean;
}

export async function armarVistaPreviaSeller(
  cliente: SupabaseClient,
  tenantId: string,
  sellerId: string,
  pedidoId: string,
): Promise<VistaPreviaSeller | null> {
  const pedido = await obtenerPedido(cliente, pedidoId, tenantId).catch(() => null);
  // ⚠️ La barrera de aislamiento: el pedido tiene que ser de ESTE seller. Sin
  // esta línea, un id ajeno devolvería el pedido de otra tienda del mismo
  // courier.
  if (!pedido || pedido.sellerId !== sellerId) return null;

  const [prueba, incidenciasAbiertas, dinero] = await Promise.all([
    leerPrueba(cliente, tenantId, pedidoId),
    contarIncidencias(cliente, tenantId, pedidoId),
    leerCobro(cliente, tenantId, pedidoId),
  ]);

  return {
    id: pedido.id,
    // Nunca el `trackingToken` como identificador visible: ése es público y
    // viaja en la URL que se comparte con el destinatario.
    codigo: pedido.codigoInterno ?? pedido.mlShipmentId ?? null,
    destinatario: pedido.destinatarioNombre,
    estado: pedido.estado,
    fuente: pedido.fuente,
    fechaCompromiso: pedido.fechaCompromiso ?? null,
    donde: {
      direccion: pedido.destinatarioDireccion,
      comuna: pedido.destinatarioComuna,
    },
    seguimiento: armarHitosSeller({
      creadoEn: pedido.creadoEn,
      retiradoEn: pedido.retiradoEn ?? null,
      estado: pedido.estado,
      pruebaEn: prueba?.capturadoEn ?? null,
      canceladoEn: pedido.canceladoEn ?? null,
    }),
    prueba,
    dinero,
    incidenciasAbiertas,
    trackingToken: podLoGobiernaLaFuente(pedido.fuente) ? null : (pedido.trackingToken ?? null),
    etiquetaDisponible: puedeImprimirEtiqueta({
      tipoPedido: pedido.tipoPedido,
      mlShipmentId: pedido.mlShipmentId ?? null,
      estadoMl: pedido.estadoMl ?? null,
      estado: pedido.estado,
    }),
  };
}

/**
 * Los hitos, **construidos solo con instantes que existen**.
 *
 * ⚠️ No se inventa un «Retirado a las 11:40» porque el pedido esté en ruta: sin
 * una marca de tiempo real detrás, el hito no se dibuja. Un seguimiento con un
 * hito plausible pero falso es peor que uno corto — el seller lo usa para
 * responderle a su cliente.
 *
 * ⚠️ Y **ningún hito nombra a nadie**. El del courier dice «Asignado a R.
 * Muñoz»; acá el mismo momento es «Lo tomó tu courier». Que el paquete avanzó
 * le sirve; quién lo lleva es operación interna.
 */
export function armarHitosSeller(d: {
  creadoEn: string;
  retiradoEn: string | null;
  estado: string;
  pruebaEn: string | null;
  canceladoEn: string | null;
}): HitoSeller[] {
  const hitos: HitoSeller[] = [{ texto: "Lo recibimos", en: d.creadoEn }];
  if (d.retiradoEn) hitos.push({ texto: "Retirado de tu bodega", en: d.retiradoEn });
  if (d.pruebaEn) {
    hitos.push({
      texto: d.estado === "entregado" || d.estado === "entregado_manual" ? "Entregado" : "No se pudo entregar",
      en: d.pruebaEn,
    });
  }
  if (d.canceladoEn) hitos.push({ texto: "Cancelado", en: d.canceladoEn });
  return hitos;
}

async function leerPrueba(cliente: SupabaseClient, tenantId: string, pedidoId: string) {
  try {
    // La VISTA, no la tabla: no expone `foto_path`, `lat`, `long` ni
    // `precision_m`. La foto se pide aparte, por URL firmada de 15 minutos.
    const { data } = await cliente
      .from("pruebas_entrega_seller")
      .select("tipo_resultado, capturado_en, tiene_foto, tipo_incidencia")
      .eq("pedido_id", pedidoId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!data) return null;
    return {
      resultado: data.tipo_resultado as "entregado" | "fallido",
      capturadoEn: data.capturado_en as string,
      tieneFoto: Boolean(data.tiene_foto),
      tipoIncidencia: (data.tipo_incidencia as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

async function contarIncidencias(cliente: SupabaseClient, tenantId: string, pedidoId: string) {
  try {
    const { count } = await cliente
      .schema("operacion")
      .from("incidencias")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("pedido_id", pedidoId)
      .in("estado", ["abierta", "en_gestion"]);
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function leerCobro(cliente: SupabaseClient, tenantId: string, pedidoId: string) {
  try {
    // ⚠️ `anulada = false`: una línea anulada existe y **no se cobra**. Mostrar
    // su monto diría que el seller debe una plata que ya nadie le va a pedir.
    const { data } = await cliente
      .schema("dinero")
      .from("lineas_cobro")
      .select("monto_final_clp, periodos_cobro(fecha_inicio, fecha_fin)")
      .eq("tenant_id", tenantId)
      .eq("pedido_id", pedidoId)
      .eq("anulada", false)
      .maybeSingle();
    if (!data) return null;
    const fila = data as unknown as {
      monto_final_clp: number | null;
      periodos_cobro?: { fecha_inicio?: string; fecha_fin?: string } | null;
    };
    const p = fila.periodos_cobro;
    return {
      montoClp: fila.monto_final_clp,
      periodoEtiqueta:
        p?.fecha_inicio && p?.fecha_fin ? `${p.fecha_inicio} – ${p.fecha_fin}` : null,
    };
  } catch {
    return null;
  }
}
