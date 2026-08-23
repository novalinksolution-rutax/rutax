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
import {
  ahoraEnSantiago,
  horaAMinutos,
  fechaLocalEnSantiago,
  hoyEnSantiago,
  limitesDelDiaSantiago,
  sumarDiasCalendario,
  diaSemanaCalendario,
} from "@/lib/fecha-santiago";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";

/**
 * Devuelve las métricas operativas del tenant para la fecha indicada.
 *
 * - `totalPedidos`: pedidos con fecha_compromiso en el día (o creados en el día
 *   para same-day sin fecha fija).
 * - `porEstado`: distribución de pedidos por estado (todos los pedidos del tenant).
 * - `tasaEntrega`: (entregado + entregado_manual) / (entregado + entregado_manual +
 *   fallido + fallido_manual + devuelto). `cancelado` queda fuera del
 *   denominador a propósito — ver comentario junto al cálculo.
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

export async function obtenerMetricasDelDia(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: Date,
): Promise<MetricasOperativas> {
  const fechaStr = fechaLocalEnSantiago(fecha);

  // Los bordes del día van en calendario de SANTIAGO. Antes se pegaba
  // `T00:00:00.000Z`/`T23:59:59.999Z` a una fecha civil chilena, lo que corría
  // la ventana 3–4 h: los pedidos creados después de las 20:00 caían en el día
  // siguiente y faltaban en las métricas de hoy, mientras entraban los de la
  // noche anterior. El helper además es semiabierto, así que no se pierde el
  // último milisegundo del día como pasaba con `23:59:59.999`.
  const { desde, hasta } = limitesDelDiaSantiago(fechaStr);

  // Pedidos del día (por fecha_compromiso o creados ese día).
  // service_role accede al esquema directo (las vistas `public` son para el
  // usuario autenticado vía RLS; service_role no tiene grant sobre ellas).
  // ⚠️ PAGINADO, y no por prolijidad: PostgREST corta en 1000 filas SIN avisar,
  // y de acá salen TODOS los agregados del día. Un courier con más de mil
  // pedidos en un día vería un total truncado, una tasa de entrega calculada
  // sobre una muestra arbitraria y un top de comunas incompleto, los tres sin un
  // solo error en los logs. Con el mosaico del dashboard leyendo de esta misma
  // función, el truncamiento pasaría de invisible a decisorio.
  const pedidos = await leerTodasLasFilas<{
    id: string;
    estado: EstadoPedido;
    destinatario_comuna: string | null;
    sla_cumplido: boolean | null;
  }>("pedidos del día", (rangoDesde, rangoHasta) =>
    cliente
      .schema("operacion")
      .from("pedidos")
      .select("id, estado, destinatario_comuna, sla_cumplido")
      .eq("tenant_id", tenantId)
      .or(
        `fecha_compromiso.eq.${fechaStr},` +
          `and(fecha_compromiso.is.null,` +
          `creado_en.gte.${desde.toISOString()},` +
          `creado_en.lt.${hasta.toISOString()})`,
      )
      .range(rangoDesde, rangoHasta),
  );

  const totalPedidos = pedidos.length;

  // Distribución por estado.
  const porEstado: Partial<Record<EstadoPedido, number>> = {};
  for (const p of pedidos) {
    const est: EstadoPedido = p.estado;
    porEstado[est] = (porEstado[est] ?? 0) + 1;
  }

  // Tasa de entrega = entregados / (entregados + fallidos + devueltos).
  // 'cancelado' NO entra en el denominador: mismo criterio que el fix de
  // sla_cumplido en 23107c6 (pedidos.ts) — un pedido cancelado no es un
  // intento de entrega fallido, es una entrega que nadie llegó a pedir.
  // Contarlo aquí hunde la tasa del courier por decisiones del seller
  // (gestionar_pedidos_propios), no por su desempeño.
  // 'devuelto' SÍ se mantiene, a propósito: solo es alcanzable desde
  // en_ruta/fallido/fallido_manual (máquina de estados), es decir que
  // siempre hubo un intento real de entrega que terminó devuelto al origen.
  const entregados =
    (porEstado["entregado"] ?? 0) + (porEstado["entregado_manual"] ?? 0);
  const terminales =
    entregados +
    (porEstado["fallido"] ?? 0) +
    (porEstado["fallido_manual"] ?? 0) +
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
  const fechaAyer = sumarDiasCalendario(fechaStr, -1);
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
  /**
   * Períodos del mes que todavía tienen saldo — los que componen `porCobrarClp`.
   *
   * NO es «períodos abiertos». Un período `facturado` y sin pagar sigue debiendo
   * plata, y es la deuda más urgente, no la menos: el seller ya recibió su
   * factura. Contar solo los abiertos dejaría esa deuda fuera de la bajada del
   * mosaico sin que nada lo dijera. Decisión del usuario, 23-08-2026.
   */
  periodosConSaldo: number;
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
  let periodosConSaldo = 0;
  const filas = data ?? [];

  for (const p of filas) {
    const monto = Number(p.monto_total_clp ?? 0);
    const pagado = Number(p.monto_pagado_clp ?? 0);
    montoPeriodoClp += monto;
    cobradoClp += pagado;
    if (p.estado === "facturado") periodosFacturados += 1;
    if (monto - pagado > 0) periodosConSaldo += 1;
  }

  return {
    montoPeriodoClp,
    cobradoClp,
    porCobrarClp: Math.max(0, montoPeriodoClp - cobradoClp),
    periodosFacturados,
    periodosTotal: filas.length,
    periodosConSaldo,
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
  ventana: 'dia' | 'semana' | 'mes',
): Promise<SlaPorSeller[]> {
  const fechaStr = fechaLocalEnSantiago(fecha);

  // Calcular ventana de fechas. Se restan los días sobre la fecha civil YA
  // expresada en Santiago (`fechaStr`), no sobre el instante: derivarla aparte
  // en UTC hacía que después de las 20:00 el extremo inferior se calculara
  // desde el día siguiente y la ventana "semana" durara 6 días en vez de 7.
  //
  // 'mes' es el MES EN CURSO, del día 1 a hoy — no «los últimos 30 días». El
  // tablero B1c lo dice al pie de la tarjeta: «Vega Hogar no ha despachado este
  // mes». Una ventana móvil de 30 días no permitiría escribir esa frase.
  const fechaDesde =
    ventana === 'mes'
      ? `${fechaStr.slice(0, 7)}-01`
      : ventana === 'semana'
        ? sumarDiasCalendario(fechaStr, -6)
        : fechaStr;

  // Pedidos terminales con sla_cumplido evaluado, en la ventana.
  const TERMINALES_EXITOSOS = ['entregado', 'entregado_manual'];
  const TERMINALES = [...TERMINALES_EXITOSOS, 'fallido', 'fallido_manual', 'cancelado', 'devuelto'];

  // Paginado por lo mismo que los pedidos del día: sobre una ventana de un mes,
  // mil filas se pasan sin esfuerzo y el corte de PostgREST no avisa. El SLA
  // saldría calculado sobre una muestra arbitraria, que es peor que no tenerlo.
  const pedidos = await leerTodasLasFilas<{
    seller_id: string;
    sla_cumplido: boolean | null;
  }>("SLA por seller", (rangoDesde, rangoHasta) =>
    cliente
      .schema("operacion")
      .from("pedidos")
      .select("seller_id, sla_cumplido")
      .eq("tenant_id", tenantId)
      .in("estado", TERMINALES)
      .not("sla_cumplido", "is", null)
      .gte("fecha_compromiso", fechaDesde)
      .lte("fecha_compromiso", fechaStr)
      .range(rangoDesde, rangoHasta),
  );

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
  const diaSemana = diaSemanaCalendario(hoyStr); // 0=dom, 1=lun..6=sab
  const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunesActual = sumarDiasCalendario(hoyStr, -diasDesdeLunes);

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
    const semanaDesde = sumarDiasCalendario(lunesActual, -i * 7);
    const semanaHasta = sumarDiasCalendario(semanaDesde, 6);

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
    // Pedidos cuyo POD gobierna Rutax (eje de `fuente`, no de `tipo_pedido`
    // — ver src/modules/operacion/fuente.ts). Equivalente SQL de
    // `podLoGobiernaLaFuente`: toda fuente salvo las de `FUENTES_CON_POD_EXTERNO`
    // (hoy solo `ml_flex`).
    .neq("fuente", "ml_flex")
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
