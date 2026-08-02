/**
 * Métricas operativas del día — consultas de solo lectura para el dashboard
 * del dueño (RF-046).
 *
 * Usa el cliente service_role para leer sin restricciones de RLS de sesión,
 * pero aplica siempre el filtro de tenant_id.
 *
 * Las métricas no contienen datos personales ni financieros sensibles —
 * son agregados de conteo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetricasOperativas, EstadoPedido, ImpactoSla } from "./tipos";
import { ahoraEnSantiago, horaAMinutos, fechaLocalEnSantiago, hoyEnSantiago } from "@/lib/fecha-santiago";

/**
 * Devuelve las métricas operativas del tenant para la fecha indicada.
 *
 * - `totalPedidos`: pedidos con fecha_compromiso en el día (o creados en el día
 *   para same-day sin fecha fija).
 * - `porEstado`: distribución de pedidos por estado (todos los pedidos del tenant).
 * - `tasaEntrega`: (entregado + entregado_manual) / total pedidos con estado terminal.
 * - `incidenciasAbiertas`: incidencias con estado IN ('abierta', 'en_gestion').
 * - `conexionesCaidas`: conexiones ML con estado_salud = 'desvinculada'.
 * - `conductoresActivos`: conductores del tenant con estado='activo'.
 * - `conductoresListosHoy`: conductores distintos con manifiesto
 *   confirmado/en_ruta para la fecha indicada.
 * - `paquetesPorComuna`: top 5 comunas con más pedidos del día (resto agrupado
 *   en "Otras").
 * - `rezagadosAyer`: pedidos con fecha_compromiso = ayer y estado no terminal.
 */

/**
 * Estados de pedido considerados terminales para "rezagados de ayer". Se
 * exporta porque también la reusa `plataforma/observabilidad-tenant.ts`
 * (backlog operativo por-tenant del drill-down del backstage, gap 9): "pedidos
 * pendientes/en curso" = el complemento de este conjunto
 * (pendiente_asignacion/asignado/en_ruta), sin re-derivar la lista.
 */
export const ESTADOS_TERMINALES_PEDIDO: readonly EstadoPedido[] = [
  "entregado",
  "entregado_manual",
  "fallido",
  "fallido_manual",
  "cancelado",
  "devuelto",
];

/**
 * Devuelve la fecha del día anterior a `fechaStr` ('YYYY-MM-DD'), como string
 * en el mismo formato. Se opera sobre componentes de fecha "naive" (sin TZ),
 * consistente con el resto del módulo, que trata las columnas `date` de
 * Postgres como strings America/Santiago.
 */
function diaAnterior(fechaStr: string): string {
  const [anio, mes, dia] = fechaStr.split("-").map(Number);
  // Usamos UTC para evitar que el TZ local del proceso desplace la fecha.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  fecha.setUTCDate(fecha.getUTCDate() - 1);
  return fecha.toISOString().split("T")[0];
}
export async function obtenerMetricasDelDia(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: Date,
): Promise<MetricasOperativas> {
  const fechaStr = fechaLocalEnSantiago(fecha);

  // Pedidos del día (por fecha_compromiso o creados ese día).
  // service_role accede al esquema directo (las vistas `public` son para el
  // usuario autenticado vía RLS; service_role no tiene grant sobre ellas).
  const { data: pedidosDia, error: errorPedidos } = await cliente
    .schema("operacion")
    .from("pedidos")
    .select("id, estado, destinatario_comuna, sla_cumplido")
    .eq("tenant_id", tenantId)
    .or(`fecha_compromiso.eq.${fechaStr},and(fecha_compromiso.is.null,creado_en.gte.${fechaStr}T00:00:00.000Z,creado_en.lt.${fechaStr}T23:59:59.999Z)`);

  if (errorPedidos) {
    throw new Error(`Error al obtener pedidos del día: ${errorPedidos.message}`);
  }

  const pedidos = pedidosDia ?? [];
  const totalPedidos = pedidos.length;

  // Distribución por estado.
  const porEstado: Partial<Record<EstadoPedido, number>> = {};
  for (const p of pedidos) {
    const est: EstadoPedido = p.estado;
    porEstado[est] = (porEstado[est] ?? 0) + 1;
  }

  // Tasa de entrega = entregados / (entregados + fallidos + cancelados + devueltos).
  const entregados =
    (porEstado["entregado"] ?? 0) + (porEstado["entregado_manual"] ?? 0);
  const terminales =
    entregados +
    (porEstado["fallido"] ?? 0) +
    (porEstado["fallido_manual"] ?? 0) +
    (porEstado["cancelado"] ?? 0) +
    (porEstado["devuelto"] ?? 0);
  const tasaEntrega = terminales > 0 ? entregados / terminales : 0;

  // Paquetes por comuna (top 5, resto agrupado en "Otras").
  const conteoPorComuna = new Map<string, number>();
  for (const p of pedidos) {
    const comuna = (p as { destinatario_comuna?: string | null }).destinatario_comuna ?? "Sin comuna";
    conteoPorComuna.set(comuna, (conteoPorComuna.get(comuna) ?? 0) + 1);
  }
  const comunasOrdenadas = Array.from(conteoPorComuna.entries())
    .map(([comuna, cantidad]) => ({ comuna, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);

  const top5 = comunasOrdenadas.slice(0, 5);
  const restoCantidad = comunasOrdenadas.slice(5).reduce((acc, c) => acc + c.cantidad, 0);
  const paquetesPorComuna = restoCantidad > 0
    ? [...top5, { comuna: "Otras", cantidad: restoCantidad }]
    : top5;

  // Incidencias abiertas del tenant.
  const { count: incidenciasAbiertas, error: errorIncidencias } = await cliente
    .schema("operacion")
    .from("incidencias")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("estado", ["abierta", "en_gestion"]);

  if (errorIncidencias) {
    throw new Error(`Error al contar incidencias: ${errorIncidencias.message}`);
  }

  // Conexiones ML caídas (estado_salud = 'desvinculada') del tenant.
  const { count: conexionesCaidas, error: errorConexiones } = await cliente
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("estado_salud", "desvinculada");

  if (errorConexiones) {
    throw new Error(`Error al contar conexiones caídas: ${errorConexiones.message}`);
  }

  // Conductores activos del tenant (independiente de la fecha).
  const { count: conductoresActivos, error: errorConductores } = await cliente
    .schema("identidad")
    .from("conductores")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("estado", "activo");

  if (errorConductores) {
    throw new Error(`Error al contar conductores activos: ${errorConductores.message}`);
  }

  // Conductores distintos con manifiesto confirmado/en_ruta para hoy.
  const { data: manifiestosHoy, error: errorManifiestos } = await cliente
    .schema("operacion")
    .from("manifiestos")
    .select("driver_id")
    .eq("tenant_id", tenantId)
    .eq("fecha_operacion", fechaStr)
    .in("estado", ["confirmado", "en_ruta"]);

  if (errorManifiestos) {
    throw new Error(`Error al obtener manifiestos del día: ${errorManifiestos.message}`);
  }

  const conductoresListosHoy = new Set(
    (manifiestosHoy ?? []).map((m) => m.driver_id),
  ).size;

  // Rezagados de ayer: fecha_compromiso = ayer y estado no terminal.
  const fechaAyer = diaAnterior(fechaStr);
  const { count: rezagadosAyer, error: errorRezagados } = await cliente
    .schema("operacion")
    .from("pedidos")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("fecha_compromiso", fechaAyer)
    .not("estado", "in", `(${ESTADOS_TERMINALES_PEDIDO.join(",")})`);

  if (errorRezagados) {
    throw new Error(`Error al contar rezagados de ayer: ${errorRezagados.message}`);
  }

  // SLA global del día: % de pedidos con sla_cumplido = true sobre evaluados.
  let slaGlobalPct: number | null = null;
  const pedidosConSla = pedidos.filter(
    (p) => (p as { sla_cumplido?: boolean | null }).sla_cumplido !== null &&
           (p as { sla_cumplido?: boolean | null }).sla_cumplido !== undefined,
  );
  if (pedidosConSla.length > 0) {
    const aTiempo = pedidosConSla.filter(
      (p) => (p as { sla_cumplido?: boolean | null }).sla_cumplido === true,
    ).length;
    slaGlobalPct = (aTiempo / pedidosConSla.length) * 100;
  }

  return {
    totalPedidos,
    porEstado,
    tasaEntrega,
    incidenciasAbiertas: incidenciasAbiertas ?? 0,
    conexionesCaidas: conexionesCaidas ?? 0,
    conductoresActivos: conductoresActivos ?? 0,
    conductoresListosHoy,
    paquetesPorComuna,
    rezagadosAyer: rezagadosAyer ?? 0,
    slaGlobalPct,
  };
}

// =============================================================================
// Resumen financiero del mes (dashboard del dueño — UX-2)
// =============================================================================

/**
 * Agregado financiero de los períodos de cobro del mes en curso. Solo lectura,
 * sin datos personales: montos consolidados que ya viven en `periodos_cobro`.
 * Excluye períodos anulados. "Por cobrar" = comprometido − cobrado (nunca < 0).
 */
export interface ResumenFinancieroMes {
  /** Suma de los montos de los períodos no anulados del mes (lo comprometido). */
  montoPeriodoClp: number;
  /** Suma de lo efectivamente pagado por los sellers. */
  cobradoClp: number;
  /** Saldo por cobrar (comprometido − cobrado, acotado a ≥ 0). */
  porCobrarClp: number;
  /** Períodos ya facturados (DTE emitido) / total del mes. */
  periodosFacturados: number;
  periodosTotal: number;
}

export async function obtenerResumenFinancieroDelMes(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: Date,
): Promise<ResumenFinancieroMes> {
  const fechaStr = fechaLocalEnSantiago(fecha);
  const [anioStr, mesStr] = fechaStr.split("-");
  const anio = Number(anioStr);
  const mes = Number(mesStr);
  const primerDia = `${anioStr}-${mesStr}-01`;
  const sigMes = mes === 12 ? 1 : mes + 1;
  const sigAnio = mes === 12 ? anio + 1 : anio;
  const primerDiaSiguiente = `${sigAnio}-${String(sigMes).padStart(2, "0")}-01`;

  const { data, error } = await cliente
    .schema("dinero")
    .from("periodos_cobro")
    .select("estado, monto_total_clp, monto_pagado_clp")
    .eq("tenant_id", tenantId)
    .neq("estado", "anulado")
    .gte("fecha_inicio", primerDia)
    .lt("fecha_inicio", primerDiaSiguiente);

  if (error) {
    throw new Error(`Error al obtener resumen financiero del mes: ${error.message}`);
  }

  let montoPeriodoClp = 0;
  let cobradoClp = 0;
  let periodosFacturados = 0;
  const filas = data ?? [];

  for (const p of filas) {
    montoPeriodoClp += Number(p.monto_total_clp ?? 0);
    cobradoClp += Number(p.monto_pagado_clp ?? 0);
    if (p.estado === "facturado") periodosFacturados += 1;
  }

  return {
    montoPeriodoClp,
    cobradoClp,
    porCobrarClp: Math.max(0, montoPeriodoClp - cobradoClp),
    periodosFacturados,
    periodosTotal: filas.length,
  };
}

// =============================================================================
// SLA por seller (F7, ítem 1.2)
// =============================================================================

export interface SlaPorSeller {
  sellerId: string;
  sellerNombre: string;
  totalTerminales: number;
  aTiempo: number;
  /** 0–100. null si no hay pedidos evaluados (sla_cumplido IS NOT NULL). */
  slaPct: number | null;
  /** Objetivo de SLA pactado (de ventanas_corte, default 97). */
  objetivoPct: number;
}

/**
 * Devuelve el resumen de SLA por seller para una fecha (día o semana).
 * Solo lectura — agrega sobre `pedidos.sla_cumplido` (no recalcula tiempos).
 * El `objetivoPct` proviene de `ventanas_corte.sla_objetivo_pct` (default 97
 * si el seller no tiene ventana configurada).
 *
 * @param ventana 'dia' = solo la fecha indicada; 'semana' = los 7 días anteriores.
 */
export async function obtenerSlaPorSeller(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: Date,
  ventana: 'dia' | 'semana',
): Promise<SlaPorSeller[]> {
  const fechaStr = fechaLocalEnSantiago(fecha);

  // Calcular ventana de fechas.
  let fechaDesde: string;
  if (ventana === 'semana') {
    const hace7 = new Date(fecha);
    hace7.setUTCDate(hace7.getUTCDate() - 6);
    fechaDesde = hace7.toISOString().split("T")[0];
  } else {
    fechaDesde = fechaStr;
  }

  // Pedidos terminales con sla_cumplido evaluado, en la ventana.
  const TERMINALES_EXITOSOS = ['entregado', 'entregado_manual'];
  const TERMINALES = [...TERMINALES_EXITOSOS, 'fallido', 'fallido_manual', 'cancelado', 'devuelto'];

  const { data: pedidos, error: errorPedidos } = await cliente
    .schema("operacion")
    .from("pedidos")
    .select("seller_id, sla_cumplido")
    .eq("tenant_id", tenantId)
    .in("estado", TERMINALES)
    .not("sla_cumplido", "is", null)
    .gte("fecha_compromiso", fechaDesde)
    .lte("fecha_compromiso", fechaStr);

  if (errorPedidos) {
    throw new Error(`Error al obtener SLA por seller: ${errorPedidos.message}`);
  }

  // Obtener sellers del tenant con sus nombres.
  const { data: sellers, error: errorSellers } = await cliente
    .schema("identidad")
    .from("sellers")
    .select("id, nombre_empresa")
    .eq("tenant_id", tenantId);

  if (errorSellers) {
    throw new Error(`Error al obtener sellers para SLA: ${errorSellers.message}`);
  }

  // Obtener objetivos de SLA desde ventanas_corte (tomar la ventana por defecto del seller).
  const { data: ventanas, error: errorVentanas } = await cliente
    .schema("identidad")
    .from("ventanas_corte")
    .select("seller_id, sla_objetivo_pct")
    .eq("tenant_id", tenantId)
    .is("zona_id", null) // solo la ventana por defecto
    .eq("activa", true);

  if (errorVentanas) {
    // No crítico: usar default 97 si falla.
  }

  const mapaObjetivo = new Map<string, number>();
  for (const v of ventanas ?? []) {
    mapaObjetivo.set(v.seller_id as string, Number(v.sla_objetivo_pct ?? 97));
  }

  // Agregar por seller.
  const mapaAgregado = new Map<string, { aTiempo: number; total: number }>();
  for (const p of pedidos ?? []) {
    const sid = p.seller_id as string;
    if (!mapaAgregado.has(sid)) {
      mapaAgregado.set(sid, { aTiempo: 0, total: 0 });
    }
    const ag = mapaAgregado.get(sid)!;
    ag.total += 1;
    if ((p as { sla_cumplido: boolean | null }).sla_cumplido === true) {
      ag.aTiempo += 1;
    }
  }

  const mapaSellerNombre = new Map<string, string>();
  for (const s of sellers ?? []) {
    mapaSellerNombre.set(s.id as string, (s.nombre_empresa as string) ?? 'Seller');
  }

  const resultado: SlaPorSeller[] = [];
  for (const [sellerId, ag] of mapaAgregado.entries()) {
    resultado.push({
      sellerId,
      sellerNombre: mapaSellerNombre.get(sellerId) ?? 'Seller',
      totalTerminales: ag.total,
      aTiempo: ag.aTiempo,
      slaPct: ag.total > 0 ? (ag.aTiempo / ag.total) * 100 : null,
      objetivoPct: mapaObjetivo.get(sellerId) ?? 97,
    });
  }

  return resultado.sort((a, b) => (a.slaPct ?? 0) - (b.slaPct ?? 0));
}

// =============================================================================
// Historial de SLA por semana — últimas N semanas (F13, portal seller)
// =============================================================================

export interface SemanaSlaSeller {
  /** Lunes de la semana — formato 'YYYY-MM-DD'. */
  semanaDesde: string;
  /** Domingo de la semana — formato 'YYYY-MM-DD'. */
  semanaHasta: string;
  totalTerminales: number;
  aTiempo: number;
  slaPct: number | null;
  objetivoPct: number;
}

/**
 * Devuelve el % de cumplimiento SLA de un seller para las últimas `semanas`
 * semanas completas (lunes a domingo, zona Santiago). Semana 0 = semana en curso.
 *
 * Solo lectura — agrega sobre `pedidos.sla_cumplido`.
 */
export async function obtenerHistorialSlaSemanas(
  cliente: SupabaseClient,
  tenantId: string,
  sellerId: string,
  semanas: number = 4,
): Promise<SemanaSlaSeller[]> {
  // Calcular el lunes de la semana actual en calendario de Santiago.
  // Antes esto usaba `new Date().toISOString().split("T")[0]`, que es UTC: desde
  // las 20:00 de Santiago devolvía el día siguiente, y un domingo por la noche
  // el "lunes de la semana actual" saltaba a la semana que viene.
  const hoyStr = hoyEnSantiago();
  const [a, m, d] = hoyStr.split("-").map(Number);
  const hoyUtc = new Date(Date.UTC(a, m - 1, d));
  const diaSemana = hoyUtc.getUTCDay(); // 0=dom, 1=lun..6=sab
  const diasDesdelLunes = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunesActual = new Date(hoyUtc);
  lunesActual.setUTCDate(hoyUtc.getUTCDate() - diasDesdelLunes);

  // Obtener objetivo SLA del seller.
  const { data: ventanaData } = await cliente
    .schema("identidad")
    .from("ventanas_corte")
    .select("sla_objetivo_pct")
    .eq("tenant_id", tenantId)
    .eq("seller_id", sellerId)
    .is("zona_id", null)
    .eq("activa", true)
    .maybeSingle();
  const objetivoPct = Number(ventanaData?.sla_objetivo_pct ?? 97);

  const TERMINALES_EXITOSOS = ["entregado", "entregado_manual"];
  const TERMINALES = [...TERMINALES_EXITOSOS, "fallido", "fallido_manual", "cancelado", "devuelto"];

  const resultado: SemanaSlaSeller[] = [];

  for (let i = 0; i < semanas; i++) {
    const lunes = new Date(lunesActual);
    lunes.setUTCDate(lunesActual.getUTCDate() - i * 7);
    const domingo = new Date(lunes);
    domingo.setUTCDate(lunes.getUTCDate() + 6);

    const semanaDesde = lunes.toISOString().split("T")[0];
    const semanaHasta = domingo.toISOString().split("T")[0];

    const { data: pedidos } = await cliente
      .schema("operacion")
      .from("pedidos")
      .select("sla_cumplido")
      .eq("tenant_id", tenantId)
      .eq("seller_id", sellerId)
      .in("estado", TERMINALES)
      .not("sla_cumplido", "is", null)
      .gte("fecha_compromiso", semanaDesde)
      .lte("fecha_compromiso", semanaHasta);

    const total = (pedidos ?? []).length;
    const aTiempo = (pedidos ?? []).filter(
      (p: { sla_cumplido: boolean | null }) => p.sla_cumplido === true,
    ).length;

    resultado.push({
      semanaDesde,
      semanaHasta,
      totalTerminales: total,
      aTiempo,
      slaPct: total > 0 ? (aTiempo / total) * 100 : null,
      objetivoPct,
    });
  }

  return resultado;
}

// =============================================================================
// Impacto SLA de redistribución (F6, ítem 1.3 — solo lectura)
// =============================================================================

/**
 * Calcula el impacto en SLA de los sellers con paradas sin asignar.
 *
 * Solo lectura — no persiste, no recalcula `sla_cumplido`.
 * Apoya a `marcarConductorNoDisponibleYRedistribuir` (auto-asignacion.ts)
 * para armar el resumen de cada redistribución.
 *
 * @param tenantId   Tenant del courier.
 * @param fecha      Fecha de operación ('YYYY-MM-DD').
 * @param sellerIds  IDs de sellers afectados (con al menos una parada sin conductor).
 * @param sinAsignar Paradas sin asignar (para contar por seller). Cada elemento
 *                   debe tener { sellerId, paradasSinConductor? } o el conteo
 *                   se pasa directamente como `cuentaPorSeller`.
 */
export async function obtenerImpactoSlaDeReasignacion(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: string,
  sellerIds: string[],
  sinAsignar: Array<{ sellerId: string }>,
): Promise<ImpactoSla[]> {
  if (sellerIds.length === 0) return [];

  // SLA actual por seller (ventana 'dia').
  const slaActual = await obtenerSlaPorSeller(
    cliente,
    tenantId,
    new Date(fecha + 'T12:00:00Z'),
    'dia',
  );

  const mapaSlaPorSeller = new Map(slaActual.map((s) => [s.sellerId, s]));

  // Nombre de sellers afectados.
  const { data: filasSellerAfect, error: errSellers } = await cliente
    .schema('identidad')
    .from('sellers')
    .select('id, nombre_empresa')
    .eq('tenant_id', tenantId)
    .in('id', sellerIds);

  // No bloqueante: si falla la consulta de nombre, usamos 'Seller' como fallback.
  const mapaNombreSeller = new Map<string, string>();
  if (!errSellers) {
    for (const s of (filasSellerAfect ?? []) as { id: string; nombre_empresa: string }[]) {
      mapaNombreSeller.set(s.id, s.nombre_empresa ?? 'Seller');
    }
  }

  // Contar paradas sin conductor por seller.
  const cuentaPorSeller = new Map<string, number>();
  for (const p of sinAsignar) {
    cuentaPorSeller.set(p.sellerId, (cuentaPorSeller.get(p.sellerId) ?? 0) + 1);
  }

  return sellerIds.map((sellerId): ImpactoSla => {
    const sla = mapaSlaPorSeller.get(sellerId);
    return {
      sellerId,
      sellerNombre: mapaNombreSeller.get(sellerId) ?? 'Seller',
      slaPctActual: sla?.slaPct ?? null,
      objetivoPct: sla?.objetivoPct ?? 97,
      paradasSinConductor: cuentaPorSeller.get(sellerId) ?? 0,
    };
  });
}

// =============================================================================
// Resumen de corte en vivo (Tarea 8, F7 — dashboard, sin job)
// =============================================================================

export interface ResumenCorteSeller {
  sellerId: string;
  sellerNombre: string;
  /** Hora de corte 'HH:MM' local Santiago. null si el seller no tiene ventana activa. */
  horaCorte: string | null;
  /** Minutos restantes hasta el corte (puede ser negativo = ya pasó). */
  minutosRestantes: number | null;
  /** Pedidos same-day no terminales del día. */
  pedidosPendientesHoy: number;
}

/**
 * Cómputo en VIVO del tiempo restante hasta el corte por seller.
 * Para uso por el dashboard (lectura directa, sin job).
 * Calcula `minutosRestantes` en TZ Santiago usando las utilidades de fecha-santiago.
 */
export async function obtenerResumenCortePorSeller(
  cliente: SupabaseClient,
  tenantId: string,
): Promise<ResumenCorteSeller[]> {
  const { fecha: fechaHoy, hora: horaActual } = ahoraEnSantiago();
  const minutosActual = horaAMinutos(horaActual);

  // Ventanas activas por defecto (zona_id IS NULL) del tenant.
  const { data: ventanas, error: errorVentanas } = await cliente
    .schema("identidad")
    .from("ventanas_corte")
    .select("seller_id, hora_corte")
    .eq("tenant_id", tenantId)
    .is("zona_id", null)
    .eq("activa", true);

  if (errorVentanas) {
    throw new Error(`Error al obtener ventanas de corte: ${errorVentanas.message}`);
  }

  // Sellers del tenant.
  const { data: sellers, error: errorSellers } = await cliente
    .schema("identidad")
    .from("sellers")
    .select("id, nombre_empresa")
    .eq("tenant_id", tenantId);

  if (errorSellers) {
    throw new Error(`Error al obtener sellers: ${errorSellers.message}`);
  }

  // Pedidos same-day no terminales del día.
  const ESTADOS_NO_TERMINALES = [
    'pendiente_asignacion',
    'asignado',
    'en_ruta',
  ] as const;

  const { data: pedidosHoy, error: errorPedidos } = await cliente
    .schema("operacion")
    .from("pedidos")
    .select("seller_id, estado")
    .eq("tenant_id", tenantId)
    .eq("tipo_pedido", "same_day")
    .eq("fecha_compromiso", fechaHoy)
    .in("estado", [...ESTADOS_NO_TERMINALES]);

  if (errorPedidos) {
    throw new Error(`Error al obtener pedidos pendientes del día: ${errorPedidos.message}`);
  }

  // Mapa seller → cantidad pendiente.
  const mapaPendientes = new Map<string, number>();
  for (const p of pedidosHoy ?? []) {
    const sid = p.seller_id as string;
    mapaPendientes.set(sid, (mapaPendientes.get(sid) ?? 0) + 1);
  }

  // Mapa seller → hora_corte.
  const mapaHoraCorte = new Map<string, string>();
  for (const v of ventanas ?? []) {
    // hora_corte viene como 'HH:MM:SS' desde Postgres — tomar solo 'HH:MM'.
    const horaCorte = ((v.hora_corte as string) ?? '').slice(0, 5);
    mapaHoraCorte.set(v.seller_id as string, horaCorte);
  }

  const mapaSellerNombre = new Map<string, string>();
  for (const s of sellers ?? []) {
    mapaSellerNombre.set(s.id as string, (s.nombre_empresa as string) ?? 'Seller');
  }

  const resultado: ResumenCorteSeller[] = [];
  for (const s of sellers ?? []) {
    const sid = s.id as string;
    const horaCorte = mapaHoraCorte.get(sid) ?? null;
    let minutosRestantes: number | null = null;
    if (horaCorte) {
      minutosRestantes = horaAMinutos(horaCorte) - minutosActual;
    }

    resultado.push({
      sellerId: sid,
      sellerNombre: (s.nombre_empresa as string) ?? 'Seller',
      horaCorte,
      minutosRestantes,
      pedidosPendientesHoy: mapaPendientes.get(sid) ?? 0,
    });
  }

  return resultado.sort((a, b) => (a.minutosRestantes ?? Infinity) - (b.minutosRestantes ?? Infinity));
}
