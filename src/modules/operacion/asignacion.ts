/**
 * Bandeja de asignación en bloque — capa de LECTURA, etapa 6 del alcance
 * "retiro en bodega + ruteo" (docs/arquitectura/retiro-y-ruteo.md §4,
 * docs/ux/etapa-6-asignacion-en-bloque.md).
 *
 * Este archivo SOLO lee. La escritura (asignar/reasignar un lote a un
 * conductor) vive en `operacion.asignar_pedidos_en_bloque`
 * (`supabase/migrations/20260814000001_operacion_asignacion_en_bloque.sql`),
 * una función SQL transaccional que este módulo NO llama todavía — eso es
 * trabajo de `manifiestos.ts` / la Server Action, a propósito fuera de este
 * archivo (ver el mensaje que encargó esta etapa).
 *
 * =============================================================================
 * LAS DOS REJAS, SIEMPRE JUNTAS
 * =============================================================================
 * Toda consulta de este módulo filtra por `situacion_retiro = 'retirado'` Y
 * `estado IN ('pendiente_asignacion', 'asignado')` — nunca una sola:
 *
 *   · `situacion_retiro = 'retirado'` es LA reja de la etapa (migración
 *     20260812000002): un seller despacha con VARIOS couriers, así que la
 *     ingesta de ML trae CANDIDATOS, no una lista comprometida con este
 *     courier. Solo el escaneo en bodega dice cuáles son de este courier hoy.
 *   · `estado IN (pendiente_asignacion, asignado)` excluye lo que ya salió a
 *     la calle (`en_ruta`) o llegó a un estado terminal.
 *
 * `ESTADOS_ASIGNABLES` es la única fuente de verdad del segundo conjunto —
 * ninguna consulta de este archivo lo reconstruye a mano.
 *
 * =============================================================================
 * QUÉ SIGNIFICA "fecha" AQUÍ — Y POR QUÉ NO ES LO MISMO EN TODAS LAS FUNCIONES
 * =============================================================================
 * Dos conceptos de "hoy" conviven en este módulo, a propósito y NO por
 * descuido:
 *
 *   1. Para la BANDEJA (`listarPedidosAsignables`, `resolverIdsAsignables`,
 *      `listarComunasConAsignables`, `contarAsignablesSinAsignar`): la fecha
 *      acota `pedidos.retirado_en`, y **solo por arriba** — todo lo retirado
 *      HASTA el final de ese día civil de Santiago, no solo lo de ese día.
 *
 *      ⚠️ EL LÍMITE INFERIOR SE QUITÓ A PROPÓSITO, y es la diferencia entre
 *      una bandeja honesta y una que pierde paquetes. Con el rango cerrado
 *      `[hoy, mañana)`, un pedido retirado AYER que nunca llegó a asignarse
 *      quedaba **invisible para siempre**: está físicamente en la bodega,
 *      sigue `pendiente_asignacion`, y ninguna pantalla lo vuelve a ofrecer.
 *      Nadie lo despacha y nadie se entera. Hoy eso puede pasar porque el
 *      cierre de jornada (etapa 10) todavía no existe: no hay ningún proceso
 *      que resuelva lo que quedó colgando al final del día.
 *
 *      Acotar solo por arriba no ensucia la bandeja: la segunda reja
 *      (`estado in (pendiente_asignacion, asignado)`) ya deja fuera todo lo
 *      que salió a la calle. Lo que sobrevive a las dos rejas está de verdad
 *      esperando en la bodega, tenga la antigüedad que tenga.
 *
 *      Deliberadamente se usa `retirado_en`, la misma columna sobre la que se
 *      construyó el índice parcial
 *      `idx_pedidos_retirados_por_asignar (tenant_id, retirado_en desc)
 *      where situacion_retiro='retirado' and estado='pendiente_asignacion'`
 *      (20260812000002 §4): la base ya anticipa que se filtra por ahí.
 *
 *      Deliberadamente NO se usa `fecha_compromiso` para la bandeja: es la
 *      fecha que PROMETE Mercado Libre, y para Flex puede caer días después
 *      del retiro real — el propio `asignar_pedidos_en_bloque` (el lado de
 *      escritura) se niega explícitamente a filtrar por ella ("la fecha que
 *      ML manda... puede caer días después; lo que decide qué se reparte hoy
 *      es lo que está en el piso de la bodega"). Repetir ese filtro acá haría
 *      desaparecer pedidos reales de la bandeja sin un solo error.
 *
 *   2. Para `obtenerCargaConductoresDelDia` (cuánto lleva cada conductor HOY,
 *      para no sobrecargarlo en el selector): se usa `fecha_compromiso`,
 *      exactamente el mismo campo y el mismo criterio que
 *      `auto-asignacion.ts:obtenerCargaPoolDelDia` — la función hermana que
 *      ya resuelve este problema para la redistribución por caída de
 *      conductor. Dos funciones con el mismo propósito ("no sobrecargar a un
 *      conductor hoy") deben coincidir en qué cuenta como "hoy", o el mismo
 *      conductor mostraría una carga distinta en dos pantallas el mismo día.
 *      Igual que allá, SIN el filtro de fecha + estado no-terminal, el
 *      conteo sumaría TODO el histórico de `driver_id_asignado` — esa
 *      columna NO se limpia al entregar (deuda documentada en
 *      docs/arquitectura/retiro-y-ruteo-plan.md, "La marca de asignación que
 *      no se apaga") y sigue apuntando al conductor para siempre.
 *
 * `retirado_en` puede ser NULL incluso con `situacion_retiro = 'retirado'`
 * en las filas que preceden a la migración 20260812000002 (el respaldo
 * histórico documentado ahí: "todo lo que ya existía queda `retirado`, con
 * la fecha en NULL porque el instante no se conoce"). Esas filas nunca
 * calzan un rango de fecha y por lo tanto no aparecen en ninguna bandeja de
 * ningún día — es un artefacto de migración ya documentado, no un bug nuevo
 * de este archivo.
 *
 * =============================================================================
 * LA COMUNA SE COMPARA CANONIZADA — mismo criterio que retiro/preparacion.ts
 * =============================================================================
 * `destinatario_comuna` NO está canonizada en el camino Flex (98% del
 * volumen): la ingesta la guarda tal como la manda Mercado Libre
 * (`integraciones/ml/ingesta-pedidos.ts:737`), así que "Ñuñoa" y "NUÑOA"
 * conviven como dos textos distintos en la misma tabla. Un `.in()` crudo con
 * el nombre canónico pierde esas variantes.
 *
 * La resolución (`resolverVariantesCrudasDeComunas`) hace dos pasos: primero
 * lee TODAS las comunas crudas de hoy que cumplen las dos rejas (paginado,
 * nunca una consulta suelta — ver más abajo), agrupa cada una contra
 * `COMUNAS_RM` con `resolverComunaCanonica` (fallback a la etiqueta cruda si
 * la comuna cae fuera de la RM, igual que `preparacion.ts`), y solo entonces
 * arma el `.in('destinatario_comuna', variantesCrudas)` real. Es el mismo
 * costo que `listarComunasConAsignables` ya paga para alimentar el filtro:
 * cuando el coordinador filtra por comuna, este módulo vuelve a pagarlo una
 * vez más — aceptable a la escala del piloto (~30 comunas, cientos de
 * pedidos/día), y la alternativa (instalar `unaccent` por esto) ya se evaluó
 * y se descartó en `preparacion.ts`.
 *
 * =============================================================================
 * POSTGREST CORTA EN 1.000 FILAS SIN AVISAR
 * =============================================================================
 * Toda lectura que puede devolver más de una página (`resolverIdsAsignables`,
 * la resolución de comunas crudas, la carga por conductor) va por
 * `leerTodasLasFilas` (`src/lib/supabase/leer-paginado.ts`), nunca por un
 * `.select()` suelto. El total de `listarPedidosAsignables` usa siempre
 * `count: 'exact'` — nunca `.length` de la página, que ya mintió una vez en
 * la pantalla que esta etapa reemplaza (`/manifiestos/[id]/asignar`
 * imprimía "N pedidos disponibles" con el largo truncado en 100).
 *
 * =============================================================================
 * SIN DATOS PERSONALES DEL DESTINATARIO
 * =============================================================================
 * Ninguna consulta de este archivo selecciona `destinatario_nombre`,
 * `destinatario_direccion`, `destinatario_telefono`, `instrucciones_entrega`,
 * `tracking_token`, `lat`/`long`, ni nada de `bultos_retiro_qr`
 * (`hash_code`, el string del QR). El código visible es
 * `ml_shipment_id ?? codigo_interno` — nunca `tracking_token`, que es
 * PÚBLICO (viaja en la URL /tracking/[token] que se comparte con el
 * destinatario) y por eso NO sirve como identificador interno.
 *
 * =============================================================================
 * AISLAMIENTO: `tenant_id` EXPLÍCITO EN CADA CONSULTA
 * =============================================================================
 * Igual que `auto-asignacion.ts` y `retiro/preparacion.ts`: este módulo
 * recibe un `cliente` ya construido por el llamador (normalmente
 * `crearClienteServiceRole()`) y nunca confía en RLS/claims — cada consulta
 * lleva su propio `.eq('tenant_id', ...)`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { limitesDelDiaSantiago } from "@/lib/fecha-santiago";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import { resolverComunaCanonica } from "@/modules/integraciones/geocoding/normalizacion";
import { resolverNombresSellers } from "./retiro/dto-pedido";
import { mapaNombresConductores } from "@/modules/identidad/consultas";
import { ESTADOS_TERMINALES_PEDIDO } from "./metricas";

// =============================================================================
// La segunda reja — fuente de verdad única
// =============================================================================

/** Único conjunto de estados que puede aparecer en la bandeja de asignación. */
export type EstadoAsignable = "pendiente_asignacion" | "asignado";

export const ESTADOS_ASIGNABLES: readonly EstadoAsignable[] = [
  "pendiente_asignacion",
  "asignado",
];

// =============================================================================
// Contrato público
// =============================================================================

export interface PedidoAsignable {
  pedidoId: string;
  /** ml_shipment_id ?? codigo_interno. NUNCA tracking_token: ése es público. */
  codigoVisible: string;
  comuna: string | null;
  sellerId: string;
  sellerNombre: string | null;
  estado: EstadoAsignable;
  conductorActualId: string | null;
  conductorActualNombre: string | null;
}

export interface FiltroAsignables {
  tenantId: string;
  fecha: string;
  /** Vacío = todas. Multi-selección. */
  comunas?: readonly string[];
  sellerId?: string | null;
  /** Texto libre contra el código visible, `ilike '%texto%'`. */
  texto?: string | null;
  /** Sin valor = ambos. */
  estado?: EstadoAsignable | null;
}

// =============================================================================
// Helpers privados — texto libre
// =============================================================================

/**
 * Deja el texto libre apto para `ilike`/`.or()` de PostgREST: quita los
 * caracteres que rompen el parser del filtro (`,` `.` `(` `)`) y los
 * comodines (`%` `_`), colapsa espacios y acota el largo. Mismo criterio que
 * `sanitizar()` en `src/app/api/buscar/route.ts` — se duplica en vez de
 * importarse porque ese archivo vive bajo `src/app/` (fuera del alcance de
 * este módulo) y un módulo de `src/modules` no debe depender de una ruta HTTP.
 */
function sanitizarTextoIlike(texto: string): string {
  return texto
    .replace(/[,.()%_*\\"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// =============================================================================
// Helpers privados — comuna canonizada
// =============================================================================

/** Fila mínima para agrupar comunas — un solo campo, sin traer nada más. */
interface FilaComunaCruda {
  destinatario_comuna: string;
}

/**
 * Lee, paginado, TODAS las comunas crudas (una entrada por pedido, con
 * repeticiones) de los pedidos que hoy cumplen las dos rejas. Es la base
 * compartida de `listarComunasConAsignables` y de la resolución de variantes
 * para el filtro — un solo lugar que sabe qué gobierna "hoy" y las dos rejas
 * para este propósito.
 */
async function leerComunasCrudasDeAsignables(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: string,
): Promise<string[]> {
  const { hasta } = limitesDelDiaSantiago(fecha);

  const filas = await leerTodasLasFilas<FilaComunaCruda>(
    "comunas de pedidos asignables",
    (ini, fin) =>
      cliente
        .schema("operacion")
        .from("pedidos")
        .select("destinatario_comuna")
        .eq("tenant_id", tenantId)
        .eq("situacion_retiro", "retirado")
        .in("estado", ESTADOS_ASIGNABLES)
        .lt("retirado_en", hasta.toISOString())
        .order("id", { ascending: true })
        .range(ini, fin),
  );

  return filas.map((f) => f.destinatario_comuna);
}

/**
 * Clave de fusión de una comuna cruda: la canónica del catálogo `COMUNAS_RM`
 * si resuelve, o la propia etiqueta cruda si cae fuera de la RM (nunca se
 * descarta ni se manda a un grupo "desconocido" — mismo criterio que
 * `retiro/preparacion.ts:obtenerCargaPorComuna`).
 */
function claveComunaFusion(comunaCruda: string): string {
  return resolverComunaCanonica(comunaCruda) ?? comunaCruda;
}

/**
 * Dado el conjunto de comunas CANÓNICAS pedidas como filtro, resuelve todas
 * las variantes CRUDAS de `destinatario_comuna` que hoy fusionan a ellas.
 * Sin esto, `.in('destinatario_comuna', ['Maipú'])` pierde toda fila cuyo
 * texto crudo sea "MAIPU" o "Maipu".
 *
 * Devuelve `[]` si ninguna comuna cruda de hoy cae en el conjunto pedido —
 * el llamador debe tratar eso como "cero resultados", nunca como "sin
 * filtro" (un `.in()` con lista vacía es ambiguo y por eso no se emite).
 */
async function resolverVariantesCrudasDeComunas(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: string,
  comunasCanonicas: readonly string[],
): Promise<string[]> {
  const objetivo = new Set(comunasCanonicas);
  const crudas = await leerComunasCrudasDeAsignables(cliente, tenantId, fecha);

  const variantes = new Set<string>();
  for (const cruda of crudas) {
    if (cruda.trim() === "") continue; // "sin comuna" nunca es un valor de filtro válido aquí.
    if (objetivo.has(claveComunaFusion(cruda))) variantes.add(cruda);
  }

  return [...variantes];
}

// =============================================================================
// listarComunasConAsignables
// =============================================================================

/** Comunas con al menos un asignable hoy, con su conteo. Alimenta el filtro multi. */
export async function listarComunasConAsignables(
  cliente: SupabaseClient,
  entrada: { tenantId: string; fecha: string },
): Promise<{ comuna: string | null; total: number }[]> {
  const crudas = await leerComunasCrudasDeAsignables(cliente, entrada.tenantId, entrada.fecha);

  const grupos = new Map<string, number>();
  let sinComuna = 0;

  for (const cruda of crudas) {
    if (cruda.trim() === "") {
      sinComuna += 1;
      continue;
    }
    const clave = claveComunaFusion(cruda);
    grupos.set(clave, (grupos.get(clave) ?? 0) + 1);
  }

  // Mayor volumen primero (para que el coordinador encuentre rápido la
  // comuna con más carga); empate resuelto alfabéticamente para que el orden
  // sea determinista y no dependa del orden de llegada de las filas.
  const resultado: { comuna: string | null; total: number }[] = [...grupos.entries()]
    .sort(([comunaA, totalA], [comunaB, totalB]) =>
      totalB !== totalA ? totalB - totalA : comunaA.localeCompare(comunaB, "es"),
    )
    .map(([comuna, total]) => ({ comuna, total }));

  // "Sin comuna conocida" va SIEMPRE al final, aunque tenga más pedidos que
  // cualquier comuna real — no es un destino al que mandar conductores, es
  // una excepción a resolver (mismo criterio que preparacion.ts).
  if (sinComuna > 0) resultado.push({ comuna: null, total: sinComuna });

  return resultado;
}

// =============================================================================
// listarPedidosAsignables / resolverIdsAsignables — filas crudas y su DTO
// =============================================================================

const COLUMNAS_PEDIDO_ASIGNABLE =
  "id, ml_shipment_id, codigo_interno, destinatario_comuna, seller_id, estado, driver_id_asignado";

interface FilaPedidoAsignable {
  id: string;
  ml_shipment_id: string | null;
  codigo_interno: string | null;
  destinatario_comuna: string;
  seller_id: string;
  estado: string;
  driver_id_asignado: string | null;
}

function filaAPedidoAsignable(
  fila: FilaPedidoAsignable,
  nombresSellers: Map<string, string>,
  nombresConductores: Record<string, string>,
): PedidoAsignable {
  const comuna = fila.destinatario_comuna.trim() === "" ? null : fila.destinatario_comuna;
  const conductorActualId = fila.driver_id_asignado;

  return {
    pedidoId: fila.id,
    // Misma regla que la Torre y que retiro/dto-pedido.ts — nunca tracking_token.
    codigoVisible: fila.ml_shipment_id ?? fila.codigo_interno ?? "",
    comuna,
    sellerId: fila.seller_id,
    sellerNombre: nombresSellers.get(fila.seller_id) ?? null,
    // Seguro por construcción: toda consulta de este archivo filtra
    // `estado IN ESTADOS_ASIGNABLES`, así que el valor crudo SIEMPRE cae en
    // el subconjunto de dos valores del tipo angosto.
    estado: fila.estado as EstadoAsignable,
    conductorActualId,
    conductorActualNombre: conductorActualId
      ? (nombresConductores[conductorActualId] ?? null)
      : null,
  };
}

/**
 * Aplica, EN ORDEN, los cuatro filtros opcionales de `FiltroAsignables` sobre
 * una consulta ya posicionada en `operacion.pedidos` con las dos rejas y el
 * rango de fecha ya puestos. `variantesComuna` es `null` cuando no hay filtro
 * de comuna, y un arreglo (posiblemente ya resuelto y no vacío — el llamador
 * corta antes si da `[]`) cuando sí lo hay.
 *
 * Tipado con un genérico mínimo (solo los métodos que de verdad se usan) en
 * vez del tipo concreto de `PostgrestFilterBuilder`: así la misma función
 * sirve tanto a la consulta paginada de `listarPedidosAsignables` (que además
 * pide `count: 'exact'`) como a la de `resolverIdsAsignables` (que solo trae
 * `id`), sin duplicar esta lógica dos veces y arriesgar que diverja.
 */
function aplicarFiltrosDeSeleccion<
  Q extends {
    eq(columna: string, valor: unknown): Q;
    in(columna: string, valores: readonly unknown[]): Q;
    or(filtro: string): Q;
  },
>(query: Q, filtro: FiltroAsignables, variantesComuna: readonly string[] | null): Q {
  let resultado = query;

  if (filtro.estado) {
    resultado = resultado.eq("estado", filtro.estado);
  }
  if (filtro.sellerId) {
    resultado = resultado.eq("seller_id", filtro.sellerId);
  }
  if (variantesComuna) {
    resultado = resultado.in("destinatario_comuna", variantesComuna);
  }
  if (filtro.texto && filtro.texto.trim() !== "") {
    const limpio = sanitizarTextoIlike(filtro.texto);
    if (limpio !== "") {
      const patron = `%${limpio}%`;
      resultado = resultado.or(`ml_shipment_id.ilike.${patron},codigo_interno.ilike.${patron}`);
    }
  }

  return resultado;
}

/**
 * Resuelve, para el filtro de comuna del contrato, la lista de variantes
 * crudas a usar en `.in()` — o `null` si no hay filtro de comuna puesto.
 * Devuelve un símbolo propio (`SIN_COINCIDENCIAS`) cuando SÍ hay filtro pero
 * ninguna comuna cruda de hoy cae en él, para que el llamador corte antes de
 * construir una consulta con `.in('destinatario_comuna', [])` ambigua.
 */
const SIN_COINCIDENCIAS = Symbol("sin coincidencias de comuna");

async function resolverFiltroComuna(
  cliente: SupabaseClient,
  filtro: FiltroAsignables,
): Promise<string[] | null | typeof SIN_COINCIDENCIAS> {
  if (!filtro.comunas || filtro.comunas.length === 0) return null;

  const variantes = await resolverVariantesCrudasDeComunas(
    cliente,
    filtro.tenantId,
    filtro.fecha,
    filtro.comunas,
  );
  return variantes.length === 0 ? SIN_COINCIDENCIAS : variantes;
}

/** Una página, con el TOTAL REAL del filtro (no el largo de la página). */
export async function listarPedidosAsignables(
  cliente: SupabaseClient,
  filtro: FiltroAsignables,
  paginacion: { pagina: number; porPagina: number },
): Promise<{ pedidos: PedidoAsignable[]; total: number }> {
  const variantesComuna = await resolverFiltroComuna(cliente, filtro);
  if (variantesComuna === SIN_COINCIDENCIAS) {
    return { pedidos: [], total: 0 };
  }

  const { hasta } = limitesDelDiaSantiago(filtro.fecha);
  const offset = (paginacion.pagina - 1) * paginacion.porPagina;

  let query = cliente
    .schema("operacion")
    .from("pedidos")
    .select(COLUMNAS_PEDIDO_ASIGNABLE, { count: "exact" })
    .eq("tenant_id", filtro.tenantId)
    .eq("situacion_retiro", "retirado")
    .in("estado", ESTADOS_ASIGNABLES)
    .lt("retirado_en", hasta.toISOString());

  query = aplicarFiltrosDeSeleccion(query, filtro, variantesComuna);

  // Orden por defecto: comuna, luego código — un rango contiguo en pantalla
  // es un rango contiguo en la realidad. `destinatario_comuna` es la columna
  // CRUDA (mismo límite conocido que en pedidos.ts: no resuelve acentos en el
  // orden, solo en el filtro). "Código" no es una sola columna
  // (`ml_shipment_id ?? codigo_interno`) y PostgREST no ordena por una
  // expresión: se ordena por las dos por separado, NULLS LAST, así que dentro
  // de cada comuna los Flex (con ml_shipment_id) van primero y los same-day
  // después — determinista, aunque no sea una intercalación alfabética única
  // de "código visible". `id` cierra como desempate absoluto.
  const { data, error, count } = await query
    .order("destinatario_comuna", { ascending: true })
    .order("ml_shipment_id", { ascending: true, nullsFirst: false })
    .order("codigo_interno", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .range(offset, offset + paginacion.porPagina - 1);

  if (error) {
    throw new Error(`Error al listar pedidos asignables: ${error.message}`);
  }

  const filas = (data ?? []) as unknown as FilaPedidoAsignable[];

  const sellerIds = [...new Set(filas.map((f) => f.seller_id))];
  const conductorIds = [
    ...new Set(
      filas
        .map((f) => f.driver_id_asignado)
        .filter((id): id is string => id !== null),
    ),
  ];

  const [nombresSellers, nombresConductores] = await Promise.all([
    resolverNombresSellers(cliente, filtro.tenantId, sellerIds),
    mapaNombresConductores(cliente, filtro.tenantId, conductorIds),
  ]);

  return {
    pedidos: filas.map((fila) => filaAPedidoAsignable(fila, nombresSellers, nombresConductores)),
    total: count ?? 0,
  };
}

/** TODOS los ids que cumplen el filtro — para "Seleccionar los N". */
export async function resolverIdsAsignables(
  cliente: SupabaseClient,
  filtro: FiltroAsignables,
): Promise<string[]> {
  const variantesComuna = await resolverFiltroComuna(cliente, filtro);
  if (variantesComuna === SIN_COINCIDENCIAS) return [];

  const { hasta } = limitesDelDiaSantiago(filtro.fecha);

  const filas = await leerTodasLasFilas<{ id: string }>(
    "ids de pedidos asignables",
    (ini, fin) => {
      let query = cliente
        .schema("operacion")
        .from("pedidos")
        .select("id")
        .eq("tenant_id", filtro.tenantId)
        .eq("situacion_retiro", "retirado")
        .in("estado", ESTADOS_ASIGNABLES)
        .lt("retirado_en", hasta.toISOString());

      query = aplicarFiltrosDeSeleccion(query, filtro, variantesComuna);

      return query.order("id", { ascending: true }).range(ini, fin);
    },
  );

  return filas.map((f) => f.id);
}

// =============================================================================
// obtenerCargaConductoresDelDia
// =============================================================================

/**
 * Carga de hoy por conductor, para el selector. Solo estados abiertos (el
 * complemento de `ESTADOS_TERMINALES_PEDIDO` — mismo conjunto que
 * `auto-asignacion.ts:obtenerCargaPoolDelDia`, con el mismo criterio de
 * fecha: `fecha_compromiso`, NO `retirado_en`. Ver la nota de cabecera de
 * este archivo sobre por qué esta función difiere del resto del módulo.
 *
 * Usa `pedidos.driver_id_asignado` (denormalizado, mantenido por
 * `trg_asignaciones_sincronizar_driver_id`) en vez de unir contra
 * `asignaciones_pedido`: es la vía más barata y ya la usa
 * `filaAPedidoAsignable` para el mismo dato a nivel de fila.
 */
export async function obtenerCargaConductoresDelDia(
  cliente: SupabaseClient,
  entrada: { tenantId: string; fecha: string },
): Promise<Map<string, number>> {
  const mapaCarga = new Map<string, number>();

  const filas = await leerTodasLasFilas<{ driver_id_asignado: string }>(
    "carga de conductores del día",
    (ini, fin) =>
      cliente
        .schema("operacion")
        .from("pedidos")
        .select("driver_id_asignado")
        .eq("tenant_id", entrada.tenantId)
        .not("driver_id_asignado", "is", null)
        .eq("fecha_compromiso", entrada.fecha)
        .not("estado", "in", `(${ESTADOS_TERMINALES_PEDIDO.join(",")})`)
        .order("id", { ascending: true })
        .range(ini, fin),
  );

  for (const fila of filas) {
    mapaCarga.set(fila.driver_id_asignado, (mapaCarga.get(fila.driver_id_asignado) ?? 0) + 1);
  }

  return mapaCarga;
}

// =============================================================================
// contarAsignablesSinAsignar
// =============================================================================

/**
 * Cuántos asignables SIN asignar hay hoy. Alimenta el bloque de
 * `/preparacion` (§11 del diseño: "66 pedidos retirados sin asignar" /
 * "Todo lo retirado hoy ya está asignado."). `estado = 'pendiente_asignacion'`
 * es un subconjunto estricto de `ESTADOS_ASIGNABLES` — sigue cumpliendo la
 * segunda reja sin necesidad de repetir el `.in()` completo.
 */
export async function contarAsignablesSinAsignar(
  cliente: SupabaseClient,
  entrada: { tenantId: string; fecha: string },
): Promise<number> {
  const { hasta } = limitesDelDiaSantiago(entrada.fecha);

  const { count, error } = await cliente
    .schema("operacion")
    .from("pedidos")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", entrada.tenantId)
    .eq("situacion_retiro", "retirado")
    .eq("estado", "pendiente_asignacion")
    .lt("retirado_en", hasta.toISOString());

  if (error) {
    throw new Error(`Error al contar asignables sin asignar: ${error.message}`);
  }

  return count ?? 0;
}
