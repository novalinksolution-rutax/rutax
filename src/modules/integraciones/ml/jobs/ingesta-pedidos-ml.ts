/**
 * Job 6 · ml/ingestaPedidos — ingesta continua de pedidos Flex (cron de respaldo)
 * =============================================================================
 * El agujero que tapa: hasta ahora la ÚNICA vía de entrada de un pedido Flex era
 * el backfill, y el backfill solo se dispara al (re)conectar una cuenta. Un
 * pedido Flex nuevo no entraba solo. Con esto hay tres puertas y una sola
 * implementación de ingesta (`../ingesta-pedidos.ts`):
 *   · webhook  → inmediatez (segundos), pero ML pierde notificaciones;
 *   · cron     → esto: la red que recoge lo que el webhook dejó caer;
 *   · backfill → la ventana de una reconexión.
 *
 * POR QUÉ EL CRON NO ES OPCIONAL (doc oficial de ML, `docs/mercadolibre/08-*.md`):
 * si no respondemos 200 en 500 ms, ML reintenta a intervalos exponenciales
 * durante 1 h (8º reintento) y después **descarta el mensaje**; y si el endpoint
 * falla repetidamente, ML **desactiva los tópicos suscritos** — en silencio. Un
 * sistema que dependa solo del webhook se queda ciego sin enterarse.
 *
 * DOS FASES POR CONEXIÓN
 * ----------------------
 * A. **Órdenes nuevas** — `GET /orders/search` desde el cursor de esa conexión.
 *    Se piden los envíos SOLO de las órdenes que todavía no tenemos: el backfill
 *    pedía el detalle de las 110 y usaba 39. Con la ingesta corriendo cada media
 *    hora ese patrón multiplicaba por ~34 el gasto diario sin traer nada nuevo.
 *
 * B. **Repaso de estados** — `GET /shipments/{id}` de los pedidos no terminales
 *    de los últimos 7 días. Es la ÚNICA forma de ver una cancelación:
 *    `GET /orders/search?seller=` **no devuelve órdenes canceladas** (verificado
 *    contra la doc oficial) — la orden desaparece del resultado en vez de
 *    aparecer marcada, así que la fase A jamás podría detectarla.
 *
 * CANCELACIÓN: se DETECTA y se AVISA (`operacion/pedido.cancelado-en-ml`). Este
 * job no mueve el estado a `cancelado`, no abre incidencia y no toca dinero —
 * eso es del consumidor del evento. Ver `../cancelacion-ml.ts`.
 *
 * 404 EN `GET /shipments/{id}`: **no se asume cancelación**. La doc de ML no dice
 * qué devuelve para un envío cancelado, y adivinar significaría cancelar pedidos
 * vivos ante un error transitorio. Se cuenta, se registra de forma visible
 * (observabilidad + resumen del run en `infra.ejecuciones_job`) y NO se toca el
 * estado.
 *
 * SEGURIDAD: el token se descifra dentro del paso, se pasa por parámetro y sale
 * de scope; nunca a un log, a un error ni a un payload de evento. Del shipment
 * no se loguea un solo valor (trae nombre y dirección del destinatario): solo
 * ids de envío, que no son dato personal.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { capturarMensaje } from "@/lib/observabilidad";
import { descifrarSecreto } from "../../secretos";
import { peticionMl, ErrorHttpMl } from "../cliente-http";
import { esCancelacionMl, publicarCancelacionEnMl } from "../cancelacion-ml";
import {
  CONCURRENCIA_SHIPMENTS,
  extraerShipmentId,
  ingestarShipmentsMl,
  interpretarShipment,
  mapearConConcurrencia,
  obtenerShipment,
  type ContextoIngestaMl,
  type EntradaShipmentIngesta,
  type LoggerIngesta,
  type OrderMl,
} from "../ingesta-pedidos";
import type { EstadoPedidoInterno } from "../tipos-operacion";

// =============================================================================
// Parámetros — todos exportados para que los tests fijen el contrato
// =============================================================================

/**
 * Cada 30 minutos, de 06:00 a 23:00 **hora de Santiago**.
 *
 * `TZ=America/Santiago` es obligatorio y no cosmético: Chile cambia de horario
 * (UTC-4 en invierno, UTC-3 en verano), así que un cron en UTC correría una hora
 * corrida medio año — la ventana empezaría a las 05:00 o a las 07:00 locales. El
 * prefijo `TZ=` es la forma documentada por Inngest y el repo ya la usa en
 * `operacion/jobs/purgar-evidencias.ts`.
 *
 * `*\/30 6-22` cubre el intervalo **[06:00, 23:00)**: primera corrida 06:00,
 * última 22:30, 34 al día. Se elige el rango `6-22` y no `6-23` justamente para
 * NO disparar a las 23:30, fuera de la ventana pedida.
 *
 * ⚠️ Los dos domingos del año en que Chile cambia de hora, una corrida puede
 * saltarse o repetirse (la propia doc de Inngest lo advierte para husos locales).
 * Es inocuo aquí: las dos fases son idempotentes y la ventana de la fase A lleva
 * una hora de solapamiento.
 */
export const CRON_INGESTA_ML = "TZ=America/Santiago */30 6-22 * * *";

/**
 * Cuánto se retrocede el cursor en cada corrida para no perder nada en el borde.
 *
 * Una hora, y el número sale de la API, no del dedo: **ML redondea los filtros de
 * fecha a la hora** («la API usa hasta la hora y descarta minutos, segundos y
 * milisegundos»). Con un solapamiento menor a 60 min el redondeo ya se lo comería
 * y el margen real sería impredecible; con 60 min el comportamiento es explícito
 * y coincide con lo que ML va a hacer de todos modos. El coste es re-listar una
 * hora de órdenes, y como los envíos ya conocidos NO se vuelven a pedir, esa
 * relectura no gasta llamadas de shipment.
 */
export const SOLAPAMIENTO_MS = 60 * 60 * 1000;

/** Tope duro de la ventana hacia atrás (igual que el backfill). */
export const VENTANA_MAXIMA_DIAS = 7;

/** Ventana del repaso de estados: pedidos no terminales de los últimos N días. */
export const DIAS_REPASO_ESTADOS = 7;

const PAGE_SIZE = 50;

/**
 * Corte duro de páginas de `/orders/search` por conexión y corrida.
 * 40 × 50 = 2.000 órdenes, muy por encima de lo que cabe en una ventana de horas.
 * Existe por lo mismo que en el backfill: una página no vacía en bucle (posible
 * bajo límite de tasa) haría girar el paso hasta el timeout de Inngest.
 */
export const MAX_PAGINAS_INGESTA = 40;

/**
 * No se vuelve a preguntar por un envío consultado hace menos de esto.
 *
 * 25 minutos, justo por debajo de la cadencia de 30: cada pedido no terminal
 * recibe como mucho UNA llamada de repaso por ciclo, aunque una corrida se
 * demore o se solape con la siguiente. Es el dial para bajar el coste sin tocar
 * la cadencia.
 */
export const FRESCURA_MINUTOS = 25;

/**
 * Tope de `GET /shipments/{id}` de repaso por conexión y corrida.
 *
 * Acota el peor caso (un seller con miles de pedidos vivos) sin dejar a nadie
 * fuera: la consulta pide los MÁS RANCIOS primero (`ultima_sync_ml_en` ascendente,
 * nulos antes), así que lo que no entra en esta corrida entra en la siguiente.
 */
export const TOPE_SHIPMENTS_REPASO = 300;

/** Chunk para los `.in(...)` — un `.in()` con miles de ids revienta la URI. */
const TAMANO_CHUNK_IDS = 100;

/**
 * Columna que guarda hasta dónde llegó la ingesta de órdenes de cada conexión.
 *
 * **Por qué no se reutiliza `ultima_sync_exitosa_en`:** esa columna es la marca
 * de SALUD de la conexión que ve el seller («última sincronización exitosa»), y
 * hoy la escribe el intercambio OAuth. Si el cursor de ingesta viviera ahí,
 * cualquier escritura de salud —una reconexión, un futuro sondeo que la refresque—
 * empujaría el cursor hacia adelante sin haber ingerido nada, y las órdenes de
 * ese hueco se perderían **en silencio y para siempre**. Son dos hechos distintos
 * («la conexión responde» vs. «tenemos las órdenes hasta T») y merecen dos
 * columnas.
 *
 * Migración: `20260813000001_identidad_conexiones_ml_cursor_ingesta.sql`.
 */
export const COLUMNA_CURSOR = "ingesta_ml_cursor_en";

/**
 * Estados NO terminales del pedido — los que el repaso vuelve a mirar.
 * Espejo acotado del enum `operacion.estado_pedido`, igual que el resto de
 * `tipos-operacion.ts`: `integraciones` no importa lógica de `operacion`.
 * Terminales (y por tanto fuera): entregado, entregado_manual, cancelado, devuelto.
 */
export const ESTADOS_NO_TERMINALES: readonly EstadoPedidoInterno[] = [
  "pendiente_asignacion",
  "asignado",
  "en_ruta",
  "fallido",
  "fallido_manual",
];

// =============================================================================
// Tipos internos
// =============================================================================

export interface ConexionIngesta {
  id: string;
  tenantId: string;
  sellerId: string;
  mlUserId: string;
  accessTokenRef: string;
  estadoSalud: string;
  cursorEn: string | null;
  /**
   * `true` en UNA conexión por seller. Solo esa se hace cargo de los pedidos
   * legacy sin `ml_user_id` estampado, para no consultarlos una vez por cuenta.
   */
  esRepresentativaDelSeller: boolean;
}

export interface ResumenConexionIngesta {
  conexionId: string;
  omitida?: "sin_token" | "desvinculada" | "token_ilegible";
  ordenesListadas: number;
  ordenesSinEnvio: number;
  ordenesYaConocidas: number;
  insertados: number;
  actualizados: number;
  omitidosNoFlex: number;
  ilegibles: number;
  repasados: number;
  cancelacionesDetectadas: number;
  transicionesPublicadas: number;
  /** Envíos que ML respondió 404 — NO se asume cancelación. Solo ids. */
  noEncontrados: string[];
  erroresPersistencia: number;
  cursorAvanzadoA: string | null;
}

function resumenConexionVacio(conexionId: string): ResumenConexionIngesta {
  return {
    conexionId,
    ordenesListadas: 0,
    ordenesSinEnvio: 0,
    ordenesYaConocidas: 0,
    insertados: 0,
    actualizados: 0,
    omitidosNoFlex: 0,
    ilegibles: 0,
    repasados: 0,
    cancelacionesDetectadas: 0,
    transicionesPublicadas: 0,
    noEncontrados: [],
    erroresPersistencia: 0,
    cursorAvanzadoA: null,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type ClienteSupabase = ReturnType<typeof crearClienteServiceRole> & {
  schema: (s: string) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// =============================================================================
// Ventana incremental
// =============================================================================

/** Trunca un instante al comienzo de su hora UTC. */
function alInicioDeLaHora(instante: Date): Date {
  const copia = new Date(instante.getTime());
  copia.setUTCMinutes(0, 0, 0);
  return copia;
}

/**
 * Ventana `[desde, hasta]` de `order.date_created` para la fase A.
 *
 * - Sin cursor (primera corrida de esa conexión, o migración aún sin aplicar):
 *   se barre la ventana máxima de 7 días. Ocurre UNA vez por conexión y es
 *   barato, porque los envíos que ya tenemos no se vuelven a consultar.
 * - Con cursor: `cursor - 1 h`, truncado al inicio de la hora para que nuestro
 *   límite coincida con el redondeo que ML aplica igual.
 * - Nunca más de 7 días hacia atrás: un cursor viejísimo (sistema caído days) no
 *   puede convertir una corrida en un barrido ilimitado; para eso está la
 *   sincronización manual o la reconexión.
 */
export function calcularVentanaFaseA(
  cursor: Date | null,
  ahora: Date,
): { desde: Date; hasta: Date; recortada: boolean } {
  const limiteMaximo = new Date(ahora.getTime() - VENTANA_MAXIMA_DIAS * 24 * 60 * 60 * 1000);

  if (!cursor || Number.isNaN(cursor.getTime())) {
    return { desde: limiteMaximo, hasta: ahora, recortada: true };
  }

  const conSolapamiento = alInicioDeLaHora(new Date(cursor.getTime() - SOLAPAMIENTO_MS));
  if (conSolapamiento < limiteMaximo) {
    return { desde: limiteMaximo, hasta: ahora, recortada: true };
  }
  return { desde: conSolapamiento, hasta: ahora, recortada: false };
}

/** ¿El error de PostgREST es «esa columna no existe»? (migración sin aplicar). */
function esColumnaInexistente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .*does not exist|could not find the '.*' column/i.test(error.message ?? "");
}

// =============================================================================
// Lectura de conexiones
// =============================================================================

const COLUMNAS_CONEXION_BASE =
  "id, tenant_id, seller_id, ml_user_id, access_token_ref, estado_salud";

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizarConexiones(filas: any[], conCursor: boolean): ConexionIngesta[] {
  // Una sola conexión por seller carga con los pedidos legacy sin `ml_user_id`.
  // Determinista: la de id menor, para que dos corridas elijan la misma.
  const representativaPorSeller = new Map<string, string>();
  for (const f of filas) {
    const actual = representativaPorSeller.get(f.seller_id);
    if (!actual || String(f.id) < actual) representativaPorSeller.set(f.seller_id, String(f.id));
  }

  return filas.map((f) => ({
    id: String(f.id),
    tenantId: String(f.tenant_id),
    sellerId: String(f.seller_id),
    mlUserId: String(f.ml_user_id),
    accessTokenRef: String(f.access_token_ref),
    estadoSalud: String(f.estado_salud),
    cursorEn: conCursor ? ((f[COLUMNA_CURSOR] as string | null) ?? null) : null,
    esRepresentativaDelSeller: representativaPorSeller.get(f.seller_id) === String(f.id),
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Conexiones ML de TODOS los tenants que pueden ingerir: con cuenta, con token y
 * no desvinculadas. Una conexión `desvinculada` no tiene token válido — la
 * gestionan `refrescar-tokens` y `sondeo-salud`, no este job.
 *
 * Degrada sin romper si la migración del cursor todavía no está aplicada: se
 * relee sin esa columna y se avisa una vez. El coste es barrer 7 días en cada
 * corrida en vez de una hora — más caro, nunca incorrecto.
 */
export async function leerConexionesParaIngesta(
  supabase: ClienteSupabase,
  logger?: LoggerIngesta,
): Promise<{ conexiones: ConexionIngesta[]; cursorDisponible: boolean }> {
  const consulta = (columnas: string) =>
    supabase
      .schema("identidad")
      .from("conexiones_seller_ml")
      .select(columnas)
      .neq("estado_salud", "desvinculada")
      .not("ml_user_id", "is", null)
      .not("access_token_ref", "is", null);

  const conCursor = await consulta(`${COLUMNAS_CONEXION_BASE}, ${COLUMNA_CURSOR}`);
  if (!conCursor.error) {
    return {
      conexiones: normalizarConexiones(conCursor.data ?? [], true),
      cursorDisponible: true,
    };
  }

  if (!esColumnaInexistente(conCursor.error)) {
    throw new Error(`No se pudieron leer las conexiones ML: ${conCursor.error.message}`);
  }

  logger?.warn(
    `La columna identidad.conexiones_seller_ml.${COLUMNA_CURSOR} no existe todavía ` +
      "(migración 20260813000001 sin aplicar). La ingesta corre igual, barriendo la " +
      "ventana máxima de 7 días en cada corrida hasta que se aplique.",
  );

  const sinCursor = await consulta(COLUMNAS_CONEXION_BASE);
  if (sinCursor.error) {
    throw new Error(`No se pudieron leer las conexiones ML: ${sinCursor.error.message}`);
  }
  return {
    conexiones: normalizarConexiones(sinCursor.data ?? [], false),
    cursorDisponible: false,
  };
}

// =============================================================================
// Fase A — órdenes nuevas
// =============================================================================

/** Qué envíos de esta lista YA existen como pedido de este tenant. */
async function filtrarShipmentsConocidos(
  supabase: ClienteSupabase,
  tenantId: string,
  shipmentIds: string[],
): Promise<Set<string>> {
  const conocidos = new Set<string>();
  for (let i = 0; i < shipmentIds.length; i += TAMANO_CHUNK_IDS) {
    const chunk = shipmentIds.slice(i, i + TAMANO_CHUNK_IDS);
    const { data, error } = await supabase
      .schema("operacion")
      .from("pedidos")
      .select("ml_shipment_id")
      .eq("tenant_id", tenantId)
      .in("ml_shipment_id", chunk);
    if (error) {
      throw new Error(`No se pudo comprobar qué envíos ya existen: ${error.message}`);
    }
    for (const fila of (data ?? []) as Array<{ ml_shipment_id: string | null }>) {
      if (fila.ml_shipment_id) conocidos.add(String(fila.ml_shipment_id));
    }
  }
  return conocidos;
}

async function faseAOrdenesNuevas(
  supabase: ClienteSupabase,
  conexion: ConexionIngesta,
  accessToken: string,
  ventana: { desde: Date; hasta: Date },
  resumen: ResumenConexionIngesta,
  logger: LoggerIngesta,
  /** Se llena con los envíos consultados aquí, para que la fase B los salte. */
  consultadosEnFaseA: Set<string>,
): Promise<void> {
  const candidatos = new Map<string, EntradaShipmentIngesta>();
  let offset = 0;
  let paginas = 0;
  let hayMas = true;

  while (hayMas) {
    if (paginas >= MAX_PAGINAS_INGESTA) {
      logger.warn(
        `Ingesta ML conexión ${conexion.id}: corte por tope de ${MAX_PAGINAS_INGESTA} ` +
          "páginas. El resto queda para la próxima corrida (el cursor no avanza más allá).",
      );
      break;
    }
    paginas += 1;

    const parametros = new URLSearchParams({
      seller: conexion.mlUserId,
      "order.date_created.from": ventana.desde.toISOString(),
      "order.date_created.to": ventana.hasta.toISOString(),
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });

    // Sin `x-format-new` en órdenes, a propósito: el aviso de obligatoriedad de
    // ML está acotado a los recursos de shipments y la respuesta de órdenes ya
    // trae `shipping.id` sin la cabecera (verificado en producción).
    const cuerpo = await peticionMl<{
      results?: OrderMl[];
      paging?: { total?: number; offset?: number; limit?: number };
    }>({
      metodo: "GET",
      ruta: `/orders/search?${parametros.toString()}`,
      accessToken,
    });

    const ordenes = cuerpo.results ?? [];
    const total = cuerpo.paging?.total ?? 0;

    if (ordenes.length === 0) {
      if (total > offset) {
        logger.warn(
          `Ingesta ML conexión ${conexion.id}: ML devolvió una página vacía con ` +
            `total=${total} en offset=${offset}. Se corta para no girar en vacío.`,
        );
      }
      break;
    }

    resumen.ordenesListadas += ordenes.length;

    for (const orden of ordenes) {
      const shipmentId = extraerShipmentId(orden);
      // `shipping.id` null = ML no creó el envío todavía. Caso ESPERADO, no
      // error: la orden vuelve a entrar en la ventana de la próxima corrida.
      if (!shipmentId) {
        resumen.ordenesSinEnvio += 1;
        continue;
      }
      if (!candidatos.has(shipmentId)) {
        candidatos.set(shipmentId, {
          shipmentId,
          mlOrderId: String(orden.id),
          ordenCreadaIso: orden.date_created ?? null,
          direccionRespaldo: orden.shipping_address?.address_line ?? null,
          comunaRespaldo: orden.shipping_address?.city?.name ?? null,
        });
      }
    }

    offset += ordenes.length;
    hayMas = offset < total;
  }

  if (candidatos.size === 0) return;

  // Solo se pide el detalle de los envíos que NO tenemos. El backfill pedía los
  // de TODAS las órdenes de la ventana; repetir eso cada 30 min sería gastar
  // llamadas para releer lo mismo.
  const conocidos = await filtrarShipmentsConocidos(supabase, conexion.tenantId, [
    ...candidatos.keys(),
  ]);
  const nuevos = [...candidatos.values()].filter((c) => !conocidos.has(c.shipmentId));
  resumen.ordenesYaConocidas = conocidos.size;

  if (nuevos.length === 0) return;

  for (const nuevo of nuevos) consultadosEnFaseA.add(nuevo.shipmentId);

  const ctx: ContextoIngestaMl = {
    tenantId: conexion.tenantId,
    sellerId: conexion.sellerId,
    mlUserId: conexion.mlUserId,
    origen: "ml_ingesta",
  };

  const ingesta = await ingestarShipmentsMl(supabase, nuevos, ctx, accessToken, { logger });

  resumen.insertados += ingesta.insertados;
  resumen.actualizados += ingesta.actualizados;
  resumen.omitidosNoFlex += ingesta.omitidosNoFlex;
  resumen.ilegibles += ingesta.ilegibles;
  resumen.erroresPersistencia += ingesta.erroresPersistencia;
  resumen.noEncontrados.push(...ingesta.noEncontrados);

  if (ingesta.diagnostico) {
    const d = ingesta.diagnostico;
    // SOLO nombres de campo y ubicaciones. Ni un valor del shipment.
    logger.info(
      `Ingesta ML conexión ${conexion.id}: forma del shipment — ` +
        `claves=[${d.claves.join(",")}] plazos=[${d.clavesPlazos.join(",")}] ` +
        `logistic_type=${d.ubicacionLogisticType} direccion=${d.ubicacionDireccion} ` +
        `fecha_entrega=${d.campoFechaEntrega ?? "ausente"}`,
    );
  }
}

// =============================================================================
// Fase B — repaso de estados (donde aparecen las cancelaciones)
// =============================================================================

interface PedidoRepaso {
  id: string;
  ml_shipment_id: string;
  estado: EstadoPedidoInterno;
  estado_ml: string | null;
  ultima_sync_ml_en: string | null;
}

async function faseBRepasoEstados(
  supabase: ClienteSupabase,
  conexion: ConexionIngesta,
  accessToken: string,
  ahora: Date,
  yaConsultados: ReadonlySet<string>,
  resumen: ResumenConexionIngesta,
  logger: LoggerIngesta,
): Promise<void> {
  const desdeIso = new Date(
    ahora.getTime() - DIAS_REPASO_ESTADOS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const limiteFrescura = ahora.getTime() - FRESCURA_MINUTOS * 60 * 1000;

  let consulta = supabase
    .schema("operacion")
    .from("pedidos")
    .select("id, ml_shipment_id, estado, estado_ml, ultima_sync_ml_en")
    .eq("tenant_id", conexion.tenantId)
    .eq("seller_id", conexion.sellerId)
    .eq("tipo_pedido", "flex")
    .not("ml_shipment_id", "is", null)
    .in("estado", ESTADOS_NO_TERMINALES as unknown as string[])
    .gte("creado_en", desdeIso);

  // Un solo `.or()` en toda la consulta: dos grupos OR distintos en la misma
  // petición chocan en el mismo parámetro de PostgREST. El filtro de frescura,
  // que también sería un OR (`null` o antiguo), se resuelve ordenando por
  // `ultima_sync_ml_en` ascendente con nulos primero y filtrando en memoria:
  // el `limit` se lleva justamente a los más rancios, que son los que interesan.
  //
  // ⚠️ `.or()` recibe un STRING de filtro que PostgREST parsea: a diferencia de
  // `.eq()`, ahí no hay parámetro ligado. `ml_user_id` es una columna `text`, así
  // que se exige forma numérica antes de interpolarla; cualquier otra cosa cae al
  // `.eq()` parametrizado. Cuesta una línea y cierra una grieta con forma de
  // inyección en el único filtro del módulo que se construye por concatenación.
  const cuentaInterpolable = /^[0-9]+$/.test(conexion.mlUserId);
  consulta =
    conexion.esRepresentativaDelSeller && cuentaInterpolable
      ? consulta.or(`ml_user_id.eq.${conexion.mlUserId},ml_user_id.is.null`)
      : consulta.eq("ml_user_id", conexion.mlUserId);

  const { data, error } = await consulta
    .order("ultima_sync_ml_en", { ascending: true, nullsFirst: true })
    .limit(TOPE_SHIPMENTS_REPASO);

  if (error) {
    throw new Error(`No se pudieron leer los pedidos a repasar: ${error.message}`);
  }

  const candidatos = ((data ?? []) as PedidoRepaso[]).filter((p) => {
    if (yaConsultados.has(String(p.ml_shipment_id))) return false;
    if (!p.ultima_sync_ml_en) return true;
    const t = new Date(p.ultima_sync_ml_en).getTime();
    return Number.isNaN(t) || t < limiteFrescura;
  });

  if (candidatos.length === 0) return;

  const sinCambio: string[] = [];

  const resultados = await mapearConConcurrencia(
    candidatos,
    CONCURRENCIA_SHIPMENTS,
    async (pedido) => {
      const shipmentId = String(pedido.ml_shipment_id);
      try {
        const crudo = await obtenerShipment(shipmentId, accessToken);
        const { datos } = interpretarShipment(crudo);
        return { pedido, shipmentId, datos };
      } catch (error) {
        if (error instanceof ErrorHttpMl) {
          // 401/403 → el token murió: no tiene sentido seguir con esta conexión.
          if (error.status === 401 || error.status === 403) {
            return { pedido, shipmentId, tokenCaido: true as const };
          }
          return { pedido, shipmentId, fallo: `HTTP ${error.status}`, status: error.status };
        }
        return {
          pedido,
          shipmentId,
          fallo: error instanceof Error ? error.message : "error desconocido",
        };
      }
    },
  );

  let tokenCaido = false;

  for (const r of resultados) {
    if ("tokenCaido" in r && r.tokenCaido) {
      tokenCaido = true;
      continue;
    }

    if ("fallo" in r && r.fallo) {
      if (r.status === 404) {
        // ⚠️ NO se asume cancelación. La doc de ML no documenta qué devuelve
        // para un envío cancelado; inferirlo cancelaría pedidos vivos ante un
        // error transitorio. Se registra y el estado queda intacto.
        resumen.noEncontrados.push(r.shipmentId);
      } else {
        resumen.ilegibles += 1;
      }
      continue;
    }

    if (!("datos" in r) || !r.datos) continue;
    resumen.repasados += 1;

    const { pedido, shipmentId, datos } = r;

    if (esCancelacionMl(datos.estadoMl, datos.subestadoMl)) {
      // Detectar y avisar. NO se mueve el estado ni se toca dinero: eso es del
      // consumidor de `operacion/pedido.cancelado-en-ml`. Y NO se escribe
      // `estado_ml` aquí a propósito: mientras el pedido siga vivo vuelve a
      // salir en el próximo repaso, así que el aviso se reintenta solo si el
      // consumidor falló.
      const publicado = await publicarCancelacionEnMl(
        {
          pedidoId: pedido.id,
          tenantId: conexion.tenantId,
          sellerId: conexion.sellerId,
          mlShipmentId: shipmentId,
          estadoAnterior: pedido.estado,
          substatusMl: datos.subestadoMl,
        },
        logger,
      );
      if (publicado) resumen.cancelacionesDetectadas += 1;
      continue;
    }

    if (datos.estadoMl && datos.estadoMl !== pedido.estado_ml) {
      // Cambio no-cancelación: lo aplica el Job 3, dueño de la máquina de
      // estados y del optimistic locking. Aquí NO se escribe `estado_ml`: si se
      // escribiera sin haber aplicado la transición, el polling de 15 min
      // dejaría de ver diferencia y nadie reintentaría.
      await inngest.send({
        name: "ml/shipment.actualizado",
        data: {
          shipmentId,
          userId: conexion.mlUserId,
          timestamp: new Date().toISOString(),
        },
      });
      resumen.transicionesPublicadas += 1;
      continue;
    }

    // Sin novedad: se deja constancia de que SÍ se le preguntó a ML.
    sinCambio.push(pedido.id);
  }

  // Un solo UPDATE por bloque en vez de uno por pedido.
  const marcaIso = new Date().toISOString();
  for (let i = 0; i < sinCambio.length; i += TAMANO_CHUNK_IDS) {
    const chunk = sinCambio.slice(i, i + TAMANO_CHUNK_IDS);
    const { error: errorMarca } = await supabase
      .schema("operacion")
      .from("pedidos")
      .update({ ultima_sync_ml_en: marcaIso })
      .in("id", chunk);
    if (errorMarca) {
      logger.warn(
        `Ingesta ML conexión ${conexion.id}: no se pudo marcar la sincronización de ` +
          `${chunk.length} pedidos sin cambios: ${errorMarca.message}`,
      );
    }
  }

  if (tokenCaido) {
    logger.warn(
      `Ingesta ML conexión ${conexion.id}: ML rechazó el token durante el repaso. ` +
        "El sondeo de salud y el refresco de tokens gestionan la reconexión.",
    );
  }
}

// =============================================================================
// Rutina por conexión — la misma para el cron y para el botón manual
// =============================================================================

export async function sincronizarConexionMl(
  conexion: ConexionIngesta,
  opciones: {
    ahora?: Date;
    cursorDisponible?: boolean;
    logger?: LoggerIngesta;
    supabase?: ClienteSupabase;
  } = {},
): Promise<ResumenConexionIngesta> {
  const resumen = resumenConexionVacio(conexion.id);
  const ahora = opciones.ahora ?? new Date();
  const logger = opciones.logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const supabase = opciones.supabase ?? (crearClienteServiceRole() as ClienteSupabase);

  if (conexion.estadoSalud === "desvinculada") {
    resumen.omitida = "desvinculada";
    return resumen;
  }
  if (!conexion.accessTokenRef || !conexion.mlUserId) {
    resumen.omitida = "sin_token";
    return resumen;
  }

  let accessToken: string;
  try {
    const descifrado = await descifrarSecreto(conexion.accessTokenRef);
    if (typeof descifrado.valor !== "string") throw new Error("no es texto");
    accessToken = descifrado.valor;
  } catch {
    // El mensaje del error de descifrado no se propaga: podría llevar fragmentos
    // del material cifrado.
    logger.warn(
      `Ingesta ML conexión ${conexion.id}: no se pudo obtener el token. Se omite.`,
    );
    resumen.omitida = "token_ilegible";
    return resumen;
  }

  const cursor = conexion.cursorEn ? new Date(conexion.cursorEn) : null;
  const ventana = calcularVentanaFaseA(cursor, ahora);

  // Los envíos recién traídos en la fase A no se vuelven a preguntar en la B.
  const consultadosEnFaseA = new Set<string>();
  await faseAOrdenesNuevas(
    supabase,
    conexion,
    accessToken,
    ventana,
    resumen,
    logger,
    consultadosEnFaseA,
  );

  // El cursor solo avanza si la fase A terminó: si lanzó, la excepción sube y
  // este código no corre, así que la próxima corrida vuelve a cubrir la ventana.
  if (opciones.cursorDisponible !== false) {
    const { error } = await supabase
      .schema("identidad")
      .from("conexiones_seller_ml")
      .update({ [COLUMNA_CURSOR]: ventana.hasta.toISOString() })
      .eq("id", conexion.id);
    if (error && !esColumnaInexistente(error)) {
      logger.warn(
        `Ingesta ML conexión ${conexion.id}: no se pudo avanzar el cursor: ${error.message}`,
      );
    } else if (!error) {
      resumen.cursorAvanzadoA = ventana.hasta.toISOString();
    }
  }

  await faseBRepasoEstados(
    supabase,
    conexion,
    accessToken,
    ahora,
    consultadosEnFaseA,
    resumen,
    logger,
  );

  // El token en claro sale de scope aquí.
  return resumen;
}

// =============================================================================
// Visibilidad de los 404 (no se asume cancelación, pero no se ocultan)
// =============================================================================

/**
 * Deja los 404 a la vista de un humano por tres canales: el log del run, la
 * observabilidad central (Sentry/stdout) y el `resumen` que la telemetría
 * persiste en `infra.ejecuciones_job` — que es lo que muestra `admin/salud`.
 * Solo viajan ids de envío: no son dato personal.
 */
async function reportarNoEncontrados(
  ids: string[],
  contexto: { origen: string; tenantId?: string },
  logger: LoggerIngesta,
): Promise<void> {
  if (ids.length === 0) return;
  const muestra = ids.slice(0, 20);
  logger.error(
    `Ingesta ML: ${ids.length} envíos respondieron 404 en ML y NO se tocó su estado ` +
      `(un 404 no prueba una cancelación). Envíos: ${muestra.join(", ")}` +
      (ids.length > muestra.length ? ` …(+${ids.length - muestra.length})` : ""),
  );
  await capturarMensaje(
    `Ingesta ML: ${ids.length} envíos con 404 en GET /shipments/{id}`,
    "warning",
    {
      origen: contexto.origen,
      ...(contexto.tenantId ? { tenantId: contexto.tenantId } : {}),
      etiquetas: { motivo: "shipment_404" },
      extra: { shipmentIds: muestra, total: ids.length },
    },
  );
}

// =============================================================================
// Jobs
// =============================================================================

export const jobIngestaPedidosMl = inngest.createFunction(
  {
    id: "ml/ingestaPedidos",
    name: "ML · Ingesta continua de pedidos Flex (webhook + respaldo)",
    triggers: [{ cron: CRON_INGESTA_ML }],
    // Una sola corrida a la vez: si una se demora más de 30 min, la siguiente
    // espera en vez de duplicar llamadas a ML sobre las mismas conexiones.
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step, logger }) => {
    const { conexiones, cursorDisponible } = await step.run("leer-conexiones", async () => {
      const supabase = crearClienteServiceRole() as ClienteSupabase;
      return leerConexionesParaIngesta(supabase, logger);
    });

    logger.info(`Ingesta ML: ${conexiones.length} conexiones activas a sincronizar.`);

    const resultados = await Promise.allSettled(
      conexiones.map((conexion) =>
        step.run(`ingesta:conexion:${conexion.id}`, async () =>
          sincronizarConexionMl(conexion, { cursorDisponible, logger }),
        ),
      ),
    );

    const totales = agregarResumenes(resultados);
    await reportarNoEncontrados(totales.noEncontrados, { origen: "job:ml/ingestaPedidos" }, logger);

    logger.info(
      `Ingesta ML completada: ${totales.insertados} pedidos nuevos, ` +
        `${totales.actualizados} actualizados, ${totales.repasados} envíos repasados, ` +
        `${totales.cancelacionesDetectadas} cancelaciones detectadas.`,
    );

    return {
      conexiones: conexiones.length,
      conexionesConError: resultados.filter((r) => r.status === "rejected").length,
      cursorDisponible,
      ...totales,
      // El detalle completo puede ser largo; en el resumen del run va acotado.
      noEncontrados: totales.noEncontrados.slice(0, 20),
      totalNoEncontrados: totales.noEncontrados.length,
    };
  },
);

export const jobSincronizarConexionMl = inngest.createFunction(
  {
    id: "ml/sincronizarConexion",
    name: "ML · Sincronizar una conexión (solicitud manual)",
    triggers: [{ event: "ml/sincronizacion.solicitada" }],
    // Un barrido por conexión a la vez: dos clics simultáneos no duplican
    // llamadas a ML ni compiten por el mismo cursor.
    concurrency: { key: "event.data.conexionId", limit: 1 },
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { conexionId, tenantId } = event.data as {
      conexionId: string;
      sellerId: string;
      tenantId: string;
      actorUsuarioId: string | null;
    };

    const encontrada = await step.run("leer-conexion", async () => {
      const supabase = crearClienteServiceRole() as ClienteSupabase;
      const { conexiones, cursorDisponible } = await leerConexionesParaIngesta(supabase, logger);
      const conexion = conexiones.find((c) => c.id === conexionId) ?? null;
      return { conexion, cursorDisponible };
    });

    if (!encontrada.conexion) {
      logger.warn(
        `Sincronización manual: la conexión ${conexionId} no está activa (desvinculada, ` +
          "sin cuenta o sin token). No hay nada que sincronizar.",
      );
      return { resultado: "conexion_no_sincronizable", conexionId };
    }

    const resumen = await step.run("sincronizar", async () =>
      sincronizarConexionMl(encontrada.conexion!, {
        cursorDisponible: encontrada.cursorDisponible,
        logger,
      }),
    );

    await reportarNoEncontrados(
      resumen.noEncontrados,
      { origen: "job:ml/sincronizarConexion", tenantId },
      logger,
    );

    return {
      resultado: "completado",
      ...resumen,
      noEncontrados: resumen.noEncontrados.slice(0, 20),
      totalNoEncontrados: resumen.noEncontrados.length,
    };
  },
);

/** Suma los resúmenes por conexión en los totales del run. */
export function agregarResumenes(
  resultados: Array<PromiseSettledResult<ResumenConexionIngesta>>,
): {
  insertados: number;
  actualizados: number;
  omitidosNoFlex: number;
  ilegibles: number;
  repasados: number;
  cancelacionesDetectadas: number;
  transicionesPublicadas: number;
  erroresPersistencia: number;
  ordenesListadas: number;
  ordenesSinEnvio: number;
  noEncontrados: string[];
} {
  const totales = {
    insertados: 0,
    actualizados: 0,
    omitidosNoFlex: 0,
    ilegibles: 0,
    repasados: 0,
    cancelacionesDetectadas: 0,
    transicionesPublicadas: 0,
    erroresPersistencia: 0,
    ordenesListadas: 0,
    ordenesSinEnvio: 0,
    noEncontrados: [] as string[],
  };

  for (const r of resultados) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const v = r.value;
    totales.insertados += v.insertados;
    totales.actualizados += v.actualizados;
    totales.omitidosNoFlex += v.omitidosNoFlex;
    totales.ilegibles += v.ilegibles;
    totales.repasados += v.repasados;
    totales.cancelacionesDetectadas += v.cancelacionesDetectadas;
    totales.transicionesPublicadas += v.transicionesPublicadas;
    totales.erroresPersistencia += v.erroresPersistencia;
    totales.ordenesListadas += v.ordenesListadas;
    totales.ordenesSinEnvio += v.ordenesSinEnvio;
    totales.noEncontrados.push(...v.noEncontrados);
  }

  return totales;
}
