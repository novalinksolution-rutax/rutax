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
 */
export async function obtenerMetricasDelDia(
  cliente: SupabaseClient,
  tenantId: string,
  fecha: Date,
): Promise<MetricasOperativas> {
  const fechaStr = fecha.toISOString().split("T")[0]; // 'YYYY-MM-DD'

  // Pedidos del día (por fecha_compromiso o creados ese día).
  const { data: pedidosDia, error: errorPedidos } = await cliente
    .from("pedidos")
    .select("id, estado")
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

  return {
    totalPedidos,
    porEstado,
    tasaEntrega,
    incidenciasAbiertas: incidenciasAbiertas ?? 0,
    conexionesCaidas: conexionesCaidas ?? 0,
  };
}
