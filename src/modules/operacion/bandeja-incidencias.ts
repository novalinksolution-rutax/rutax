/**
 * La bandeja de incidencias: lo que el listado plano no traía.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * LA UNIDAD DE DECISIÓN ES EL TIEMPO SIN GESTIONAR, NO EL TIPO
 * -----------------------------------------------------------------------------
 * El tablero B1b agrupa la bandeja por **cuánto lleva sin que nadie la toque**,
 * y no por tipo ni por fecha. La razón es de oficio: al supervisor no le sirve
 * saber que hay cuatro «no estaba en casa» — le sirve saber cuál lleva cinco
 * horas sin que nadie la mire, porque **esa** ya disparó un aviso al centro de
 * avisos y al correo, y es la que el seller va a reclamar.
 *
 * El umbral son 4 h y ya existía (`UMBRAL_INCIDENCIA_SIN_GESTION_HORAS`); lo que
 * no existía era usarlo para ordenar la pantalla.
 *
 * -----------------------------------------------------------------------------
 * LOS CONTADORES CUENTAN SOBRE EL CONJUNTO FILTRADO, NO SOBRE LA PÁGINA
 * -----------------------------------------------------------------------------
 * Los cajones se cuentan aplicando **todos los filtros menos el de estado** —que
 * es justamente lo que el cajón elige—. Si el supervisor filtró por un seller,
 * los cajones dicen cuántas hay de ese seller, no cuántas hay en total ni
 * cuántas alcanzaron a caber en la página. Un contador que cuenta la página es
 * un contador que miente, y acá el contador es la razón de existir de la barra.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import { filaAIncidencia } from "./incidencias";
import type { Incidencia, EstadoIncidencia, TipoIncidencia } from "./tipos";

export interface FiltrosBandeja {
  sellerId?: string;
  tipo?: TipoIncidencia;
  conductorId?: string;
  estado?: EstadoIncidencia;
  /** Ventana de `abierta_en` ya traducida a instantes UTC. */
  desde?: string;
  hasta?: string;
}

/** Lo que la fila necesita y la incidencia no trae. */
export interface ContextoIncidencia {
  /** `RX-7K2M-9PQR` o el envío de Flex. Nunca el UUID. */
  referencia: string;
  /** La comuna del pedido. NO la dirección ni el destinatario. */
  comuna: string | null;
  conductorId: string | null;
  conductorNombre: string | null;
  /**
   * Cuántas fotos de evidencia tiene el pedido.
   *
   * Solo el conteo: el visor con sus URL firmadas ya vive en el detalle del
   * pedido, y duplicarlo acá sería una segunda superficie por la que se
   * reparten enlaces a un bucket privado. El panel dice cuántas hay y lleva
   * allá.
   */
  fotos: number;
}

export interface ConteosBandeja {
  abierta: number;
  en_gestion: number;
  resuelta: number;
  cerrada: number;
  total: number;
}

export interface Bandeja {
  incidencias: Incidencia[];
  contexto: Record<string, ContextoIncidencia>;
  conteos: ConteosBandeja;
}

const ESTADOS: EstadoIncidencia[] = ["abierta", "en_gestion", "resuelta", "cerrada"];

/**
 * Arma la bandeja completa: las incidencias del cajón elegido, el contexto de su
 * pedido, y los conteos de todos los cajones.
 *
 * El filtro por conductor obliga a un orden concreto —primero qué pedidos son de
 * ese conductor, después qué incidencias son de esos pedidos—, porque la
 * incidencia no guarda conductor: lo tiene el pedido, y puede cambiar con una
 * reasignación.
 */
export async function cargarBandejaIncidencias(
  cliente: SupabaseClient,
  tenantId: string,
  filtros: FiltrosBandeja,
): Promise<Bandeja> {
  // 1 · Si se filtra por conductor, primero sus pedidos.
  let pedidosDelConductor: string[] | null = null;
  if (filtros.conductorId) {
    const filas = await leerTodasLasFilas<{ id: string }>(
      "pedidos del conductor",
      (desde, hasta) =>
        cliente
          .schema("operacion")
          .from("pedidos")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("driver_id_asignado", filtros.conductorId)
          .range(desde, hasta),
    );
    pedidosDelConductor = filas.map((f) => f.id);
    // Sin pedidos no hay incidencias posibles: se corta acá en vez de mandar un
    // `.in()` vacío, que en PostgREST no filtra nada y devolvería TODO.
    if (pedidosDelConductor.length === 0) {
      return { incidencias: [], contexto: {}, conteos: vacio() };
    }
  }

  // 2 · Todas las incidencias que pasan los filtros SIN el de estado. De acá
  //     salen los conteos de los cajones y, filtrando por estado, las filas.
  const filas = await leerTodasLasFilas<Record<string, unknown>>(
    "incidencias de la bandeja",
    (desde, hasta) => {
      let q = cliente
        .from("incidencias")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("abierta_en", { ascending: true });
      if (filtros.sellerId) q = q.eq("seller_id", filtros.sellerId);
      if (filtros.tipo) q = q.eq("tipo", filtros.tipo);
      if (pedidosDelConductor) q = q.in("pedido_id", pedidosDelConductor);
      if (filtros.desde) q = q.gte("abierta_en", filtros.desde);
      if (filtros.hasta) q = q.lt("abierta_en", filtros.hasta);
      return q.range(desde, hasta);
    },
  );

  const todas = filas.map(filaAIncidencia);

  const conteos = vacio();
  for (const i of todas) {
    if (i.estado in conteos) conteos[i.estado] += 1;
    conteos.total += 1;
  }

  // 3 · El cajón elegido. Sin cajón, el default operativo: lo que sigue vivo.
  const incidencias = filtros.estado
    ? todas.filter((i) => i.estado === filtros.estado)
    : todas.filter((i) => i.estado === "abierta" || i.estado === "en_gestion");

  return {
    incidencias,
    contexto: await cargarContexto(cliente, tenantId, incidencias),
    conteos,
  };
}

function vacio(): ConteosBandeja {
  return { abierta: 0, en_gestion: 0, resuelta: 0, cerrada: 0, total: 0 };
}

/**
 * Referencia, comuna y conductor de cada pedido citado.
 *
 * ⚠️ Se lee la comuna y **no** la dirección ni el nombre del destinatario. El
 * tablero dibuja «RX-3H8P-5MKL · Ñuñoa» a propósito: la comuna ubica sin
 * exponer a nadie, y es la regla que gobierna todas las superficies donde el
 * pedido se nombra sin abrirlo.
 */
async function cargarContexto(
  cliente: SupabaseClient,
  tenantId: string,
  incidencias: Incidencia[],
): Promise<Record<string, ContextoIncidencia>> {
  const ids = [...new Set(incidencias.map((i) => i.pedidoId))];
  if (ids.length === 0) return {};

  try {
    const pedidos = await leerTodasLasFilas<{
      id: string;
      codigo_interno: string | null;
      ml_shipment_id: string | null;
      destinatario_comuna: string | null;
      driver_id_asignado: string | null;
    }>("pedidos de las incidencias", (desde, hasta) =>
      cliente
        .schema("operacion")
        .from("pedidos")
        .select("id, codigo_interno, ml_shipment_id, destinatario_comuna, driver_id_asignado")
        .eq("tenant_id", tenantId)
        .in("id", ids)
        .range(desde, hasta),
    );

    const evidencias = await leerTodasLasFilas<{ pedido_id: string }>(
      "evidencias de las incidencias",
      (desde, hasta) =>
        cliente
          .schema("operacion")
          .from("evidencias_entrega")
          .select("pedido_id")
          .eq("tenant_id", tenantId)
          .in("pedido_id", ids)
          .range(desde, hasta),
    ).catch(() => [] as { pedido_id: string }[]);

    const fotosPorPedido = new Map<string, number>();
    for (const e of evidencias) {
      fotosPorPedido.set(e.pedido_id, (fotosPorPedido.get(e.pedido_id) ?? 0) + 1);
    }

    const conductorIds = [
      ...new Set(pedidos.map((p) => p.driver_id_asignado).filter((v): v is string => Boolean(v))),
    ];
    const nombrePorConductor = new Map<string, string>();
    if (conductorIds.length > 0) {
      const conductores = await leerTodasLasFilas<{ id: string; nombre_completo: string }>(
        "conductores de las incidencias",
        (desde, hasta) =>
          cliente
            .schema("identidad")
            .from("conductores")
            .select("id, nombre_completo")
            .eq("tenant_id", tenantId)
            .in("id", conductorIds)
            .range(desde, hasta),
      );
      for (const c of conductores) nombrePorConductor.set(c.id, c.nombre_completo);
    }

    return Object.fromEntries(
      pedidos.map((p) => [
        p.id,
        {
          referencia: p.codigo_interno ?? p.ml_shipment_id ?? p.id.slice(0, 8),
          comuna: p.destinatario_comuna,
          conductorId: p.driver_id_asignado,
          conductorNombre: p.driver_id_asignado
            ? (nombrePorConductor.get(p.driver_id_asignado) ?? null)
            : null,
          fotos: fotosPorPedido.get(p.id) ?? 0,
        },
      ]),
    );
  } catch {
    // El contexto es adorno útil, no la bandeja: sin él las filas siguen
    // sirviendo, con la referencia corta del pedido.
    return {};
  }
}

/** Los cajones, en el orden en que el tablero los dibuja. */
export const CAJONES_BANDEJA: ReadonlyArray<{ clave: EstadoIncidencia; etiqueta: string }> = [
  { clave: "abierta", etiqueta: "Abiertas" },
  { clave: "en_gestion", etiqueta: "En gestión" },
  { clave: "resuelta", etiqueta: "Resueltas" },
];

/**
 * `cerrada` va como cajón EXCLUIDO, tras el separador y en tono inerte.
 *
 * No pertenece al conjunto operativo —no está abierta, no se está gestionando y
 * no se acaba de resolver— y sumarla haría que el total de la barra no cuadre
 * con lo que el supervisor está mirando. Es exactamente la figura para la que
 * `BarraCajones` tiene su cajón excluido.
 */
export const CAJON_EXCLUIDO = { clave: "cerrada" as EstadoIncidencia, etiqueta: "Cerradas" };

export { ESTADOS as ESTADOS_INCIDENCIA_BANDEJA };
