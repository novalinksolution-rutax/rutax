/**
 * Job · shopify/ingestaPedidos — ingesta continua de pedidos Shopify
 * =============================================================================
 * Molde: `../../ml/jobs/ingesta-pedidos-ml.ts`. Dos fases por conexión, cursor
 * en columna propia, y una sola rutina compartida por el cron y por el botón
 * «Sincronizar ahora».
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ CADA 15 MINUTOS Y NO CADA 30 COMO ML
 * ---------------------------------------------------------------------------
 * ML tiene webhook: el cron es la red que recoge lo que el webhook deja caer.
 * **Aquí NO hay webhook**, y no por olvido: los webhooks de Shopify se firman
 * con la *API secret key* de la app, y en una custom app creada por el propio
 * merchant eso significa pedirle al seller que copie y pegue un SEGUNDO secreto
 * además del Admin API token. Se dejó fuera de la v1 a propósito. Consecuencia
 * asumida: el cron es la ÚNICA puerta de entrada, así que la cadencia es su
 * peor latencia. 15 minutos es el compromiso — con corte de despacho a las
 * 16:00, media hora de ceguera es demasiado.
 *
 * ---------------------------------------------------------------------------
 * DOS FASES POR CONEXIÓN
 * ---------------------------------------------------------------------------
 * A. **Órdenes nuevas** — `orders(query: "created_at:>=… AND fulfillment_status:
 *    unfulfilled")` desde el cursor de esa conexión, con 1 h de solapamiento.
 * B. **Repaso de cancelaciones** — `nodes(ids:)` sobre los pedidos Shopify no
 *    terminales de los últimos N días. Es la ÚNICA forma de verlas: la fase A
 *    solo mira órdenes NUEVAS, y una orden que se cancela después de haber sido
 *    ingerida jamás vuelve a aparecer como novedad. Igual que en ML,
 *    `integraciones` DETECTA y PUBLICA — no aplica.
 *
 * ---------------------------------------------------------------------------
 * EL CURSOR VA EN `cursor_ingesta_en`, NO EN `ultima_sync_exitosa_en`
 * ---------------------------------------------------------------------------
 * Son dos hechos distintos: «la tienda responde» (salud, lo que ve el seller,
 * lo escribe `marcarSalud`) y «tenemos los pedidos hasta T» (cursor, lo escribe
 * SOLO este job). Fusionarlos es la lección literal de 20260813000001: una
 * reconexión empujaría el cursor sin haber ingerido nada y ese hueco de órdenes
 * se perdería en silencio y para siempre.
 *
 * Y el cursor avanza SOLO si la fase A terminó sin lanzar. Si lanza, la
 * excepción sube antes del UPDATE y la próxima corrida vuelve a cubrir la misma
 * ventana.
 *
 * SEGURIDAD: el token se descifra dentro del paso, se pasa por parámetro y sale
 * de scope; nunca a un log, a un error ni a un payload de evento. De la orden no
 * se loguea un solo valor (trae nombre, dirección y teléfono del comprador):
 * solo ids de orden y contadores.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { capturarMensaje } from "@/lib/observabilidad";
import { marcarSalud, obtenerAccessToken } from "../puerto";
import {
  consultarOrdenesPorId,
  ingestarVentanaShopify,
  publicarCancelacionShopify,
  resumenVacio,
  type ClienteSupabase,
  type ContextoIngestaShopify,
  type LoggerIngesta,
  type ResumenIngestaShopifyDetallado,
} from "../ingesta-pedidos";

// =============================================================================
// Parámetros — exportados para que los tests fijen el contrato
// =============================================================================

/**
 * Cada 15 minutos, de 06:00 a 23:00 **hora de Santiago**.
 *
 * `TZ=America/Santiago` es obligatorio y no cosmético: Chile cambia de horario
 * (UTC-4 en invierno, UTC-3 en verano), así que un cron en UTC correría una hora
 * corrida medio año. El prefijo `TZ=` es la forma documentada por Inngest y el
 * repo ya la usa en `ml/jobs/ingesta-pedidos-ml.ts` y en
 * `operacion/jobs/purgar-evidencias.ts`.
 *
 * `6-22` cubre [06:00, 23:00): primera corrida 06:00, última 22:45, 68 al día.
 * Se elige `6-22` y no `6-23` justamente para NO disparar a las 23:45.
 */
export const CRON_INGESTA_SHOPIFY = "TZ=America/Santiago */15 6-22 * * *";

/**
 * Cuánto se retrocede el cursor en cada corrida para no perder nada en el borde.
 *
 * Una hora. A diferencia de ML —donde el número sale del redondeo horario que la
 * propia API aplica a los filtros de fecha—, la búsqueda de Shopify acepta el
 * instante completo, así que aquí el solapamiento cubre otra cosa: el desfase de
 * reloj entre la tienda y nosotros, y la orden creada en el segundo exacto en
 * que la página anterior ya se había leído. Una hora es holgado y barato: lo que
 * vuelve a entrar solo produce UPDATEs idempotentes.
 */
export const SOLAPAMIENTO_MS = 60 * 60 * 1000;

/**
 * Tope duro de la ventana hacia atrás. Un cursor viejísimo (sistema caído varios
 * días) no puede convertir una corrida en un barrido ilimitado.
 *
 * 7 días queda además muy dentro de los **60 días** que alcanza `read_orders`
 * (verificado en la doc oficial de access scopes), así que la ventana nunca pide
 * órdenes que el scope no puede devolver.
 */
export const VENTANA_MAXIMA_DIAS = 7;

/** Ventana del repaso: pedidos Shopify no terminales creados en los últimos N días. */
export const DIAS_REPASO = 7;

/**
 * Corte duro de páginas por conexión y corrida. 40 × 50 = 2.000 órdenes, muy por
 * encima de lo que cabe en una ventana de horas. Existe por lo mismo que en ML:
 * una paginación que no termina haría girar el paso hasta el timeout de Inngest.
 */
export const MAX_PAGINAS_INGESTA = 40;

/**
 * Tope de pedidos a repasar por conexión y corrida. Acota el peor caso sin dejar
 * a nadie fuera: la consulta pide los MÁS ANTIGUOS primero, así que lo que no
 * entra en esta corrida entra en la siguiente.
 */
export const TOPE_PEDIDOS_REPASO = 300;

/** Columna que guarda hasta dónde llegó la ingesta de cada conexión. */
export const COLUMNA_CURSOR = "cursor_ingesta_en";

const TABLA_CONEXIONES = "conexiones_seller_shopify";

/**
 * Estados NO terminales del pedido — los que el repaso vuelve a mirar.
 * Espejo acotado del enum `operacion.estado_pedido`, igual que
 * `ml/tipos-operacion.ts`: `integraciones` no importa el enum de `operacion`.
 * Terminales (y por tanto fuera): entregado, entregado_manual, cancelado, devuelto.
 */
export const ESTADOS_NO_TERMINALES: readonly string[] = [
  "pendiente_asignacion",
  "asignado",
  "en_ruta",
  "fallido",
  "fallido_manual",
];

// =============================================================================
// Tipos
// =============================================================================

export interface ConexionShopifyIngesta {
  id: string;
  tenantId: string;
  sellerId: string;
  shopDomain: string;
  filtroEtiqueta: string | null;
  estadoSalud: string;
  cursorEn: string | null;
}

export interface ResumenConexionShopify {
  conexionId: string;
  shopDomain: string;
  omitida?: "desvinculada" | "sin_token" | "token_ilegible";
  ingesta: ResumenIngestaShopifyDetallado;
  /** Pedidos vivos consultados en el repaso. */
  repasados: number;
  /** Cancelaciones detectadas y publicadas (evento SIN consumidor todavía). */
  cancelacionesDetectadas: number;
  /** Pedidos del repaso que Shopify no devolvió. NO se asume cancelación. */
  noEncontrados: string[];
  cursorAvanzadoA: string | null;
  /** Mensaje del fallo que impidió terminar, si lo hubo. Sin token ni PII. */
  error?: string;
}

function resumenConexionVacio(
  conexionId: string,
  shopDomain: string,
): ResumenConexionShopify {
  return {
    conexionId,
    shopDomain,
    ingesta: resumenVacio(),
    repasados: 0,
    cancelacionesDetectadas: 0,
    noEncontrados: [],
    cursorAvanzadoA: null,
  };
}

// =============================================================================
// Ventana incremental
// =============================================================================

/**
 * Ventana `[desde, hasta]` de `created_at` para la fase A.
 *
 * - Sin cursor (primera corrida, o tienda recién conectada): se barre la ventana
 *   máxima de 7 días. Ocurre UNA vez por conexión.
 * - Con cursor: `cursor - 1 h`.
 * - Nunca más de 7 días hacia atrás.
 */
export function calcularVentanaFaseA(
  cursor: Date | null,
  ahora: Date,
): { desde: Date; hasta: Date; recortada: boolean } {
  const limiteMaximo = new Date(ahora.getTime() - VENTANA_MAXIMA_DIAS * 24 * 60 * 60 * 1000);

  if (!cursor || Number.isNaN(cursor.getTime())) {
    return { desde: limiteMaximo, hasta: ahora, recortada: true };
  }

  const conSolapamiento = new Date(cursor.getTime() - SOLAPAMIENTO_MS);
  if (conSolapamiento < limiteMaximo) {
    return { desde: limiteMaximo, hasta: ahora, recortada: true };
  }
  return { desde: conSolapamiento, hasta: ahora, recortada: false };
}

// =============================================================================
// Lectura de conexiones
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizarConexiones(filas: any[]): ConexionShopifyIngesta[] {
  return filas.map((f) => ({
    id: String(f.id),
    tenantId: String(f.tenant_id),
    sellerId: String(f.seller_id),
    shopDomain: String(f.shop_domain),
    filtroEtiqueta: (f.filtro_etiqueta as string | null) ?? null,
    estadoSalud: String(f.estado_salud),
    cursorEn: (f[COLUMNA_CURSOR] as string | null) ?? null,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Conexiones Shopify de TODOS los tenants que pueden ingerir: activas, con token
 * y no desvinculadas. Una `desvinculada` no tiene token válido — la resuelve el
 * seller reconectando, no este job.
 *
 * ⚠️ `token_ref` y `cursor_ingesta_en` NO existen en la vista `public.*` y no
 * tienen grant para `authenticated`: la lectura va por `.schema("identidad")`
 * con **service_role**. Con el cliente de sesión esto devuelve 42501.
 */
export async function leerConexionesParaIngesta(
  supabase: ClienteSupabase,
): Promise<ConexionShopifyIngesta[]> {
  const { data, error } = await supabase
    .schema("identidad")
    .from(TABLA_CONEXIONES)
    .select(
      `id, tenant_id, seller_id, shop_domain, filtro_etiqueta, estado_salud, ${COLUMNA_CURSOR}`,
    )
    .eq("activa", true)
    .neq("estado_salud", "desvinculada")
    .not("token_ref", "is", null)
    // Lo más rancio primero: si alguna vez hay que acotar, se acota por aquí.
    .order(COLUMNA_CURSOR, { ascending: true, nullsFirst: true });

  if (error) {
    throw new Error(`No se pudieron leer las conexiones de Shopify: ${error.message}`);
  }

  return normalizarConexiones(data ?? []);
}

// =============================================================================
// Fase B — repaso de cancelaciones
// =============================================================================

interface PedidoRepaso {
  id: string;
  id_externo: string;
  referencia_externa: string | null;
  estado: string;
}

async function faseBRepasoCancelaciones(
  supabase: ClienteSupabase,
  conexion: ConexionShopifyIngesta,
  accessToken: string,
  ahora: Date,
  resumen: ResumenConexionShopify,
  logger: LoggerIngesta,
): Promise<void> {
  const desdeIso = new Date(ahora.getTime() - DIAS_REPASO * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .schema("operacion")
    .from("pedidos")
    .select("id, id_externo, referencia_externa, estado")
    .eq("tenant_id", conexion.tenantId)
    .eq("seller_id", conexion.sellerId)
    .eq("fuente", "shopify")
    .not("id_externo", "is", null)
    .in("estado", ESTADOS_NO_TERMINALES as string[])
    .gte("creado_en", desdeIso)
    .order("creado_en", { ascending: true })
    .limit(TOPE_PEDIDOS_REPASO);

  if (error) {
    throw new Error(`No se pudieron leer los pedidos Shopify a repasar: ${error.message}`);
  }

  const pedidos = (data ?? []) as PedidoRepaso[];
  if (pedidos.length === 0) return;

  // ⚠️ Ojo con el multi-tienda: un mismo seller puede tener varias tiendas
  // conectadas, y el filtro de arriba es por seller, no por conexión. Sin este
  // recorte, la tienda A preguntaría por los ids de la tienda B — que Shopify
  // devolvería como `null` (no existen ahí) y quedarían contados como "no
  // encontrados" en cada corrida, para siempre. `nodes` solo resuelve ids de la
  // MISMA tienda que autenticó la petición, así que la lista se recorta a lo que
  // esta tienda pudo haber traído: los GID de Shopify no dicen de qué tienda son,
  // pero el resultado sí — un id ajeno vuelve `null` y se descarta abajo.
  const porIdExterno = new Map(pedidos.map((p) => [String(p.id_externo), p]));

  const enTienda = await consultarOrdenesPorId({
    shopDomain: conexion.shopDomain,
    accessToken,
    ids: [...porIdExterno.keys()],
  });

  for (const [idExterno, pedido] of porIdExterno) {
    const orden = enTienda.get(idExterno);

    if (!orden) {
      // Shopify no lo devolvió: puede ser de otra tienda del mismo seller, un
      // borrado, o un permiso revocado. **NO se asume cancelación** — el mismo
      // criterio que con el 404 de ML: adivinar significaría cancelar pedidos
      // vivos ante un error transitorio.
      resumen.noEncontrados.push(idExterno);
      continue;
    }

    resumen.repasados += 1;

    if (!orden.canceladaEn) continue;

    const publicado = await publicarCancelacionShopify(
      {
        pedidoId: pedido.id,
        tenantId: conexion.tenantId,
        sellerId: conexion.sellerId,
        idExterno,
        referenciaExterna: orden.referenciaExterna ?? pedido.referencia_externa,
        estadoAnterior: pedido.estado,
        canceladoEnFuenteEn: orden.canceladaEn,
      },
      logger,
    );
    if (publicado) resumen.cancelacionesDetectadas += 1;
  }
}

// =============================================================================
// Rutina por conexión — la MISMA para el cron y para el botón manual
// =============================================================================

export async function sincronizarConexionShopify(
  conexion: ConexionShopifyIngesta,
  opciones: {
    ahora?: Date;
    logger?: LoggerIngesta;
    supabase?: ClienteSupabase;
  } = {},
): Promise<ResumenConexionShopify> {
  const resumen = resumenConexionVacio(conexion.id, conexion.shopDomain);
  const ahora = opciones.ahora ?? new Date();
  const logger = opciones.logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const supabase = opciones.supabase ?? (crearClienteServiceRole() as ClienteSupabase);

  if (conexion.estadoSalud === "desvinculada") {
    resumen.omitida = "desvinculada";
    return resumen;
  }

  let accessToken: string;
  try {
    accessToken = await obtenerAccessToken(conexion.id, conexion.tenantId);
  } catch {
    // El mensaje del error de descifrado NO se propaga: podría llevar fragmentos
    // del material cifrado.
    logger.warn(
      `Ingesta Shopify conexión ${conexion.id}: no se pudo obtener el token. Se omite.`,
    );
    resumen.omitida = "token_ilegible";
    await marcarSalud(conexion.id, conexion.tenantId, {
      ok: false,
      error: "No se pudo descifrar el token de la tienda. Hay que reconectarla.",
    });
    return resumen;
  }

  const ctx: ContextoIngestaShopify = {
    tenantId: conexion.tenantId,
    sellerId: conexion.sellerId,
    conexionId: conexion.id,
    shopDomain: conexion.shopDomain,
    filtroEtiqueta: conexion.filtroEtiqueta,
  };

  const cursor = conexion.cursorEn ? new Date(conexion.cursorEn) : null;
  const ventana = calcularVentanaFaseA(cursor, ahora);

  try {
    // --- Fase A ---------------------------------------------------------------
    resumen.ingesta = await ingestarVentanaShopify(supabase, ctx, accessToken, {
      desde: ventana.desde,
      hasta: ventana.hasta,
      maxPaginas: MAX_PAGINAS_INGESTA,
      logger,
    });

    // --- Cursor ---------------------------------------------------------------
    // Solo llega aquí si la fase A NO lanzó. Y si la paginación se cortó por
    // tope, el cursor igual avanza a `ventana.hasta`: lo que quedó sin mirar son
    // órdenes MÁS NUEVAS que las ya procesadas (el orden es CREATED_AT
    // ascendente), así que caen dentro de la ventana de la próxima corrida.
    const { error: errorCursor } = await supabase
      .schema("identidad")
      .from(TABLA_CONEXIONES)
      .update({ [COLUMNA_CURSOR]: ventana.hasta.toISOString() })
      .eq("id", conexion.id)
      .eq("tenant_id", conexion.tenantId);

    if (errorCursor) {
      logger.warn(
        `Ingesta Shopify conexión ${conexion.id}: no se pudo avanzar el cursor: ${errorCursor.message}`,
      );
    } else {
      resumen.cursorAvanzadoA = ventana.hasta.toISOString();
    }

    // --- Fase B ---------------------------------------------------------------
    await faseBRepasoCancelaciones(supabase, conexion, accessToken, ahora, resumen, logger);

    await marcarSalud(conexion.id, conexion.tenantId, { ok: true });
  } catch (error) {
    // El detalle crudo puede traer jerga de GraphQL, pero NUNCA el token: el
    // cliente HTTP lo construye en el último momento y no lo mete en el error.
    const mensaje = error instanceof Error ? error.message : String(error);
    resumen.error = mensaje;
    logger.error(`Ingesta Shopify conexión ${conexion.id}: ${mensaje}`);
    await marcarSalud(conexion.id, conexion.tenantId, { ok: false, error: mensaje });
  }

  // El token en claro sale de scope aquí.
  return resumen;
}

// =============================================================================
// Visibilidad de lo que NO se resolvió
// =============================================================================

/**
 * Deja a la vista de un humano los pedidos que Shopify no devolvió en el repaso.
 * Solo ids de orden (GID) — no son dato personal. Tres canales: log del run,
 * observabilidad central y el resumen que la telemetría persiste en
 * `infra.ejecuciones_job` (lo que muestra `admin/salud`).
 */
async function reportarNoEncontrados(
  ids: string[],
  contexto: { origen: string; tenantId?: string },
  logger: LoggerIngesta,
): Promise<void> {
  if (ids.length === 0) return;
  const muestra = ids.slice(0, 20);
  logger.error(
    `Ingesta Shopify: ${ids.length} pedidos no aparecieron en su tienda al repasarlos y NO se ` +
      `tocó su estado (que una orden no aparezca no prueba una cancelación). Órdenes: ${muestra.join(", ")}` +
      (ids.length > muestra.length ? ` …(+${ids.length - muestra.length})` : ""),
  );
  await capturarMensaje(
    `Ingesta Shopify: ${ids.length} órdenes sin resolver en el repaso`,
    "warning",
    {
      origen: contexto.origen,
      ...(contexto.tenantId ? { tenantId: contexto.tenantId } : {}),
      etiquetas: { motivo: "shopify_orden_no_encontrada" },
      extra: { idsExternos: muestra, total: ids.length },
    },
  );
}

/** Suma los resúmenes por conexión en los totales del run. */
export function agregarResumenes(
  resultados: Array<PromiseSettledResult<ResumenConexionShopify>>,
): {
  leidos: number;
  insertados: number;
  actualizados: number;
  omitidos: number;
  fueraDeCobertura: number;
  sinDireccion: number;
  sinTarifa: number;
  repasados: number;
  cancelacionesDetectadas: number;
  erroresPersistencia: number;
  conexionesConError: number;
  noEncontrados: string[];
} {
  const totales = {
    leidos: 0,
    insertados: 0,
    actualizados: 0,
    omitidos: 0,
    fueraDeCobertura: 0,
    sinDireccion: 0,
    sinTarifa: 0,
    repasados: 0,
    cancelacionesDetectadas: 0,
    erroresPersistencia: 0,
    conexionesConError: 0,
    noEncontrados: [] as string[],
  };

  for (const r of resultados) {
    if (r.status !== "fulfilled" || !r.value) {
      totales.conexionesConError += 1;
      continue;
    }
    const v = r.value;
    if (v.error) totales.conexionesConError += 1;
    totales.leidos += v.ingesta.totalLeidos;
    totales.insertados += v.ingesta.totalInsertados;
    totales.actualizados += v.ingesta.totalActualizados;
    totales.omitidos += v.ingesta.totalOmitidos;
    totales.fueraDeCobertura += v.ingesta.totalFueraDeCobertura;
    totales.sinDireccion += v.ingesta.totalSinDireccion;
    totales.sinTarifa += v.ingesta.totalSinTarifa;
    totales.erroresPersistencia += v.ingesta.erroresPersistencia;
    totales.repasados += v.repasados;
    totales.cancelacionesDetectadas += v.cancelacionesDetectadas;
    totales.noEncontrados.push(...v.noEncontrados);
  }

  return totales;
}

// =============================================================================
// Jobs
// =============================================================================

export const jobIngestaPedidosShopify = inngest.createFunction(
  {
    id: "shopify/ingestaPedidos",
    name: "Shopify · Ingesta continua de pedidos (cron)",
    triggers: [{ cron: CRON_INGESTA_SHOPIFY }],
    // Una sola corrida a la vez: si una se demora más de 15 min, la siguiente
    // espera en vez de duplicar llamadas contra las mismas tiendas (y de competir
    // por el mismo balde de puntos de cada tienda).
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step, logger }) => {
    const conexiones = await step.run("leer-conexiones", async () => {
      const supabase = crearClienteServiceRole() as ClienteSupabase;
      return leerConexionesParaIngesta(supabase);
    });

    logger.info(`Ingesta Shopify: ${conexiones.length} tiendas activas a sincronizar.`);

    const resultados = await Promise.allSettled(
      conexiones.map((conexion) =>
        step.run(`ingesta:conexion:${conexion.id}`, async () =>
          sincronizarConexionShopify(conexion, { logger }),
        ),
      ),
    );

    const totales = agregarResumenes(resultados);
    await reportarNoEncontrados(
      totales.noEncontrados,
      { origen: "job:shopify/ingestaPedidos" },
      logger,
    );

    logger.info(
      `Ingesta Shopify completada: ${totales.insertados} pedidos nuevos, ` +
        `${totales.actualizados} actualizados, ${totales.omitidos} omitidos ` +
        `(${totales.fueraDeCobertura} fuera de cobertura), ${totales.sinTarifa} sin tarifa, ` +
        `${totales.cancelacionesDetectadas} cancelaciones detectadas.`,
    );

    return {
      conexiones: conexiones.length,
      ...totales,
      noEncontrados: totales.noEncontrados.slice(0, 20),
      totalNoEncontrados: totales.noEncontrados.length,
    };
  },
);

export const jobSincronizarConexionShopify = inngest.createFunction(
  {
    id: "shopify/sincronizarConexion",
    name: "Shopify · Sincronizar una tienda (solicitud manual)",
    triggers: [{ event: "shopify/sincronizacion.solicitada" }],
    // Un barrido por conexión a la vez: dos clics simultáneos no duplican
    // llamadas ni compiten por el mismo cursor.
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

    // Se relee por el MISMO camino que el cron —misma consulta, mismos filtros—
    // para que "sincronizar ahora" no pueda alcanzar una conexión que el cron
    // considera no sincronizable.
    const conexion = await step.run("leer-conexion", async () => {
      const supabase = crearClienteServiceRole() as ClienteSupabase;
      const conexiones = await leerConexionesParaIngesta(supabase);
      return conexiones.find((c) => c.id === conexionId && c.tenantId === tenantId) ?? null;
    });

    if (!conexion) {
      logger.warn(
        `Sincronización manual: la conexión Shopify ${conexionId} no está activa (dada de baja, ` +
          "desvinculada o sin token). No hay nada que sincronizar.",
      );
      return { resultado: "conexion_no_sincronizable", conexionId };
    }

    // EXACTAMENTE la misma rutina que el cron. No hay un camino manual que pueda
    // divergir del automático.
    const resumen = await step.run("sincronizar", async () =>
      sincronizarConexionShopify(conexion, { logger }),
    );

    await reportarNoEncontrados(
      resumen.noEncontrados,
      { origen: "job:shopify/sincronizarConexion", tenantId },
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
