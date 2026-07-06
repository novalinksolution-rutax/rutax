/**
 * F22 — Analítica de fuga / costo por entrega (Bloque 3)
 * =========================================================
 * Funciones de lectura ON-DEMAND para el dashboard financiero del courier.
 * Consume lo que C7 (F17) ya produjo en `dinero.eventos_conciliacion`,
 * `dinero.lineas_cobro` y `dinero.lineas_liquidacion`.
 *
 * Invariantes:
 * - Solo lectura. NO muta nada. NO es job/cron.
 * - Aislamiento: filtro `tenant_id` explícito en CADA query.
 * - Montos en CLP enteros (Math.round sobre NUMERIC de Postgres).
 * - Excluye SIEMPRE `anulada=true` (anti-cobro-fantasma del Bloque 1).
 * - Las funciones son inteligencia interna del courier:
 *   SOLO para roles con `ver_reportes_ejecutivos` / `ver_conciliacion`.
 *   El SELLER NO debe ver estos agregados (revelan el markup).
 *
 * Extensión V2: vista materializada `dinero.mv_analitica_fuga` + refresh diario
 * como job Inngest, gateado por env VAR. NO construida en MVP.
 *
 * Patrón de referencia: `src/modules/operacion/metricas.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
// Tipos de resultado (contratos públicos hacia los Server Components)
// =============================================================================

export interface VentanaFechas {
  desde: string; // 'YYYY-MM-DD'
  hasta: string; // 'YYYY-MM-DD'
}

/** F22-1: costo por entrega en la ventana. */
export interface CostoPorEntrega {
  /** Número de entregas con línea de liquidación vigente en la ventana. */
  totalEntregas: number;
  /** Suma de monto_final_clp de lineas_liquidacion vigentes. */
  costoTotalClp: number;
  /** costoTotalClp / totalEntregas — 0 si totalEntregas=0. */
  costoPromedioClp: number;
}

/** F22-2: ingreso y margen en la ventana. */
export interface IngresoYMargen {
  /** Suma de monto_final_clp de lineas_cobro vigentes. */
  ingresoTotalClp: number;
  /** Suma de monto_final_clp de lineas_liquidacion vigentes. */
  costoTotalClp: number;
  /** ingresoTotalClp − costoTotalClp. Puede ser negativo. */
  margenClp: number;
  /**
   * margenClp / totalEntregas. 0 si totalEntregas=0.
   * totalEntregas = cuenta de lineas_liquidacion vigentes.
   */
  margenPorEntregaClp: number;
}

/** F22-3: costo por conductor en la ventana. */
export interface CostoConductor {
  driverId: string;
  nombre: string;
  entregas: number;
  costoTotalClp: number;
}

/** F22-4: fuga detectada vs recuperada por tipo. */
export interface FugaPorTipo {
  tipo: string;
  /** Suma de monto_diferencia_clp en estado pendiente/revisado. */
  detectadaClp: number;
  /** Suma de monto_diferencia_clp en estado resuelto. */
  recuperadaClp: number;
  /** Número de eventos. */
  conteo: number;
}

export interface ResumenFuga {
  /** Suma total detectada (pendiente + revisado) en la ventana. */
  fugaDetectadaClp: number;
  /** Suma total recuperada (resuelto) en la ventana. */
  fugaRecuperadaClp: number;
  porTipo: FugaPorTipo[];
}

/** F22-5: resumen financiero agregado para la franja del dashboard. */
export interface ResumenFinancieroAnalitica {
  ingresoTotalClp: number;
  costoTotalClp: number;
  margenClp: number;
  /** costoTotalClp / totalEntregas. 0 si sin entregas. */
  costoPromedioEntregaClp: number;
  /** Solo la fuga recuperada (resuelto) del período. */
  fugaRecuperadaClp: number;
  /** Solo la fuga detectada (pendiente + revisado) del período. */
  fugaDetectadaClp: number;
  totalEntregas: number;
}

// =============================================================================
// Tipos de fuga de interés del revenue
// ============================================================================
/**
 * D1 / D2 / D3 / D4 son los detectores donde hay un desfase de revenue
 * (se pagó sin cobrar, o se cobró mal, o no se cobró el mínimo).
 * D5 / D6 son pendientes de cobro/pago — son un riesgo diferente al flujo de caja,
 * no de revenue perdido en la generación de líneas. Se excluyen de los totales
 * de fuga de revenue pero se documentan como "otros eventos de conciliación".
 */
const TIPOS_FUGA_REVENUE: readonly string[] = [
  "pagado_conductor_sin_cobro_seller",
  "cobrado_seller_no_pagado_conductor",
  "reprogramacion_no_cobrada",
  "minimo_omitido",
];

// =============================================================================
// F22-1: costo por entrega
// =============================================================================

/**
 * Calcula el costo de conductor por entrega para la ventana indicada.
 *
 * Usa `lineas_liquidacion` (lo que el courier paga al conductor) filtradas por
 * `anulada=false` y `fecha_entrega` dentro de la ventana.
 *
 * @param cliente  SupabaseClient con service_role (bypassa RLS; el filtro
 *                 `tenant_id` garantiza el aislamiento de código).
 * @param tenantId UUID del tenant (courier).
 * @param ventana  Rango de fechas `{desde, hasta}` en formato 'YYYY-MM-DD'.
 */
export async function obtenerCostoPorEntrega(
  cliente: SupabaseClient,
  tenantId: string,
  ventana: VentanaFechas,
): Promise<CostoPorEntrega> {
  const { data, error } = await cliente
    .schema("dinero")
    .from("lineas_liquidacion")
    .select("monto_final_clp")
    .eq("tenant_id", tenantId)
    .eq("anulada", false)
    .gte("fecha_entrega", ventana.desde)
    .lte("fecha_entrega", ventana.hasta);

  if (error) {
    throw new Error(
      `F22-1 obtenerCostoPorEntrega: error al leer lineas_liquidacion [tenant=${tenantId}]: ${error.message}`,
    );
  }

  const filas = data ?? [];
  const totalEntregas = filas.length;
  const costoTotalClp = filas.reduce(
    (acc, f) => acc + Math.round(Number(f.monto_final_clp ?? 0)),
    0,
  );
  const costoPromedioClp =
    totalEntregas > 0 ? Math.round(costoTotalClp / totalEntregas) : 0;

  return { totalEntregas, costoTotalClp, costoPromedioClp };
}

// =============================================================================
// F22-2: ingreso y margen
// =============================================================================

/**
 * Calcula ingreso (cobro al seller) y margen (ingreso − costo conductor)
 * para la ventana indicada.
 *
 * Ambas fuentes se filtran por `anulada=false` y `fecha_entrega` en la ventana.
 * Se cuentan las entregas desde `lineas_liquidacion` (lo entregado con conductor),
 * no desde `lineas_cobro`, porque un pedido same-day de gasto propio tendría
 * cobro=0 pero no habría línea de liquidación.
 */
export async function obtenerIngresoYMargen(
  cliente: SupabaseClient,
  tenantId: string,
  ventana: VentanaFechas,
): Promise<IngresoYMargen> {
  const [cobroRes, liqRes] = await Promise.all([
    cliente
      .schema("dinero")
      .from("lineas_cobro")
      .select("monto_final_clp")
      .eq("tenant_id", tenantId)
      .eq("anulada", false)
      .gte("fecha_entrega", ventana.desde)
      .lte("fecha_entrega", ventana.hasta),
    cliente
      .schema("dinero")
      .from("lineas_liquidacion")
      .select("monto_final_clp")
      .eq("tenant_id", tenantId)
      .eq("anulada", false)
      .gte("fecha_entrega", ventana.desde)
      .lte("fecha_entrega", ventana.hasta),
  ]);

  if (cobroRes.error) {
    throw new Error(
      `F22-2 obtenerIngresoYMargen: error al leer lineas_cobro [tenant=${tenantId}]: ${cobroRes.error.message}`,
    );
  }
  if (liqRes.error) {
    throw new Error(
      `F22-2 obtenerIngresoYMargen: error al leer lineas_liquidacion [tenant=${tenantId}]: ${liqRes.error.message}`,
    );
  }

  const ingresoTotalClp = (cobroRes.data ?? []).reduce(
    (acc, f) => acc + Math.round(Number(f.monto_final_clp ?? 0)),
    0,
  );
  const costoTotalClp = (liqRes.data ?? []).reduce(
    (acc, f) => acc + Math.round(Number(f.monto_final_clp ?? 0)),
    0,
  );
  const totalEntregas = (liqRes.data ?? []).length;
  const margenClp = ingresoTotalClp - costoTotalClp;
  const margenPorEntregaClp =
    totalEntregas > 0 ? Math.round(margenClp / totalEntregas) : 0;

  return { ingresoTotalClp, costoTotalClp, margenClp, margenPorEntregaClp };
}

// =============================================================================
// F22-3: costo por conductor
// =============================================================================

/**
 * Retorna el costo total pagado a cada conductor en la ventana, junto con
 * la cantidad de entregas y el nombre del conductor.
 *
 * El JOIN de nombres se hace en memoria (dos queries + Map) para mantener
 * el patrón de módulo TypeScript sin SQL raw. La tabla de conductores es
 * pequeña (decenas, raramente cientos) por tenant.
 *
 * Ordena de mayor a menor costo total.
 */
export async function obtenerCostoPorConductor(
  cliente: SupabaseClient,
  tenantId: string,
  ventana: VentanaFechas,
): Promise<CostoConductor[]> {
  const { data: lineas, error: errLineas } = await cliente
    .schema("dinero")
    .from("lineas_liquidacion")
    .select("driver_id, monto_final_clp")
    .eq("tenant_id", tenantId)
    .eq("anulada", false)
    .gte("fecha_entrega", ventana.desde)
    .lte("fecha_entrega", ventana.hasta);

  if (errLineas) {
    throw new Error(
      `F22-3 obtenerCostoPorConductor: error al leer lineas_liquidacion [tenant=${tenantId}]: ${errLineas.message}`,
    );
  }

  const filas = lineas ?? [];
  if (filas.length === 0) return [];

  // Agregar por driver_id en memoria.
  const mapaAgregado = new Map<string, { entregas: number; costoTotalClp: number }>();
  for (const f of filas) {
    const driverId = f.driver_id as string;
    const monto = Math.round(Number(f.monto_final_clp ?? 0));
    const actual = mapaAgregado.get(driverId) ?? { entregas: 0, costoTotalClp: 0 };
    mapaAgregado.set(driverId, {
      entregas: actual.entregas + 1,
      costoTotalClp: actual.costoTotalClp + monto,
    });
  }

  const driverIds = Array.from(mapaAgregado.keys());

  // Obtener nombres de conductores.
  const { data: conductores, error: errConductores } = await cliente
    .schema("identidad")
    .from("conductores")
    .select("id, nombre_completo")
    .eq("tenant_id", tenantId)
    .in("id", driverIds);

  if (errConductores) {
    throw new Error(
      `F22-3 obtenerCostoPorConductor: error al leer conductores [tenant=${tenantId}]: ${errConductores.message}`,
    );
  }

  const mapaNombres = new Map<string, string>();
  for (const c of conductores ?? []) {
    mapaNombres.set(c.id as string, (c.nombre_completo as string) ?? "Conductor");
  }

  // Combinar y ordenar por costo descendente.
  const resultado: CostoConductor[] = [];
  for (const [driverId, ag] of mapaAgregado.entries()) {
    resultado.push({
      driverId,
      nombre: mapaNombres.get(driverId) ?? "Conductor",
      entregas: ag.entregas,
      costoTotalClp: ag.costoTotalClp,
    });
  }

  return resultado.sort((a, b) => b.costoTotalClp - a.costoTotalClp);
}

// =============================================================================
// F22-4: fuga detectada vs recuperada
// =============================================================================

/**
 * Analiza los eventos de conciliación de tipos "fuga de revenue" (D1–D4)
 * producidos por el job C7 dentro de la ventana de fechas.
 *
 * Detectada = eventos con estado `pendiente` o `revisado` (aún no resueltos).
 * Recuperada = eventos con estado `resuelto` (la discrepancia fue corregida).
 *
 * Los tipos considerados "fuga de revenue" son:
 *   - `pagado_conductor_sin_cobro_seller`   (D1) — fuga directa
 *   - `cobrado_seller_no_pagado_conductor`  (D2) — costo sin cobro correlativo
 *   - `reprogramacion_no_cobrada`           (D3) — recargo omitido
 *   - `minimo_omitido`                      (D4) — mínimo de facturación no aplicado
 *
 * Los tipos D5 (`pago_seller_faltante`) y D6 (`pago_conductor_faltante`) son
 * pendientes de flujo de caja, no de generación de revenue, y se excluyen
 * de estos totales.
 *
 * La ventana filtra por `creado_en` del evento (cuando C7 detectó el hallazgo),
 * no por fecha de la entrega original.
 */
export async function obtenerFuga(
  cliente: SupabaseClient,
  tenantId: string,
  ventana: VentanaFechas,
): Promise<ResumenFuga> {
  const { data, error } = await cliente
    .schema("dinero")
    .from("eventos_conciliacion")
    .select("tipo_diferencia, monto_diferencia_clp, estado")
    .eq("tenant_id", tenantId)
    .in("tipo_diferencia", [...TIPOS_FUGA_REVENUE])
    // Filtra por fecha de creación del evento (cuando C7 lo detectó).
    .gte("creado_en", `${ventana.desde}T00:00:00.000Z`)
    .lte("creado_en", `${ventana.hasta}T23:59:59.999Z`);

  if (error) {
    throw new Error(
      `F22-4 obtenerFuga: error al leer eventos_conciliacion [tenant=${tenantId}]: ${error.message}`,
    );
  }

  // Acumular por tipo y separar detectada/recuperada.
  const mapaTipo = new Map<
    string,
    { detectadaClp: number; recuperadaClp: number; conteo: number }
  >();

  for (const tipo of TIPOS_FUGA_REVENUE) {
    mapaTipo.set(tipo, { detectadaClp: 0, recuperadaClp: 0, conteo: 0 });
  }

  for (const ev of data ?? []) {
    const tipo = ev.tipo_diferencia as string;
    const monto = Math.round(Number(ev.monto_diferencia_clp ?? 0));
    const estado = ev.estado as string;

    // Solo acumular tipos que sean "fuga de revenue" (D1–D4).
    // Si Postgres devolviera un tipo no esperado (D5/D6), lo ignoramos aquí
    // como defensa en profundidad — en producción el .in() de la query ya
    // garantiza que solo llegan los tipos correctos.
    const entrada = mapaTipo.get(tipo);
    if (!entrada) continue;

    if (estado === "resuelto") {
      entrada.recuperadaClp += monto;
    } else if (estado === "pendiente" || estado === "revisado") {
      entrada.detectadaClp += monto;
    }
    // ignorado: no suma ni a detectada ni a recuperada.
    entrada.conteo += 1;
  }

  let fugaDetectadaClp = 0;
  let fugaRecuperadaClp = 0;

  const porTipo: FugaPorTipo[] = [];
  for (const [tipo, ag] of mapaTipo.entries()) {
    if (ag.conteo > 0 || ag.detectadaClp > 0 || ag.recuperadaClp > 0) {
      porTipo.push({ tipo, ...ag });
    }
    fugaDetectadaClp += ag.detectadaClp;
    fugaRecuperadaClp += ag.recuperadaClp;
  }

  return { fugaDetectadaClp, fugaRecuperadaClp, porTipo };
}

// =============================================================================
// F22-5: resumen financiero agregado (franja del dashboard)
// =============================================================================

/**
 * Une F22-1, F22-2 y F22-4 en un único objeto para la franja del dashboard.
 * Llama a las tres funciones en paralelo para minimizar la latencia.
 *
 * Diseñado para ser llamado desde un Server Component gateado por la capacidad
 * `ver_reportes_ejecutivos`. El seller jamás debe poder consumir esta función.
 */
export async function obtenerResumenFinanciero(
  cliente: SupabaseClient,
  tenantId: string,
  ventana: VentanaFechas,
): Promise<ResumenFinancieroAnalitica> {
  const [costo, margen, fuga] = await Promise.all([
    obtenerCostoPorEntrega(cliente, tenantId, ventana),
    obtenerIngresoYMargen(cliente, tenantId, ventana),
    obtenerFuga(cliente, tenantId, ventana),
  ]);

  return {
    ingresoTotalClp: margen.ingresoTotalClp,
    costoTotalClp: margen.costoTotalClp,
    margenClp: margen.margenClp,
    costoPromedioEntregaClp: costo.costoPromedioClp,
    fugaRecuperadaClp: fuga.fugaRecuperadaClp,
    fugaDetectadaClp: fuga.fugaDetectadaClp,
    totalEntregas: costo.totalEntregas,
  };
}
