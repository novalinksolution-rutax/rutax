import "server-only";

/**
 * Superficie de lectura de `operacion` PARA TERCEROS (hoy: `conversacion`,
 * la consulta de estado por WhatsApp).
 * =============================================================================
 *
 * Doc de alcance: `docs/arquitectura/conversacion-whatsapp.md` §6/§6.0/§6.2.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTE ARCHIVO Y NO `vista-previa-seller.ts`
 * -----------------------------------------------------------------------------
 * La vista previa del seller ya existe, con la barrera puesta
 * (`pedido.sellerId !== sellerId → null`) y con la doctrina: «lo que el seller
 * no debe ver no se consulta». Este archivo SE ESCRIBE AL LADO, reusando esa
 * barrera y `armarHitosSeller`, pero con un tipo de retorno MÁS POBRE: WhatsApp
 * es un canal que se reenvía, así que acá no hay `destinatario`, no hay
 * `donde.direccion` y no hay nombre de conductor — aunque la fuente de esos
 * datos (`vista-previa-seller.ts`) sí los traiga para el portal.
 *
 * -----------------------------------------------------------------------------
 * REGLAS QUE GOBIERNAN ESTE ARCHIVO (§6)
 * -----------------------------------------------------------------------------
 *  1. El alcance `(tenantId, sellerId)` es obligatorio y va en `entrada`,
 *     DESPUÉS del `cliente` — la convención de `obtenerExpectativaDelDia` y
 *     `listarEsperadosDeSeller`. El job de `conversacion` corre con
 *     `service_role`, así que la RLS NO protege nada acá: el alcance ES la
 *     barrera.
 *  2. El identificador de un pedido es la UNIÓN DISCRIMINADA que ya decidió
 *     `conversacion` (nunca un `string` suelto): con un string, esta función
 *     tendría que adivinar contra qué columna buscar, y ahí reaparece el bug
 *     del eje (`if (tipoPedido === 'flex')`).
 *  3. Devuelve datos ESTRUCTURADOS, nunca texto armado. El texto lo arma
 *     `conversacion`.
 *  4. Devuelve `null` (o listas vacías), NUNCA lanza, cuando no hay match o el
 *     pedido es de otro seller. El llamador no puede distinguir «no existe» de
 *     «no es tuyo» — es intencional (§5: nunca se confirma ni se niega nada
 *     sobre un pedido de un contacto sin consentimiento).
 *  5. Solo lectura. No publica eventos ni escribe bitácora de negocio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { armarHitosSeller, type HitoSeller } from "../vista-previa-seller";
import { obtenerPedido } from "../pedidos";
import { listarEsperadosDeSeller, type BultoEsperado } from "../retiro/expectativa";

// =============================================================================
// 0. El tipo nominal del alcance (§6.3)
// =============================================================================
//
// Vive ACÁ y no en `conversacion` a propósito: la cerca del módulo (§4 del
// documento de alcance) es de una sola vía —`conversacion` puede importar de
// `operacion`, nunca al revés—, así que el tipo que ambos comparten tiene que
// nacer en el lado que `conversacion` SÍ puede importar. `conversacion` hace
// `import type { AlcanceSeller } from ".../consultas/seller"` y re-exporta.
//
// `marca` es un `unique symbol` NO exportado: un objeto `{ tenantId, sellerId }`
// armado a mano en cualquier otro archivo no compila contra este tipo sin un
// cast doble (`as unknown as AlcanceSeller`), que es justo la fricción que
// convierte "hay que resolver la identidad primero" en un error de tipos en
// vez de una convención que se puede olvidar.
declare const marca: unique symbol;

export type AlcanceSeller = {
  readonly tenantId: string;
  readonly sellerId: string;
  readonly [marca]: "resuelto";
};

// =============================================================================
// 1. Estado de un pedido, por código
// =============================================================================

/** La unión discriminada que produce SOLO el envoltorio del parser de `conversacion`. */
export type IdentificadorPedido =
  | { tipo: "ml_shipment_id"; valor: string }
  | { tipo: "ml_order_id"; valor: string }
  | { tipo: "codigo_interno"; valor: string };

export interface EstadoPedidoSeller {
  /** El mismo código visible que ya usa el resto del producto (`ml_shipment_id ?? codigo_interno`). */
  codigo: string;
  estado: string;
  /** El hito más reciente, sin nombrar a nadie — ver `armarHitosSeller`. */
  ultimoHito: HitoSeller | null;
  /** `null` cuando el pedido no está ruteado todavía. Nunca trae hora estimada (§7). */
  parada: { numero: number; de: number } | null;
}

/**
 * El estado de UN pedido del seller, buscado por su código visible.
 *
 * ⚠️ Sin `destinatario`, sin `donde`, sin nombre de conductor y SIN HORA
 * ESTIMADA — decisión del usuario, 2026-09-20 (§7): no existe un reloj por
 * parada que Rutax pueda prometerle al seller, y una hora mal derivada por
 * nosotros hace el mismo daño que una inventada por un modelo.
 */
export async function estadoDePedidoParaSeller(
  cliente: SupabaseClient,
  entrada: AlcanceSeller,
  identificador: IdentificadorPedido,
): Promise<EstadoPedidoSeller | null> {
  // ⚠️ El mapeo va acá, con la unión ya decidida por el parser. Nunca se
  // adivina la columna por el largo del valor dentro de la consulta: eso es el
  // bug del eje otra vez, escondido en un `if`.
  const COLUMNA_POR_TIPO = {
    ml_shipment_id: "ml_shipment_id",
    ml_order_id: "ml_order_id",
    codigo_interno: "codigo_interno",
  } as const;
  const columna = COLUMNA_POR_TIPO[identificador.tipo];

  const { data, error } = await cliente
    .from("pedidos")
    .select("id")
    .eq("tenant_id", entrada.tenantId)
    .eq(columna, identificador.valor)
    .maybeSingle();

  if (error || !data) return null;

  const pedido = await obtenerPedido(cliente, data.id as string, entrada.tenantId).catch(() => null);
  // ⚠️ La barrera de aislamiento (la única que importa acá, ver cabecera §4).
  // Devuelve `null` sea porque el pedido no existe o porque es de otro seller:
  // esa indistinguibilidad es intencional.
  if (!pedido || pedido.sellerId !== entrada.sellerId) return null;

  const [pruebaEn, parada] = await Promise.all([
    leerFechaDePrueba(cliente, entrada.tenantId, pedido.id),
    leerParada(cliente, entrada.tenantId, pedido.id),
  ]);

  const hitos = armarHitosSeller({
    creadoEn: pedido.creadoEn,
    retiradoEn: pedido.retiradoEn ?? null,
    estado: pedido.estado,
    pruebaEn,
    canceladoEn: pedido.canceladoEn ?? null,
  });

  return {
    codigo: pedido.codigoInterno ?? pedido.mlShipmentId ?? "",
    estado: pedido.estado,
    ultimoHito: hitos.length > 0 ? hitos[hitos.length - 1] : null,
    parada,
  };
}

async function leerFechaDePrueba(
  cliente: SupabaseClient,
  tenantId: string,
  pedidoId: string,
): Promise<string | null> {
  try {
    const { data } = await cliente
      .from("pruebas_entrega_seller")
      .select("capturado_en")
      .eq("pedido_id", pedidoId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return (data?.capturado_en as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * `parada N de M` — mismo patrón que `vista-previa.ts` (la vista del COURIER):
 * `N` es `asignaciones_pedido.orden_ruta` de la asignación activa, `M` son las
 * paradas activas del mismo manifiesto. `null` si el pedido no está ruteado.
 */
async function leerParada(
  cliente: SupabaseClient,
  tenantId: string,
  pedidoId: string,
): Promise<{ numero: number; de: number } | null> {
  try {
    const { data } = await cliente
      .schema("operacion")
      .from("asignaciones_pedido")
      .select("manifiesto_id, orden_ruta")
      .eq("tenant_id", tenantId)
      .eq("pedido_id", pedidoId)
      .eq("activa", true)
      .maybeSingle();

    if (!data || data.orden_ruta === null || !data.manifiesto_id) return null;

    const { count } = await cliente
      .schema("operacion")
      .from("asignaciones_pedido")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("manifiesto_id", data.manifiesto_id as string)
      .eq("activa", true);

    if (!count) return null;
    return { numero: data.orden_ruta as number, de: count };
  } catch {
    return null;
  }
}

// =============================================================================
// 2. Retiro del día
// =============================================================================

export interface FaltanteRetiro {
  /** El mismo código visible que produce un escaneo. */
  codigoVisible: string;
}

export interface VisitaRetiroSeller {
  bodegaNombre: string;
  /** La hora de cierre si ya cerró; si sigue abierta, la de apertura. */
  hora: string | null;
  estado: "abierta" | "cerrada";
  cargados: number;
}

export interface RetiroDelDiaSeller {
  visitas: VisitaRetiroSeller[];
  /** El denominador del día — de `listarEsperadosDeSeller`, la única fuente. */
  esperadosHoy: number;
  faltantes: FaltanteRetiro[];
}

/**
 * El retiro del día de un seller: qué visitas hubo a su bodega, cuántos bultos
 * se cargaron y cuáles de sus pedidos esperados **todavía no aparecen**
 * escaneados en ninguna.
 *
 * ⚠️ Reusa `listarEsperadosDeSeller` (§6.2) como denominador — no se duplica el
 * criterio de "qué se espera hoy": si este archivo y la app del conductor
 * contaran distinto, nadie sabría cuál creer.
 *
 * Con el seller equivocado (o sin sesiones), devuelve `visitas: []` **y**
 * `esperadosHoy: 0` — los dos, porque un cero en uno y una cifra en el otro ya
 * filtra volumen (§6.4 punto 5).
 */
export async function retiroDelDiaParaSeller(
  cliente: SupabaseClient,
  entrada: AlcanceSeller,
  fecha: string,
): Promise<RetiroDelDiaSeller> {
  const esperados: BultoEsperado[] = await listarEsperadosDeSeller(cliente, {
    tenantId: entrada.tenantId,
    sellerId: entrada.sellerId,
    fecha,
  }).catch(() => []);

  const { data: sesionesData, error: errorSesiones } = await cliente
    .from("sesiones_retiro")
    .select("id, estado, bodega_id, abierta_en, cerrada_en, bultos_resueltos")
    .eq("tenant_id", entrada.tenantId)
    .eq("seller_id", entrada.sellerId)
    .eq("fecha_operacion", fecha)
    .order("abierta_en", { ascending: false });

  if (errorSesiones || !sesionesData || sesionesData.length === 0) {
    return { visitas: [], esperadosHoy: esperados.length, faltantes: [] };
  }

  const sesiones = sesionesData as Array<{
    id: string;
    estado: "abierta" | "cerrada";
    bodega_id: string;
    abierta_en: string;
    cerrada_en: string | null;
    bultos_resueltos: number | null;
  }>;

  const bodegaIds = [...new Set(sesiones.map((s) => s.bodega_id))];
  const nombresBodega = await resolverNombresBodegas(cliente, entrada.tenantId, bodegaIds);

  const visitas: VisitaRetiroSeller[] = sesiones.map((s) => ({
    bodegaNombre: nombresBodega.get(s.bodega_id) ?? "",
    hora: s.cerrada_en ?? s.abierta_en,
    estado: s.estado,
    cargados: s.bultos_resueltos ?? 0,
  }));

  const pedidoIdsEscaneados = await pedidoIdsEscaneadosHoy(
    cliente,
    entrada.tenantId,
    sesiones.map((s) => s.id),
  );

  const faltantes: FaltanteRetiro[] = esperados
    .filter((e) => !pedidoIdsEscaneados.has(e.pedidoId))
    .map((e) => ({ codigoVisible: e.codigoVisible }));

  return { visitas, esperadosHoy: esperados.length, faltantes };
}

async function resolverNombresBodegas(
  cliente: SupabaseClient,
  tenantId: string,
  bodegaIds: string[],
): Promise<Map<string, string>> {
  if (bodegaIds.length === 0) return new Map();
  try {
    const { data } = await cliente
      .from("seller_bodegas")
      .select("id, nombre")
      .eq("tenant_id", tenantId)
      .in("id", bodegaIds);
    return new Map(((data ?? []) as Array<{ id: string; nombre: string }>).map((b) => [b.id, b.nombre]));
  } catch {
    return new Map();
  }
}

async function pedidoIdsEscaneadosHoy(
  cliente: SupabaseClient,
  tenantId: string,
  sesionIds: string[],
): Promise<Set<string>> {
  if (sesionIds.length === 0) return new Set();
  try {
    const { data } = await cliente
      .from("bultos_retiro")
      .select("pedido_id")
      .eq("tenant_id", tenantId)
      .in("sesion_retiro_id", sesionIds)
      .not("pedido_id", "is", null);
    return new Set(((data ?? []) as Array<{ pedido_id: string | null }>).map((b) => b.pedido_id as string));
  } catch {
    return new Set();
  }
}
