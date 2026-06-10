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
import type { MetricasOperativas, EstadoPedido } from "./tipos";

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

/** Estados de pedido considerados terminales para "rezagados de ayer". */
const ESTADOS_TERMINALES_PEDIDO: readonly EstadoPedido[] = [
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
  const fechaStr = fecha.toISOString().split("T")[0]; // 'YYYY-MM-DD'

  // Pedidos del día (por fecha_compromiso o creados ese día).
  const { data: pedidosDia, error: errorPedidos } = await cliente
    .from("pedidos")
    .select("id, estado, destinatario_comuna")
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
    .from("incidencias")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("estado", ["abierta", "en_gestion"]);

  if (errorIncidencias) {
    throw new Error(`Error al contar incidencias: ${errorIncidencias.message}`);
  }

  // Conexiones ML caídas (estado_salud = 'desvinculada') del tenant.
  const { count: conexionesCaidas, error: errorConexiones } = await cliente
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
    .from("pedidos")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("fecha_compromiso", fechaAyer)
    .not("estado", "in", `(${ESTADOS_TERMINALES_PEDIDO.join(",")})`);

  if (errorRezagados) {
    throw new Error(`Error al contar rezagados de ayer: ${errorRezagados.message}`);
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
  };
}
