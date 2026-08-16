/**
 * Ingesta de pedidos desde Shopify — LA pieza reutilizable.
 * =============================================================================
 * Mismo papel que `../ml/ingesta-pedidos.ts` para Flex: una sola implementación
 * que comparten el cron de respaldo y el botón «Sincronizar ahora». Si se
 * duplicara, el próximo bug se arreglaría en un sitio y no en el otro — que es
 * exactamente lo que le pasó a la ingesta de ML (cinco bugs en fila).
 *
 * ---------------------------------------------------------------------------
 * CONTRATO CON LA ADMIN API DE SHOPIFY (verificado 2026-08-16 contra la doc
 * oficial: shopify.dev/docs/api/admin-graphql/latest — queries/orders,
 * objects/Order, enums/OrderSortKeys, queries/nodes, usage/access-scopes)
 * ---------------------------------------------------------------------------
 * 1. `orders` admite `first`, `after`, `query`, `sortKey`, `reverse` y
 *    `savedSearchId`. El default de `sortKey` es **PROCESSED_AT**, no
 *    CREATED_AT: por eso se pide CREATED_AT explícitamente — el cursor de la
 *    ingesta se mueve por `created_at` y ordenar por otra cosa lo volvería
 *    incoherente. `CREATED_AT` está confirmado en `OrderSortKeys`.
 * 2. El `query` usa la sintaxis de búsqueda de Shopify. Los dos filtros que
 *    usamos existen y están documentados: `created_at` (comparadores `>=`/`<=`)
 *    y `fulfillment_status`, cuyos valores admitidos incluyen `unfulfilled`.
 * 3. Los campos que pedimos existen en `Order` y NINGUNO está deprecado:
 *    `id: ID!`, `name: String!`, `createdAt: DateTime!`, `cancelledAt: DateTime`,
 *    `displayFulfillmentStatus: OrderDisplayFulfillmentStatus!`,
 *    `tags: [String!]!`, `note: String`, `phone: String`,
 *    `shippingAddress: MailingAddress`.
 * 4. `read_orders` alcanza **solo los últimos 60 días** de órdenes de la tienda
 *    («the last 60 days' worth of orders for a store»); `read_all_orders` sería
 *    necesario para ir más atrás. Es irrelevante aquí: la ventana máxima de esta
 *    ingesta son 7 días.
 * 5. `nodes(ids: [ID!]!)` devuelve objetos por id — es lo que usa el repaso para
 *    preguntar por pedidos que ya tenemos. La doc no publica un máximo de ids,
 *    así que se trocea de a 50, igual que el tamaño de página.
 * 6. Límite de tasa, 200-con-`errors` y validación del dominio: los resuelve
 *    `./cliente-http.ts`. Aquí no se construye una sola petición a mano.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTE ADAPTADOR HACE COSAS QUE EL DE ML NO HACE
 * ---------------------------------------------------------------------------
 * Un pedido Flex nace bajo el régimen de Mercado Envíos: la etiqueta la imprime
 * ML, el POD lo gobierna su app y el cobro se cuelga de la entrega que ML
 * reporta. Un pedido Shopify nace bajo el régimen de Rutax — `tipo_pedido =
 * 'same_day'`, `fuente = 'shopify'` — y por lo tanto necesita, desde el minuto
 * cero, TRES cosas que Flex no:
 *
 *   · `tarifa_aplicable_id`. `dinero/jobs/generar-lineas.ts:723` inserta
 *     `tarifa_id` en una columna NOT NULL. Un pedido sin tarifa no falla al
 *     crearse: falla al ENTREGARSE, tumbando el job que genera la plata. Por eso
 *     un pedido sin tarifa vigente NO se ingesta.
 *   · `codigo_interno`. Shopify no da etiqueta; la imprime Rutax con su QR.
 *   · `tracking_token`. Es la URL pública que después se le devuelve a la tienda.
 *
 * Y una que Flex tampoco necesita: **filtro de cobertura**. Una tienda Shopify
 * vende a todo Chile y solo una parte va por este courier, así que la comuna que
 * no cae en ninguna zona del tenant no entra.
 *
 * SEGURIDAD (no negociable):
 * - El Admin API token viaja por parámetro, nunca a una variable de vida larga,
 *   nunca a un log, nunca a un payload de evento.
 * - De la orden NUNCA se loguea un valor: trae nombre, dirección y teléfono del
 *   comprador. Solo viajan al log el id de la orden (GID) y contadores.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest/cliente";
import { ahoraEnSantiago } from "@/lib/fecha-santiago";
import { resolverZona } from "@/modules/operacion/zonas";
import { resolverTarifaVigente } from "@/modules/operacion/tarifas";
import { evaluarVentanaCorte, type EvaluacionCorte } from "@/modules/operacion/ventanas-corte";
import { generarCodigoInterno } from "@/modules/operacion/codigo-interno";
import { normalizarDireccion } from "../geocoding/normalizacion";
import { peticionShopify } from "./cliente-http";
import { interpretarOrden, type DatosPedidoShopify, type MotivoDescarte } from "./interpretacion";
import type { OrdenShopify, PaginaOrdenes, ResumenIngestaShopify } from "./tipos";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Cliente Supabase **service_role**. Se tipa laxo: el esquema no está generado. */
export type ClienteSupabase = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Logger mínimo — el de Inngest lo cumple; en tests se pasa un doble. */
export interface LoggerIngesta {
  info: (mensaje: string) => void;
  warn: (mensaje: string) => void;
  error: (mensaje: string) => void;
}

const SIN_LOGGER: LoggerIngesta = { info: () => {}, warn: () => {}, error: () => {} };

// =============================================================================
// Constantes del contrato
// =============================================================================

/**
 * Órdenes por página. 50 es el tamaño que pide la tarea y encaja holgado en el
 * balde de puntos: el costo de una consulta crece con los objetos devueltos, y
 * 50 órdenes con una dirección anidada quedan muy por debajo del balde estándar.
 */
export const PAGE_SIZE_ORDENES = 50;

/**
 * Ids por llamada de `nodes(ids:)` en el repaso. La doc no publica un máximo, así
 * que se elige el mismo 50 de la paginación en vez de inventar un número mayor.
 */
export const TAMANO_LOTE_REPASO = 50;

/** Máximo de intentos al generar `codigo_interno` ante colisión (23505). */
export const MAX_INTENTOS_CODIGO_INTERNO = 5;

/**
 * Consulta de órdenes. Pide EXACTAMENTE los campos que declara `OrdenShopify` —
 * ni uno más.
 *
 * No es prolijidad: cada campo de `Order` que se pide suma al costo de la
 * consulta contra el balde de puntos, y `shippingAddress`/`phone` son datos
 * personales del comprador (Shopify los clasifica como *protected customer
 * data*). Pedir un campo «por si acaso» es pagarlo dos veces, en cuota y en
 * exposición.
 *
 * `sortKey: CREATED_AT` es OBLIGATORIO aquí aunque parezca cosmético: el default
 * de la API es `PROCESSED_AT`, y el cursor de esta ingesta se mueve por
 * `created_at`. Ordenar por una fecha y avanzar el cursor por otra deja huecos.
 */
export const CONSULTA_ORDENES = `
  query RutaxIngestaOrdenes($cursor: String, $filtro: String) {
    orders(first: ${PAGE_SIZE_ORDENES}, after: $cursor, query: $filtro, sortKey: CREATED_AT) {
      nodes {
        id
        name
        createdAt
        cancelledAt
        displayFulfillmentStatus
        tags
        note
        phone
        shippingAddress {
          name
          firstName
          lastName
          address1
          address2
          city
          province
          zip
          phone
          latitude
          longitude
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Consulta del REPASO: por id, y solo lo justo para detectar una cancelación.
 *
 * No pide dirección ni teléfono a propósito. El repaso responde una única
 * pregunta —«¿esto sigue vivo en la tienda?»— y no hay razón para volver a traer
 * datos personales del comprador cada 15 minutos para contestarla.
 */
export const CONSULTA_ORDENES_POR_ID = `
  query RutaxRepasoOrdenes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        id
        name
        cancelledAt
        displayFulfillmentStatus
      }
    }
  }
`;

// =============================================================================
// Filtro de búsqueda
// =============================================================================

/**
 * Construye el `query` de la búsqueda de órdenes.
 *
 * Dos términos, los dos documentados:
 *  - `created_at` acotado por los dos extremos. El extremo SUPERIOR importa
 *    tanto como el inferior: el cursor se guarda como «tenemos los pedidos hasta
 *    T», y sin techo entrarían órdenes posteriores a T que el cursor daría por
 *    cubiertas sin estarlo.
 *  - `fulfillment_status:unfulfilled` — lo que ya despachó otro no es del
 *    courier.
 *
 * ⚠️ Consecuencia asumida de ese segundo filtro: una orden `partially_fulfilled`
 * NO aparece, aunque `interpretarOrden` sí la aceptaría (deja fuera solo
 * FULFILLED y RESTOCKED). Es deliberado para la v1 — un despacho parcial exige
 * decidir qué bultos son del courier, y eso todavía no está modelado.
 *
 * Los valores van entre comillas simples porque llevan `:` (el separador de la
 * propia sintaxis de búsqueda).
 */
export function construirFiltroOrdenes(desde: Date, hasta: Date): string {
  return (
    `created_at:>='${desde.toISOString()}' AND ` +
    `created_at:<='${hasta.toISOString()}' AND ` +
    `fulfillment_status:unfulfilled`
  );
}

// =============================================================================
// Lectura contra la API
// =============================================================================

interface RespuestaOrdenes {
  orders: {
    nodes: OrdenShopify[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/** Una página de órdenes. Los reintentos y el throttling los pone `peticionShopify`. */
export async function obtenerPaginaOrdenes(entrada: {
  shopDomain: string;
  accessToken: string;
  filtro: string;
  cursor: string | null;
}): Promise<PaginaOrdenes> {
  const data = await peticionShopify<RespuestaOrdenes>({
    shopDomain: entrada.shopDomain,
    accessToken: entrada.accessToken,
    consulta: CONSULTA_ORDENES,
    variables: { cursor: entrada.cursor, filtro: entrada.filtro },
  });

  return {
    nodes: data.orders?.nodes ?? [],
    hasNextPage: data.orders?.pageInfo?.hasNextPage ?? false,
    endCursor: data.orders?.pageInfo?.endCursor ?? null,
  };
}

/** Estado en la tienda de una orden que Rutax ya tiene — lo que consume el repaso. */
export interface EstadoOrdenEnTienda {
  idExterno: string;
  referenciaExterna: string | null;
  canceladaEn: string | null;
  estadoCumplimiento: string | null;
}

/**
 * Consulta un lote de órdenes POR ID. Trocea en `TAMANO_LOTE_REPASO` y devuelve
 * un mapa por `id`.
 *
 * `nodes` devuelve `null` en la posición de un id que no existe o que no es
 * accesible; esas posiciones se descartan en silencio — la ausencia de una orden
 * NO se interpreta como cancelación, por la misma razón que en ML un 404 no
 * prueba una cancelación (ver `../ml/jobs/ingesta-pedidos-ml.ts`). Un permiso
 * revocado o un borrado en la tienda tienen la misma forma que un error
 * transitorio, y adivinar significaría cancelar pedidos vivos.
 */
export async function consultarOrdenesPorId(entrada: {
  shopDomain: string;
  accessToken: string;
  ids: readonly string[];
}): Promise<Map<string, EstadoOrdenEnTienda>> {
  const salida = new Map<string, EstadoOrdenEnTienda>();

  for (let i = 0; i < entrada.ids.length; i += TAMANO_LOTE_REPASO) {
    const lote = entrada.ids.slice(i, i + TAMANO_LOTE_REPASO);
    const data = await peticionShopify<{
      nodes: Array<{
        id?: string;
        name?: string | null;
        cancelledAt?: string | null;
        displayFulfillmentStatus?: string | null;
      } | null>;
    }>({
      shopDomain: entrada.shopDomain,
      accessToken: entrada.accessToken,
      consulta: CONSULTA_ORDENES_POR_ID,
      variables: { ids: lote },
    });

    for (const nodo of data.nodes ?? []) {
      if (!nodo?.id) continue;
      salida.set(nodo.id, {
        idExterno: nodo.id,
        referenciaExterna: nodo.name ?? null,
        canceladaEn: nodo.cancelledAt ?? null,
        estadoCumplimiento: nodo.displayFulfillmentStatus ?? null,
      });
    }
  }

  return salida;
}

// =============================================================================
// Contexto y resúmenes
// =============================================================================

/** De qué conexión/seller/tenant se está ingiriendo. */
export interface ContextoIngestaShopify {
  tenantId: string;
  sellerId: string;
  /** Fila de `identidad.conexiones_seller_shopify`. Solo para el log — nunca en BD. */
  conexionId: string;
  shopDomain: string;
  /** Tag con el que el seller acota qué manda al courier. `null` = todo entra. */
  filtroEtiqueta: string | null;
}

/**
 * `ResumenIngestaShopify` + el desglose de por qué se descartó cada orden.
 *
 * Sigue siendo un `ResumenIngestaShopify` (lo extiende), así que el contrato que
 * declara `./tipos.ts` se cumple tal cual. El desglose se agrega porque
 * `totalOmitidos` mete en la misma bolsa «fuera de cobertura» y «no lleva el
 * tag», y en el primer día real de una tienda eso es justo lo que hay que poder
 * distinguir sin abrir la base.
 */
export interface ResumenIngestaShopifyDetallado extends ResumenIngestaShopify {
  /** Cuántas órdenes descartó `interpretarOrden`, por motivo. */
  motivos: Record<MotivoDescarte, number>;
  /** Comuna reconocida pero sin zona del tenant, o comuna fuera del catálogo. */
  totalFueraDeCobertura: number;
  /** Errores al escribir en `operacion.pedidos`. No tumban la corrida. */
  erroresPersistencia: number;
  primerErrorPersistencia: string | null;
  /** Páginas de `/orders` recorridas. Sirve para ver si se topó el corte. */
  paginasRecorridas: number;
  /** `true` si se cortó por tope de páginas: quedaron órdenes sin mirar. */
  cortadoPorTopeDePaginas: boolean;
}

export function resumenVacio(): ResumenIngestaShopifyDetallado {
  return {
    totalLeidos: 0,
    totalInsertados: 0,
    totalActualizados: 0,
    totalOmitidos: 0,
    totalSinDireccion: 0,
    totalSinTarifa: 0,
    totalCancelados: 0,
    motivos: {
      cancelada_en_tienda: 0,
      ya_cumplida: 0,
      despacho_parcial: 0,
      sin_direccion: 0,
      sin_etiqueta_requerida: 0,
    },
    totalFueraDeCobertura: 0,
    erroresPersistencia: 0,
    primerErrorPersistencia: null,
    paginasRecorridas: 0,
    cortadoPorTopeDePaginas: false,
  };
}

// =============================================================================
// Resolutor de alta — memoizado por corrida
// =============================================================================

/**
 * Resuelve tarifa, zona y ventana de corte **una sola vez** por corrida.
 *
 * Sin esto, una tienda con 300 órdenes en la ventana dispararía 900 consultas
 * por barrido, cada 15 minutos, para releer tres valores que no cambian dentro
 * de la corrida:
 *  - la tarifa depende de (tenant, seller, régimen, fecha) → constante;
 *  - la zona depende de la comuna → hay ~50 comunas, no 300;
 *  - la ventana de corte depende de la zona y del reloj, que se congela al
 *    empezar la corrida (ver `ahora`).
 *
 * Congelar el reloj es deliberado y además es lo correcto: `corte_riesgo` y
 * `fecha_compromiso_hora` describen el momento en que el pedido ENTRÓ, y sería
 * absurdo que la orden nº 1 y la nº 300 del mismo barrido quedaran a distinto
 * lado del corte por los segundos que tardó el bucle.
 */
export function crearResolutorAlta(
  cliente: ClienteSupabase,
  ctx: ContextoIngestaShopify,
  ahora: { fecha: string; hora: string },
) {
  const zonasPorComuna = new Map<string, string | null>();
  const cortesPorZona = new Map<string, EvaluacionCorte>();
  let tarifaResuelta = false;
  let tarifaId: string | null = null;

  return {
    /** Id de la tarifa `same_day` vigente hoy, o `null` si el seller no tiene. */
    async tarifa(): Promise<string | null> {
      if (!tarifaResuelta) {
        tarifaId = await resolverTarifaVigente(cliente, {
          tenantId: ctx.tenantId,
          sellerId: ctx.sellerId,
          // El RÉGIMEN, no la fuente: un pedido Shopify tarifica como same-day.
          tipoEntrega: "same_day",
          fecha: ahora.fecha,
        });
        tarifaResuelta = true;
      }
      return tarifaId;
    },

    /** Zona del tenant para una comuna YA canónica, o `null` si no hay ninguna. */
    async zona(comunaCanonica: string): Promise<string | null> {
      if (!zonasPorComuna.has(comunaCanonica)) {
        zonasPorComuna.set(
          comunaCanonica,
          await resolverZona(cliente, ctx.tenantId, comunaCanonica),
        );
      }
      return zonasPorComuna.get(comunaCanonica) ?? null;
    },

    /** Evaluación del corte para una zona (misma que usa el alta manual same-day). */
    async corte(zonaId: string | null): Promise<EvaluacionCorte> {
      const clave = zonaId ?? "__sin_zona__";
      const cacheado = cortesPorZona.get(clave);
      if (cacheado) return cacheado;

      const evaluacion = await evaluarVentanaCorte(cliente, {
        tenantId: ctx.tenantId,
        sellerId: ctx.sellerId,
        zonaId,
        tipoEntrega: "same_day",
        ahora,
      });
      cortesPorZona.set(clave, evaluacion);
      return evaluacion;
    },
  };
}

export type ResolutorAlta = ReturnType<typeof crearResolutorAlta>;

// =============================================================================
// Persistencia — SELECT → INSERT | UPDATE explícito. NUNCA un upsert.
// =============================================================================

/** Fila mínima que se lee antes de decidir INSERT vs UPDATE. */
interface FilaPedidoExistente {
  id: string;
  geo_estado: string | null;
  destinatario_direccion?: string | null;
  destinatario_comuna?: string | null;
}

export type ResultadoGuardado =
  | { estado: "insertado"; pedidoId: string }
  | { estado: "actualizado"; pedidoId: string }
  | { estado: "error"; mensaje: string };

/** Lo que hace falta para dar de alta (no para actualizar). */
export interface DatosAltaShopify {
  tarifaAplicableId: string;
  corte: EvaluacionCorte;
  /** Fecha civil de Santiago que va a `fecha_compromiso`. */
  fechaCompromiso: string;
}

/**
 * Compara dos textos de dirección/comuna como los compararía una persona.
 * Reusa la MISMA normalización que calcula la clave del caché de geocoding: si
 * dos textos son iguales para el caché, tienen que serlo también aquí — de lo
 * contrario un reformateo del comprador dispararía una llamada facturable.
 */
function mismoDestino(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizarDireccion(a ?? "") === normalizarDireccion(b ?? "");
}

/**
 * Publica el gatillo de geocodificación. Best-effort: un fallo de Inngest NO
 * puede romper la ingesta — el pedido ya está guardado.
 *
 * ⚠️ Este evento es el ÚNICO camino a la coordenada y, además, el único que
 * calcula `cobertura_estado`: no hay cron que barra los `pendiente` (verificado
 * en `api/inngest/route.ts`). Si el envío falla, el pedido se queda sin ubicar
 * hasta que alguien aprieta «Reubicar» en `/operaciones`.
 *
 * Se publica SIEMPRE tras un alta, incluso cuando Shopify ya trajo coordenada:
 * el job es no-op si `geo_estado != 'pendiente'`, y publicarlo igual es lo que
 * mantiene un solo camino. El payload NO lleva nombre ni teléfono
 * (minimización, ver `EventoPedidoIngestado`).
 */
async function publicarGeocodificacionPedido(
  pedidoId: string,
  ctx: ContextoIngestaShopify,
  direccion: string,
  comuna: string,
  idEvento?: string,
): Promise<void> {
  try {
    await inngest.send({
      name: "operacion/pedido.ingestado",
      ...(idEvento ? { id: idEvento } : {}),
      data: {
        pedidoId,
        tenantId: ctx.tenantId,
        sellerId: ctx.sellerId,
        direccion,
        comuna,
        // RÉGIMEN (y clave de tarifa). La procedencia va aparte, en `fuente`.
        tipoPedido: "same_day" as const,
        fuente: "shopify" as const,
      },
    });
  } catch {
    // Silencio deliberado (ver arriba).
  }
}

/**
 * Persiste UN pedido Shopify: INSERT si es nuevo, UPDATE acotado si ya existe.
 *
 * ⚠️ **POR QUÉ NO ES UN `upsert`.** `upsert(..., { onConflict })` escribe TODAS
 * las columnas del payload también en el UPDATE. Es literalmente el bug que
 * mordió a la ingesta de ML (`../ml/ingesta-pedidos.ts:793`): mandaba
 * `estado: 'pendiente_asignacion'` en cada pasada, y bastaba con que la ventana
 * volviera a cubrir un pedido ya `asignado`/`en_ruta` para devolverlo a la
 * bandeja sin asignar. Con un barrido cada 15 minutos eso sería resetear la
 * operación del día. Regla: en un upsert de PostgREST, toda columna del payload
 * es también una escritura en el UPDATE.
 *
 * En el UPDATE solo viaja lo que Shopify POSEE: los datos del destinatario y la
 * referencia visible. NUNCA `estado`, `fuente`, `origen`, `corte_riesgo`,
 * `tarifa_aplicable_id`, `codigo_interno` ni `tracking_token` — esos cuatro
 * últimos son decisiones de Rutax tomadas al nacer el pedido, y reescribirlos
 * cambiaría la etiqueta impresa, el enlace público que ya se compartió o el
 * precio de una entrega ya hecha.
 *
 * Idempotencia: llave `(tenant_id, fuente='shopify', id_externo)`, respaldada
 * por el índice único parcial `pedidos_fuente_id_externo_uk` (migración
 * 20260816000004).
 */
export async function guardarPedidoShopify(
  supabase: ClienteSupabase,
  ctx: ContextoIngestaShopify,
  datos: DatosPedidoShopify,
  alta: DatosAltaShopify,
): Promise<ResultadoGuardado> {
  const existente = await leerPedidoPorIdExterno(supabase, ctx, datos.idExterno);
  if (existente.error) return { estado: "error", mensaje: existente.error };

  if (existente.fila) {
    return actualizarPedidoShopify(supabase, ctx, existente.fila, datos);
  }

  return insertarPedidoShopify(supabase, ctx, datos, alta);
}

async function leerPedidoPorIdExterno(
  supabase: ClienteSupabase,
  ctx: ContextoIngestaShopify,
  idExterno: string,
): Promise<{ fila: FilaPedidoExistente | null; error?: string }> {
  const { data, error } = await supabase
    .schema("operacion")
    .from("pedidos")
    .select("id, geo_estado, destinatario_direccion, destinatario_comuna")
    .eq("tenant_id", ctx.tenantId)
    .eq("fuente", "shopify")
    .eq("id_externo", idExterno)
    .maybeSingle();

  if (error) return { fila: null, error: error.message };
  return { fila: (data as FilaPedidoExistente | null) ?? null };
}

async function insertarPedidoShopify(
  supabase: ClienteSupabase,
  ctx: ContextoIngestaShopify,
  datos: DatosPedidoShopify,
  alta: DatosAltaShopify,
): Promise<ResultadoGuardado> {
  const ahoraIso = new Date().toISOString();

  const base: Record<string, unknown> = {
    tenant_id: ctx.tenantId,
    seller_id: ctx.sellerId,
    // RÉGIMEN operativo y clave de tarifa. La procedencia es `fuente`.
    tipo_pedido: "same_day",
    fuente: "shopify",
    // Telemetría del modo de descubrimiento (enum `operacion.origen_pedido`).
    // No se compara en ninguna rama de negocio — ver 20260816000003.
    origen: "shopify_ingesta",
    id_externo: datos.idExterno,
    referencia_externa: datos.referenciaExterna,
    destinatario_nombre: datos.destinatarioNombre,
    destinatario_direccion: datos.destinatarioDireccion,
    destinatario_comuna: datos.destinatarioComuna,
    destinatario_telefono: datos.destinatarioTelefono,
    instrucciones_entrega: datos.instruccionesEntrega,
    // Shopify NO trae fecha de entrega comprometida: se usa la fecha de ingesta
    // en Santiago. Es la columna por la que `/operaciones` filtra siempre — un
    // pedido sin ella existe en la base y es INVISIBLE en el panel del courier
    // (el agujero que tuvo Flex durante meses).
    fecha_compromiso: alta.fechaCompromiso,
    fecha_compromiso_hora: alta.corte.fechaCompromisoHora,
    corte_riesgo: alta.corte.corteRiesgo,
    tarifa_aplicable_id: alta.tarifaAplicableId,
    // Shopify no da etiqueta: la imprime Rutax con su propio QR.
    tracking_token: crypto.randomUUID(),
    // `estado` se OMITE a propósito: manda el DEFAULT de la columna
    // ('pendiente_asignacion'). Mismo criterio que la ingesta de ML.
    ...(datos.lat != null && datos.long != null
      ? {
          lat: datos.lat,
          long: datos.long,
          // La coordenada la manda la plataforma que originó el pedido, no un
          // geocodificador que interpreta texto libre.
          geo_estado: "resuelto",
          geo_confianza: 1,
          geocodificado_en: ahoraIso,
        }
      : {}),
  };

  let ultimoError = "el INSERT no devolvió el id del pedido";

  for (let intento = 1; intento <= MAX_INTENTOS_CODIGO_INTERNO; intento += 1) {
    const { data, error } = await supabase
      .schema("operacion")
      .from("pedidos")
      .insert({ ...base, codigo_interno: generarCodigoInterno() })
      .select("id")
      .maybeSingle();

    if (!error) {
      const pedidoId = (data as { id?: string } | null)?.id;
      if (!pedidoId) return { estado: "error", mensaje: ultimoError };

      await publicarGeocodificacionPedido(
        pedidoId,
        ctx,
        datos.destinatarioDireccion,
        datos.destinatarioComuna,
        `pedido-ingestado-${pedidoId}`,
      );
      return { estado: "insertado", pedidoId };
    }

    ultimoError = error.message;
    if ((error as { code?: string }).code !== "23505") {
      return { estado: "error", mensaje: ultimoError };
    }

    // Un 23505 aquí tiene DOS causas posibles y hay que distinguirlas, porque el
    // remedio es opuesto:
    //   · colisión de `codigo_interno` → generar otro y reintentar;
    //   · la llave de idempotencia `(tenant, fuente, id_externo)` → otra corrida
    //     ganó la carrera (cron y botón manual a la vez): NO es un error, es el
    //     camino idempotente, y hay que pasar al UPDATE.
    // No se decide leyendo el texto del error: se relee la fila. Si ahora existe,
    // fue la llave de idempotencia; si no, fue el código y se reintenta.
    const relectura = await leerPedidoPorIdExterno(supabase, ctx, datos.idExterno);
    if (relectura.fila) {
      return actualizarPedidoShopify(supabase, ctx, relectura.fila, datos);
    }
  }

  return { estado: "error", mensaje: ultimoError };
}

async function actualizarPedidoShopify(
  supabase: ClienteSupabase,
  ctx: ContextoIngestaShopify,
  existente: FilaPedidoExistente,
  datos: DatosPedidoShopify,
): Promise<ResultadoGuardado> {
  const ahoraIso = new Date().toISOString();

  // SOLO lo que Shopify posee. La lista es corta a propósito: cada columna que
  // se agregue aquí es una columna que un barrido cada 15 minutos va a pisar.
  const cambios: Record<string, unknown> = {
    destinatario_nombre: datos.destinatarioNombre,
    destinatario_direccion: datos.destinatarioDireccion,
    destinatario_comuna: datos.destinatarioComuna,
    // `null` es un valor legítimo: si el comprador borró su teléfono en la
    // tienda, Shopify es la fuente de verdad y Rutax no debe conservar el viejo.
    destinatario_telefono: datos.destinatarioTelefono,
    instrucciones_entrega: datos.instruccionesEntrega,
    referencia_externa: datos.referenciaExterna,
  };

  // ---------------------------------------------------------------------------
  // ¿El DESTINO cambió? (el comprador corrigió su dirección en la tienda)
  //
  // Si cambió, la coordenada guardada describe el domicilio ANTERIOR: el texto
  // diría una cosa y el punto del mapa otra, y eso es lo que leen el ruteo, el
  // manifiesto del conductor y la Torre. Mismo tratamiento que
  // `actualizarPedidoFlex` (../ml/ingesta-pedidos.ts:1014-1057).
  // ---------------------------------------------------------------------------
  const destinoCambio =
    !mismoDestino(datos.destinatarioDireccion, existente.destinatario_direccion) ||
    !mismoDestino(datos.destinatarioComuna, existente.destinatario_comuna);

  let regeocodificar = false;

  if (destinoCambio) {
    if (datos.lat != null && datos.long != null) {
      // Shopify manda la coordenada del domicilio nuevo: se adopta tal cual.
      cambios.lat = datos.lat;
      cambios.long = datos.long;
      cambios.geo_estado = "resuelto";
      cambios.geo_confianza = 1;
      cambios.geocodificado_en = ahoraIso;
    } else {
      // Hay dirección nueva y no hay coordenada: se BORRA la anterior en el
      // mismo UPDATE y el pedido vuelve a la cola de geocodificación.
      //
      // Borrarla tiene un costo asumido —un pedido ya secuenciado se cae del
      // mapa hasta que se resuelva la nueva—, y es preferible a lo contrario:
      // mandar al conductor a la casa anterior con la dirección nueva en
      // pantalla, sin que nada delate el desajuste.
      cambios.lat = null;
      cambios.long = null;
      cambios.geo_estado = "pendiente";
      cambios.geo_confianza = null;
      cambios.geocodificado_en = null;
      regeocodificar = true;
    }
  } else if (datos.lat != null && datos.long != null && existente.geo_estado !== "resuelto") {
    // Mismo destino y todavía faltaba la coordenada: se rellena. Si ya estaba
    // resuelta no se re-escribe — `geocodificado_en` dejaría de significar
    // «cuándo se resolvió».
    cambios.lat = datos.lat;
    cambios.long = datos.long;
    cambios.geo_estado = "resuelto";
    cambios.geo_confianza = 1;
    cambios.geocodificado_en = ahoraIso;
  }

  const { error } = await supabase
    .schema("operacion")
    .from("pedidos")
    .update(cambios)
    .eq("id", existente.id)
    .eq("tenant_id", ctx.tenantId);

  if (error) return { estado: "error", mensaje: error.message };

  // Solo DESPUÉS de que el UPDATE quedó firme: si el evento saliera antes, el
  // job podría leer la fila con la dirección vieja y volver a resolver la
  // coordenada que acabamos de invalidar. Sin `id` de dedupe a propósito —
  // reusar el del alta haría que Inngest lo descartara durante 24 h.
  if (regeocodificar) {
    await publicarGeocodificacionPedido(
      existente.id,
      ctx,
      datos.destinatarioDireccion,
      datos.destinatarioComuna,
    );
  }

  return { estado: "actualizado", pedidoId: existente.id };
}

// =============================================================================
// Cancelación en la tienda — DETECTAR y AVISAR, nunca aplicar
// =============================================================================

export interface DatosCancelacionShopify {
  pedidoId: string;
  tenantId: string;
  sellerId: string;
  idExterno: string;
  referenciaExterna: string | null;
  /** Estado interno que tenía el pedido cuando se detectó la cancelación. */
  estadoAnterior: string;
  /** `Order.cancelledAt`, si Shopify lo informó. */
  canceladoEnFuenteEn: string | null;
}

/**
 * Publica `operacion/pedido.cancelado-en-fuente`.
 *
 * LÍMITE DE RESPONSABILIDAD (misma regla que en ML): `integraciones` DETECTA y
 * AVISA. NO mueve el estado a `cancelado`, NO abre incidencia y NO toca líneas
 * de dinero — eso es del consumidor, que hoy **no existe** a propósito: es
 * trabajo de `operacion`. Ver el comentario del evento en `lib/inngest/eventos.ts`.
 *
 * Idempotencia: `id` determinístico por pedido. Un pedido se cancela una vez,
 * por mucho que dos barridos lo descubran.
 *
 * Nunca lanza. Si el envío falla, el pedido sigue en un estado no terminal y el
 * repaso de la próxima corrida lo vuelve a encontrar cancelado y reintenta. Por
 * lo mismo, este camino NO escribe nada en el pedido: si marcáramos «ya avisado»
 * y el consumidor fallara, nadie volvería a intentarlo.
 */
export async function publicarCancelacionShopify(
  datos: DatosCancelacionShopify,
  logger?: { warn: (m: string) => void },
): Promise<boolean> {
  try {
    await inngest.send({
      name: "operacion/pedido.cancelado-en-fuente",
      id: `pedido-cancelado-fuente-${datos.pedidoId}`,
      data: {
        pedidoId: datos.pedidoId,
        tenantId: datos.tenantId,
        sellerId: datos.sellerId,
        fuente: "shopify" as const,
        idExterno: datos.idExterno,
        referenciaExterna: datos.referenciaExterna,
        estadoAnterior: datos.estadoAnterior,
        canceladoEnFuenteEn: datos.canceladoEnFuenteEn,
      },
    });
    return true;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    logger?.warn(
      `No se pudo publicar la cancelación del pedido ${datos.pedidoId}: ${mensaje}. ` +
        "El repaso lo reintentará en la próxima corrida.",
    );
    return false;
  }
}

// =============================================================================
// Orquestación — órdenes crudas → pedidos en BD
// =============================================================================

/**
 * Procesa un lote de órdenes ya leídas de Shopify. Extraída de la paginación a
 * propósito: es la parte que decide QUÉ ENTRA, y así se puede ejercer en un test
 * sin simular la API.
 *
 * Orden de las decisiones, y por qué:
 *   1. `interpretarOrden` — pura, sin red ni base. Descarta lo cancelado, lo ya
 *      despachado, lo que no lleva el tag y lo que no tiene dirección.
 *   2. Cobertura. Una tienda vende a todo Chile; solo una parte va por este
 *      courier. Comuna que no está en el catálogo, o que no cae en ninguna zona
 *      del tenant → NO entra.
 *   3. Tarifa. Sin tarifa vigente NO entra — ver el encabezado del archivo: el
 *      pedido no fallaría al crearse, fallaría al entregarse, tumbando el job
 *      que genera la plata.
 *   4. Ventana de corte → `fecha_compromiso_hora` y `corte_riesgo`.
 *   5. Persistencia.
 *
 * Los pasos 2-4 se evalúan ANTES de mirar si el pedido ya existe. Es deliberado:
 * son las condiciones de «este pedido es del courier», y no dependen de si ya lo
 * habíamos visto. El costo que eso tendría (tres consultas por orden, en cada
 * barrido) lo elimina entero el resolutor memoizado.
 */
export async function ingestarOrdenesShopify(
  supabase: ClienteSupabase,
  ordenes: readonly OrdenShopify[],
  ctx: ContextoIngestaShopify,
  opciones: {
    resolutor: ResolutorAlta;
    /** Fecha civil de Santiago para `fecha_compromiso`. */
    fechaCompromiso: string;
    logger?: LoggerIngesta;
    /** Acumulador — permite sumar varias páginas en un solo resumen. */
    resumen?: ResumenIngestaShopifyDetallado;
  },
): Promise<ResumenIngestaShopifyDetallado> {
  const resumen = opciones.resumen ?? resumenVacio();
  const logger = opciones.logger ?? SIN_LOGGER;

  for (const orden of ordenes) {
    resumen.totalLeidos += 1;

    // --- 1. Interpretación (pura) --------------------------------------------
    const interpretada = interpretarOrden(orden, ctx.filtroEtiqueta);
    if (!interpretada.entra) {
      resumen.motivos[interpretada.motivo] += 1;
      if (interpretada.motivo === "sin_direccion") resumen.totalSinDireccion += 1;
      else resumen.totalOmitidos += 1;
      continue;
    }

    const datos = interpretada.datos;

    // --- 2. Cobertura ---------------------------------------------------------
    // `resolverComunaCanonica` ya corrió dentro de la interpretación. Si no
    // reconoció la comuna, `resolverZona` no puede acertar: la función SQL
    // compara por igualdad exacta contra la forma canónica del catálogo.
    const zonaId = datos.comunaReconocida ? await opciones.resolutor.zona(datos.destinatarioComuna) : null;

    if (!datos.comunaReconocida || !zonaId) {
      resumen.totalOmitidos += 1;
      resumen.totalFueraDeCobertura += 1;
      continue;
    }

    // --- 3. Tarifa ------------------------------------------------------------
    const tarifaAplicableId = await opciones.resolutor.tarifa();
    if (!tarifaAplicableId) {
      resumen.totalSinTarifa += 1;
      continue;
    }

    // --- 4. Ventana de corte --------------------------------------------------
    const corte = await opciones.resolutor.corte(zonaId);

    // --- 5. Persistencia ------------------------------------------------------
    const resultado = await guardarPedidoShopify(supabase, ctx, datos, {
      tarifaAplicableId,
      corte,
      fechaCompromiso: opciones.fechaCompromiso,
    });

    if (resultado.estado === "error") {
      resumen.erroresPersistencia += 1;
      resumen.primerErrorPersistencia ??= resultado.mensaje;
      // Solo el GID de la orden (no es dato personal) y el mensaje de Postgres.
      logger.error(
        `Ingesta Shopify ${ctx.shopDomain}: no se pudo guardar la orden ${datos.idExterno}: ${resultado.mensaje}`,
      );
      continue;
    }

    if (resultado.estado === "insertado") resumen.totalInsertados += 1;
    else resumen.totalActualizados += 1;
  }

  return resumen;
}

/**
 * Recorre la ventana `[desde, hasta]` de una tienda, página por página, y deja
 * los pedidos en `operacion.pedidos`.
 *
 * Es LA rutina que comparten el cron y el botón «Sincronizar ahora».
 *
 * @param accessToken token EN CLARO — solo arma el header y sale de scope al
 *   terminar. No se guarda, no se loguea, no viaja en ningún evento.
 */
export async function ingestarVentanaShopify(
  supabase: ClienteSupabase,
  ctx: ContextoIngestaShopify,
  accessToken: string,
  opciones: {
    desde: Date;
    hasta: Date;
    maxPaginas: number;
    ahora?: { fecha: string; hora: string };
    logger?: LoggerIngesta;
  },
): Promise<ResumenIngestaShopifyDetallado> {
  const logger = opciones.logger ?? SIN_LOGGER;
  // El reloj se congela al empezar: ver `crearResolutorAlta`.
  const ahora = opciones.ahora ?? ahoraEnSantiago();

  const resumen = resumenVacio();
  const resolutor = crearResolutorAlta(supabase, ctx, ahora);
  const filtro = construirFiltroOrdenes(opciones.desde, opciones.hasta);

  let cursor: string | null = null;

  for (let pagina = 0; pagina < opciones.maxPaginas; pagina += 1) {
    const respuesta: PaginaOrdenes = await obtenerPaginaOrdenes({
      shopDomain: ctx.shopDomain,
      accessToken,
      filtro,
      cursor,
    });
    resumen.paginasRecorridas += 1;

    await ingestarOrdenesShopify(supabase, respuesta.nodes, ctx, {
      resolutor,
      fechaCompromiso: ahora.fecha,
      logger,
      resumen,
    });

    // `hasNextPage` false, o un `endCursor` nulo (Shopify no da cursor cuando la
    // página vino vacía): en ambos casos no hay más que recorrer. La segunda
    // condición evita girar en vacío pidiendo siempre la misma página.
    if (!respuesta.hasNextPage || !respuesta.endCursor) break;
    cursor = respuesta.endCursor;

    if (pagina === opciones.maxPaginas - 1) {
      resumen.cortadoPorTopeDePaginas = true;
      logger.warn(
        `Ingesta Shopify ${ctx.shopDomain}: corte por tope de ${opciones.maxPaginas} páginas. ` +
          "El resto queda para la próxima corrida (el cursor no avanza más allá de la ventana).",
      );
    }
  }

  return resumen;
}
