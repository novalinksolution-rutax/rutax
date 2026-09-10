/**
 * Agregación de telemetría de consumo (backstage `/admin/consumo`).
 * =============================================================================
 * Lectura sobre `infra.eventos_consumo`/`infra.precios_consumo` — SOLO admin,
 * cross-tenant, mismo patrón que `metricas-uso.ts`/`metricas-negocio.ts`: esta
 * función NO verifica `tieneSesionAdmin()` por sí misma, el LLAMADOR
 * (`/admin/consumo/**`) debe exigirlo ANTES de invocarla.
 *
 * NOMBRE DEL ARCHIVO: el diseño (`docs/arquitectura/consumo-telemetria.md`)
 * pide `src/modules/plataforma/consumo/` como directorio, junto a
 * `metricas-uso.ts`. Ya existe `src/modules/plataforma/consumo.ts` (consumo
 * del TENANT contra los límites de su plan — un concepto distinto: "cuánto
 * gastó Rutax en APIs" vs. "cuánto usó el courier de su plan"). Un archivo y
 * un directorio no pueden compartir nombre en la resolución de módulos de
 * TypeScript/Node (`./consumo` resolvería siempre al `.ts`, nunca al
 * `consumo/index.ts`), así que este módulo vive en un archivo hermano,
 * `consumo-agregado.ts`, en vez del directorio que pedía el diseño.
 *
 * FUENTES — TODO vía RPCs `security definer` de la migración `20260909000001`,
 * NUNCA con `.schema('infra')` directo: el esquema `infra` no está expuesto a
 * PostgREST (y config.toml no aplica al hosted), así que un acceso directo
 * fallaría en prod con PGRST106. Ventana SIEMPRE semiabierta `[desde, hasta)`.
 * - `consumo_por_courier`/`consumo_por_conductor`/`consumo_por_proveedor` —
 *   agregados por courier / conductor / proveedor.
 * - `consumo_uso_por_tipo(desde, hasta)` — agrega por `tipo_evento × usuario ×
 *   proveedor`. Cubre "costo por entrega" (cuenta `entrega.cerrar`) y los KPIs
 *   de Uso (reoptimizaciones/conductor, reordenamientos, ratio local-vs-proveedor).
 * - `consumo_precios_vigentes(hasta)` — `free_tier_mensual` vigente por
 *   proveedor+sku (el más reciente con `vigente_desde <= hasta`).
 *
 * TODO (fuera de este alcance, anotado en el diseño): el cron de compactación
 * mensual (`infra.consumo_mensual`) no existe todavía — este módulo lee
 * siempre el crudo de `infra.eventos_consumo` (retención ~90 días), que basta
 * para los tableros v1 (tiempo real, sin tendencia histórica de más de 3
 * meses).
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';

type ClienteServiceRole = ReturnType<typeof crearClienteServiceRole>;

/** Ventana de agregación, siempre semiabierta `[desde, hasta)`. ISO 8601. */
export interface VentanaConsumo {
  desde: string;
  hasta: string;
}

// =============================================================================
// Tipos de las tres RPCs (lectura tal cual las devuelve la base)
// =============================================================================

export interface ConsumoPorCourier {
  tenantId: string | null;
  eventos: number;
  totalUnidades: number;
  totalCostoUsd: number;
}

export interface ConsumoPorConductor {
  usuarioId: string | null;
  eventos: number;
  totalUnidades: number;
  totalCostoUsd: number;
}

export interface ConsumoPorProveedor {
  proveedorCosto: string | null;
  sku: string | null;
  eventos: number;
  totalUnidades: number;
  totalCostoUsd: number;
  /** `null` si el proveedor+sku no tiene tarifario vigente (evento sin costo, p. ej. motor local). */
  freeTierMensual: number | null;
  /** `totalUnidades / freeTierMensual * 100`, o `null` si no hay `freeTierMensual` definido. */
  porcentajeFreeTier: number | null;
}

// =============================================================================
// Llamadas directas a las RPCs — una función por RPC, tipos ya mapeados
// =============================================================================

interface FilaRpcCourier {
  tenant_id: string | null;
  eventos: number | string;
  total_unidades: number | string;
  total_costo_usd: number | string;
}

interface FilaRpcConductor {
  usuario_id: string | null;
  eventos: number | string;
  total_unidades: number | string;
  total_costo_usd: number | string;
}

interface FilaRpcProveedor {
  proveedor_costo: string | null;
  sku: string | null;
  eventos: number | string;
  total_unidades: number | string;
  total_costo_usd: number | string;
}

/** Agregado de consumo por courier (tenant) en la ventana. */
export async function obtenerConsumoPorCourier(
  ventana: VentanaConsumo,
  cliente: ClienteServiceRole = crearClienteServiceRole(),
): Promise<ConsumoPorCourier[]> {
  const { data, error } = await cliente.rpc('consumo_por_courier', {
    desde: ventana.desde,
    hasta: ventana.hasta,
  });
  if (error) throw new Error(`Error al leer consumo_por_courier: ${error.message}`);

  return ((data ?? []) as FilaRpcCourier[]).map((f) => ({
    tenantId: f.tenant_id,
    eventos: Number(f.eventos),
    totalUnidades: Number(f.total_unidades),
    totalCostoUsd: Number(f.total_costo_usd),
  }));
}

/** Agregado de consumo por conductor (usuario) dentro de UN courier. */
export async function obtenerConsumoPorConductor(
  tenantId: string,
  ventana: VentanaConsumo,
  cliente: ClienteServiceRole = crearClienteServiceRole(),
): Promise<ConsumoPorConductor[]> {
  const { data, error } = await cliente.rpc('consumo_por_conductor', {
    p_tenant_id: tenantId,
    desde: ventana.desde,
    hasta: ventana.hasta,
  });
  if (error) throw new Error(`Error al leer consumo_por_conductor: ${error.message}`);

  return ((data ?? []) as FilaRpcConductor[]).map((f) => ({
    usuarioId: f.usuario_id,
    eventos: Number(f.eventos),
    totalUnidades: Number(f.total_unidades),
    totalCostoUsd: Number(f.total_costo_usd),
  }));
}

/**
 * Precio vigente por proveedor+sku a la fecha `hasta` de la ventana (el más
 * reciente con `vigente_desde <= hasta`) — mismo criterio que usa
 * `consumo_registrar` al calcular el costo. Devuelve un mapa `proveedor|sku`
 * → `free_tier_mensual`.
 */
async function obtenerFreeTierVigentePorProveedor(
  cliente: ClienteServiceRole,
  hasta: string,
): Promise<Map<string, number | null>> {
  // Vía RPC pública: `infra` NO está expuesto a PostgREST (y config.toml no aplica
  // al hosted), así que un `.schema('infra')` fallaría en prod con PGRST106. La
  // RPC ya devuelve el tarifario MÁS RECIENTE por proveedor+sku a la fecha.
  const { data, error } = await cliente.rpc('consumo_precios_vigentes', {
    p_hasta: hasta.slice(0, 10),
  });
  if (error) throw new Error(`Error al leer consumo_precios_vigentes: ${error.message}`);

  const resultado = new Map<string, number | null>();
  for (const fila of (data ?? []) as Array<{
    proveedor_costo: string;
    sku: string;
    free_tier_mensual: number | null;
  }>) {
    resultado.set(`${fila.proveedor_costo}|${fila.sku}`, fila.free_tier_mensual);
  }
  return resultado;
}

/**
 * Agregado de consumo por proveedor+sku en la ventana, ENRIQUECIDO con el %
 * dentro del free tier mensual vigente del proveedor (KPI de Costos).
 */
export async function obtenerConsumoPorProveedor(
  ventana: VentanaConsumo,
  cliente: ClienteServiceRole = crearClienteServiceRole(),
): Promise<ConsumoPorProveedor[]> {
  const [{ data, error }, freeTierPorProveedor] = await Promise.all([
    cliente.rpc('consumo_por_proveedor', { desde: ventana.desde, hasta: ventana.hasta }),
    obtenerFreeTierVigentePorProveedor(cliente, ventana.hasta),
  ]);
  if (error) throw new Error(`Error al leer consumo_por_proveedor: ${error.message}`);

  return ((data ?? []) as FilaRpcProveedor[]).map((f) => {
    const totalUnidades = Number(f.total_unidades);
    const freeTierMensual =
      f.proveedor_costo !== null
        ? (freeTierPorProveedor.get(`${f.proveedor_costo}|${f.sku ?? ''}`) ?? null)
        : null;
    return {
      proveedorCosto: f.proveedor_costo,
      sku: f.sku,
      eventos: Number(f.eventos),
      totalUnidades,
      totalCostoUsd: Number(f.total_costo_usd),
      freeTierMensual,
      porcentajeFreeTier:
        freeTierMensual !== null && freeTierMensual > 0
          ? Math.round((totalUnidades / freeTierMensual) * 1000) / 10
          : null,
    };
  });
}

// =============================================================================
// Costo por entrega efectiva — cuenta directa de `entrega.cerrar` (sin RPC)
// =============================================================================

const TIPO_EVENTO_ENTREGA_CERRAR = 'entrega.cerrar';

interface FilaUsoPorTipo {
  tipo_evento: string;
  usuario_id: string | null;
  proveedor_costo: string | null;
  eventos: number | string;
}

/**
 * Uso agrupado por `tipo_evento × usuario × proveedor` en la ventana, vía la RPC
 * pública `consumo_uso_por_tipo` (única superficie para leer por tipo de evento:
 * `infra` no está expuesto a PostgREST). Lo comparten "costo por entrega" y los
 * KPIs de Uso — una sola lectura, agregada en memoria.
 */
async function leerUsoPorTipo(
  cliente: ClienteServiceRole,
  ventana: VentanaConsumo,
): Promise<FilaUsoPorTipo[]> {
  const { data, error } = await cliente.rpc('consumo_uso_por_tipo', {
    desde: ventana.desde,
    hasta: ventana.hasta,
  });
  if (error) throw new Error(`Error al leer consumo_uso_por_tipo: ${error.message}`);
  return (data ?? []) as FilaUsoPorTipo[];
}

/** Cuántos eventos `entrega.cerrar` (el DENOMINADOR de "costo por entrega") hubo en la ventana. */
async function contarEntregasEfectivas(
  cliente: ClienteServiceRole,
  ventana: VentanaConsumo,
): Promise<number> {
  const filas = await leerUsoPorTipo(cliente, ventana);
  return filas
    .filter((f) => f.tipo_evento === TIPO_EVENTO_ENTREGA_CERRAR)
    .reduce((acc, f) => acc + Number(f.eventos), 0);
}

// =============================================================================
// KPIs — Costos
// =============================================================================

export interface KpisCostosConsumo {
  /** Suma de `total_costo_usd` de TODOS los proveedores en la ventana. */
  costoTotalUsd: number;
  /** Conteo de eventos `entrega.cerrar` en la ventana (denominador). */
  entregasEfectivas: number;
  /** `costoTotalUsd / entregasEfectivas`. `null` si no hubo ninguna entrega (evita división por 0). */
  costoPorEntregaUsd: number | null;
  /** Couriers ordenados por costo descendente (la RPC ya los entrega así), acotado a `topN`. */
  topCouriers: ConsumoPorCourier[];
  /** Por proveedor+sku, con `%` dentro de su free tier mensual vigente. */
  desglosePorProveedor: ConsumoPorProveedor[];
}

/**
 * KPIs del sub-módulo Costos: costo total del período, costo por entrega
 * efectiva, top couriers por costo y desglose por proveedor con `%` de free
 * tier. Todo en la MISMA ventana `[desde, hasta)`.
 */
export async function obtenerKpisCostosConsumo(
  ventana: VentanaConsumo,
  opciones: { topN?: number } = {},
): Promise<KpisCostosConsumo> {
  const topN = opciones.topN ?? 10;
  const cliente = crearClienteServiceRole();

  const [porCourier, desglosePorProveedor, entregasEfectivas] = await Promise.all([
    obtenerConsumoPorCourier(ventana, cliente),
    obtenerConsumoPorProveedor(ventana, cliente),
    contarEntregasEfectivas(cliente, ventana),
  ]);

  const costoTotalUsd = desglosePorProveedor.reduce((acc, p) => acc + p.totalCostoUsd, 0);

  return {
    costoTotalUsd,
    entregasEfectivas,
    costoPorEntregaUsd: entregasEfectivas > 0 ? costoTotalUsd / entregasEfectivas : null,
    // `consumo_por_courier` ya viene ordenada por costo descendente.
    topCouriers: porCourier.slice(0, topN),
    desglosePorProveedor,
  };
}

// =============================================================================
// KPIs — Uso
// =============================================================================

/** Tipos de evento que cuentan como "reoptimización" del conductor (le cuestan nº-paradas al pedir de nuevo). */
const TIPOS_EVENTO_REOPTIMIZACION = new Set(['ruta.optimizar', 'ruta.ir_a_esta_ahora']);
const TIPO_EVENTO_REORDENAR = 'ruta.reordenar';
const TIPO_EVENTO_RUTEO_OPTIMIZAR_ADAPTADOR = 'ruteo.optimizar';

export interface KpisUsoConsumo {
  /** `ruta.optimizar` + `ruta.ir_a_esta_ahora`, agrupados por conductor. El "refresca de más" que pidió medir el usuario. */
  reoptimizacionesPorConductor: Array<{ usuarioId: string | null; total: number }>;
  /** `ruta.reordenar` — arrastres manuales, sin volver a llamar al proveedor. */
  reordenamientosTotal: number;
  /** De los cálculos de ruteo (`ruteo.optimizar`, capa adaptador): cuántos cayeron al motor local vs. al proveedor de pago. */
  ratioLocalVsProveedor: {
    local: number;
    proveedor: number;
    /** `local / (local + proveedor) * 100`. `null` si no hubo ningún cálculo en la ventana. */
    porcentajeLocal: number | null;
  };
}

/**
 * KPIs del sub-módulo Uso: reoptimizaciones/conductor, reordenamientos
 * manuales y el ratio motor-local vs. proveedor de pago. Lee `tipo_evento`
 * directo de `infra.eventos_consumo` (ninguna de las tres RPCs agrupa por
 * tipo de evento) y agrega en memoria — volumen acotado por la retención de
 * ~90 días y por ser un backstage de baja frecuencia de consulta.
 */
export async function obtenerKpisUsoConsumo(ventana: VentanaConsumo): Promise<KpisUsoConsumo> {
  const cliente = crearClienteServiceRole();

  // Las filas ya vienen AGREGADAS por (tipo_evento, usuario, proveedor) con su
  // conteo `eventos` — se suma por ese conteo, no de a uno. La RPC devuelve todos
  // los tipos; aquí se filtran los relevantes en memoria.
  const filas = await leerUsoPorTipo(cliente, ventana);

  const porConductor = new Map<string | null, number>();
  let reordenamientosTotal = 0;
  let local = 0;
  let proveedor = 0;

  for (const fila of filas) {
    const n = Number(fila.eventos);
    if (TIPOS_EVENTO_REOPTIMIZACION.has(fila.tipo_evento)) {
      porConductor.set(fila.usuario_id, (porConductor.get(fila.usuario_id) ?? 0) + n);
    } else if (fila.tipo_evento === TIPO_EVENTO_REORDENAR) {
      reordenamientosTotal += n;
    } else if (fila.tipo_evento === TIPO_EVENTO_RUTEO_OPTIMIZAR_ADAPTADOR) {
      // Instrumentado en `ruta-manifiesto.ts`: con `proveedor_costo` = fue a
      // Google; sin él = cayó al motor local haversine.
      if (fila.proveedor_costo) proveedor += n;
      else local += n;
    }
  }

  const totalCalculos = local + proveedor;

  return {
    reoptimizacionesPorConductor: [...porConductor.entries()]
      .map(([usuarioId, total]) => ({ usuarioId, total }))
      .sort((a, b) => b.total - a.total),
    reordenamientosTotal,
    ratioLocalVsProveedor: {
      local,
      proveedor,
      porcentajeLocal: totalCalculos > 0 ? Math.round((local / totalCalculos) * 1000) / 10 : null,
    },
  };
}
