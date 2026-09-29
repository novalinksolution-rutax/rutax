/**
 * Resolución de la tarifa de un pedido.
 *
 * Ya NO decide nada: es un envoltorio sobre `identidad.resolver_tarifa_por_comuna`
 * (migración 20260928000002), que es la ÚNICA resolución de tarifa del sistema.
 * Antes vivía aquí una query que filtraba por tenant, régimen, vigencia y seller
 * y NO miraba la zona: con dos tarifas same_day (Zona 1 y Zona 2) ganaba la más
 * reciente para todas las comunas, y el «cobras $X por zona» era una promesa que
 * el motor no cumplía.
 *
 * Por qué importa que TODOS pasen por la misma función:
 * `dinero/jobs/generar-lineas.ts` inserta `tarifa_id` en una columna NOT NULL, así
 * que un pedido sin tarifa no falla al crearse — falla al entregarse, en el job
 * que genera la plata. Si el alta, la pantalla de preparación y el motor
 * resolvieran distinto, el mismo pedido mostraría «con tarifa» y se cobraría otra.
 *
 * Precedencia (la del ORDER BY de la función SQL, no la del texto): seller antes
 * que tenant; fuente antes que régimen legado antes que general; zona antes que
 * sin zona; y entre iguales, vigencia más reciente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverComunaCanonica } from "@/modules/integraciones/geocoding/normalizacion";
import type { FuentePedido, TipoPedido } from "./tipos";

/** Qué regla ganó. Alimenta `snapshot_regla.tarifa.resolucion` de la línea de dinero. */
export interface ResolucionTarifa {
  /** `null` = no hay tarifa aplicable (la fila de la zona sí se devuelve igual). */
  tarifaId: string | null;
  zonaId: string | null;
  /** La comuna no estaba mapeada y se cobró como la zona de respaldo (Q6: «se cobra como Periferia y se avisa»). */
  zonaPorRespaldo: boolean;
  porSeller: boolean;
  porFuente: boolean;
  porRegimen: boolean;
  porZona: boolean;
}

export interface ResolverTarifaEntrada {
  tenantId: string;
  sellerId: string;
  /**
   * Procedencia del pedido (`operacion.pedidos.fuente`). `null`/omitida = solo
   * casan las tarifas SIN fuente (legadas por régimen y generales): una tarifa
   * «solo Shopify» jamás se aplica a un pedido de fuente desconocida.
   */
  fuente?: FuentePedido | null;
  /** Régimen de tarifa (`tipo_pedido`). NO es la fuente: un pedido Shopify tarifica como `same_day`. */
  tipoPedido: TipoPedido;
  /** Comuna YA canónica. `null`/omitida → zona de respaldo si existe. */
  comuna?: string | null;
  /** Fecha 'YYYY-MM-DD' en zona Santiago contra la que se evalúa la vigencia. */
  fecha: string;
}

const TANDA_RESOLUCION = 8;

const RESOLUCION_VACIA: ResolucionTarifa = {
  tarifaId: null,
  zonaId: null,
  zonaPorRespaldo: false,
  porSeller: false,
  porFuente: false,
  porRegimen: false,
  porZona: false,
};

interface FilaResolucion {
  tarifa_id: string | null;
  zona_id: string | null;
  zona_por_respaldo: boolean | null;
  por_seller: boolean | null;
  por_fuente: boolean | null;
  por_regimen: boolean | null;
  por_zona: boolean | null;
}

/**
 * Resuelve la tarifa y devuelve además POR QUÉ (zona, respaldo, ejes que ganaron).
 *
 * Lanza ante un error de la base: el llamador decide qué hace con «no pude
 * preguntar», que es distinto de «no hay tarifa» (`tarifaId: null`).
 */
export async function resolverTarifa(
  cliente: SupabaseClient,
  entrada: ResolverTarifaEntrada,
): Promise<ResolucionTarifa> {
  const { data, error } = await cliente.schema("identidad").rpc("resolver_tarifa_por_comuna", {
    p_tenant: entrada.tenantId,
    p_seller: entrada.sellerId,
    p_fuente: entrada.fuente ?? null,
    p_tipo_pedido: entrada.tipoPedido,
    // La función SQL compara por igualdad exacta contra la forma canónica del
    // catálogo: «Ñuñoa» tal como la digitó el usuario no casaría con «Ñuñoa».
    p_comuna: entrada.comuna ? (resolverComunaCanonica(entrada.comuna) ?? null) : null,
    p_fecha: entrada.fecha,
  });

  if (error) {
    throw new Error(`Error al resolver la tarifa: ${error.message}`);
  }

  // La función devuelve SIEMPRE una fila; un arreglo vacío no debería ocurrir,
  // pero «sin datos» se lee como «sin tarifa», nunca como excepción.
  const fila = (Array.isArray(data) ? data[0] : data) as FilaResolucion | null | undefined;
  if (!fila) return { ...RESOLUCION_VACIA };

  return {
    tarifaId: fila.tarifa_id ?? null,
    zonaId: fila.zona_id ?? null,
    zonaPorRespaldo: fila.zona_por_respaldo === true,
    porSeller: fila.por_seller === true,
    porFuente: fila.por_fuente === true,
    porRegimen: fila.por_regimen === true,
    porZona: fila.por_zona === true,
  };
}

export interface ResolverTarifaVigenteEntrada {
  tenantId: string;
  sellerId: string;
  /** Régimen de tarifa. NO es la fuente del pedido: un pedido Shopify tarifica como `same_day`. */
  tipoEntrega: TipoPedido;
  /** Fecha 'YYYY-MM-DD' en zona Santiago contra la que se evalúa la vigencia. */
  fecha: string;
  /** Ver `ResolverTarifaEntrada.fuente`. */
  fuente?: FuentePedido | null;
  /** Ver `ResolverTarifaEntrada.comuna`. */
  comuna?: string | null;
}

/**
 * Devuelve el id de la tarifa aplicable, o `null` si no hay ninguna.
 *
 * Devuelve `null` en vez de lanzar porque los dos llamadores necesitan cosas
 * distintas: el alta manual rechaza al usuario con un mensaje accionable, y un
 * job de ingesta no puede rechazar nada — tiene que decidir si ingesta igual o
 * salta la fila, y esa decisión no es de este helper.
 *
 * Equivalencia con filas legadas: una tarifa con `tipo_entrega` y sin zona ni
 * fuente se resuelve exactamente como antes (seller antes que tenant, vigencia
 * más reciente). Lo único que cambia es lo que antes se ignoraba: la zona.
 */
export async function resolverTarifaVigente(
  cliente: SupabaseClient,
  entrada: ResolverTarifaVigenteEntrada,
): Promise<string | null> {
  const r = await resolverTarifa(cliente, {
    tenantId: entrada.tenantId,
    sellerId: entrada.sellerId,
    fuente: entrada.fuente,
    tipoPedido: entrada.tipoEntrega,
    comuna: entrada.comuna,
    fecha: entrada.fecha,
  });
  return r.tarifaId;
}

/**
 * Cuáles de estos pedidos se van a entregar sin poder cobrarse.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO SE MIRA `tarifa_aplicable_id`
 * -----------------------------------------------------------------------------
 * Es el campo obvio y da una respuesta falsa. Lo escriben el alta same-day y la
 * ingesta de Shopify; **la ingesta de Mercado Libre no lo escribe nunca**. Si la
 * pantalla marcara «sin tarifa» donde esa columna viene en `null`, en un courier
 * cuya operación es Flex entera se pintarían de reparo las treinta paradas —
 * todas falsas, y la próxima vez nadie miraría el reparo verdadero.
 *
 * Se resuelve la tarifa igual que el motor (`resolver_tarifa_por_comuna`): por
 * seller, fuente, régimen y zona de la comuna, a la fecha de operación. Es la misma pregunta que se hace `detectarSellersSinTarifa` en
 * la pantalla de preparación, y tiene que dar lo mismo en las dos.
 *
 * -----------------------------------------------------------------------------
 * UNA CONSULTA POR SELLER, NO POR PARADA
 * -----------------------------------------------------------------------------
 * Treinta paradas de un manifiesto suelen ser tres o cuatro sellers. Se agrupa
 * por `(seller, régimen, fuente, comuna)` antes de preguntar; si no, son treinta viajes para
 * responder cuatro veces lo mismo.
 *
 * Ante un error de lectura devuelve el conjunto vacío: no marcar un reparo que
 * existe es malo, pero inventar treinta reparos porque se cayó una consulta es
 * peor — y esto se llama desde pantallas que ya se dibujaron.
 */
export async function detectarPedidosSinTarifa(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    /** Fecha 'YYYY-MM-DD' contra la que se evalúa la vigencia. */
    fecha: string;
  },
  pedidos: readonly {
    id: string;
    sellerId: string;
    tipoPedido: TipoPedido;
    /** Con fuente y comuna la respuesta es la del motor; sin ellas solo casan tarifas sin fuente ni zona propia. */
    fuente?: FuentePedido | null;
    comuna?: string | null;
  }[],
): Promise<Set<string>> {
  const claveDe = (p: { sellerId: string; tipoPedido: TipoPedido; fuente?: FuentePedido | null; comuna?: string | null }) =>
    `${p.sellerId}·${p.tipoPedido}·${p.fuente ?? ""}·${p.comuna ?? ""}`;

  const claves = new Map<string, (typeof pedidos)[number]>();
  for (const p of pedidos) claves.set(claveDe(p), p);
  if (claves.size === 0) return new Set();

  // En tandas: la clave ahora incluye la comuna, así que un manifiesto con varios
  // sellers y comunas ya no son 4 consultas sino decenas. Sin tope se abrirían
  // todas a la vez contra PostgREST.
  const resueltas: { clave: string; tarifaId: string | null }[] = [];
  const entradas = [...claves];
  for (let i = 0; i < entradas.length; i += TANDA_RESOLUCION) {
    const tanda = await Promise.all(
      entradas.slice(i, i + TANDA_RESOLUCION).map(async ([clave, p]) => ({
        clave,
        // Ante un error de lectura NO se marca «sin tarifa» (ver arriba).
        tarifaId: await resolverTarifaVigente(cliente, {
          tenantId: entrada.tenantId,
          sellerId: p.sellerId,
          tipoEntrega: p.tipoPedido,
          fuente: p.fuente,
          comuna: p.comuna,
          fecha: entrada.fecha,
        }).catch(() => "error" as string | null),
      })),
    );
    resueltas.push(...tanda);
  }

  const sinTarifa = new Set(resueltas.filter((r) => r.tarifaId === null).map((r) => r.clave));
  if (sinTarifa.size === 0) return new Set();

  return new Set(pedidos.filter((p) => sinTarifa.has(claveDe(p))).map((p) => p.id));
}
