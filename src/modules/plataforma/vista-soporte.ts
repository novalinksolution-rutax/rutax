/**
 * Proyección de solo lectura "ver como el courier" (gap 4, F3-B) —
 * `obtenerVistaSoporteTenant`.
 * =============================================================================
 * Gateada por `exigirSoporteActivo` (`soporte.ts`): sin sesión de soporte
 * vigente para el tenant pedido, esta función lanza `NoHaySesionSoporte` antes
 * de tocar ninguna tabla. Nunca asume la sesión del courier ni abre un bypass
 * de RLS distinto del que ya usa el resto de `plataforma` (`service_role`,
 * deny-all para `authenticated`).
 *
 * COMPONE lo que YA existe, no reimplementa:
 * - `obtenerObservabilidadTenant` (`observabilidad-tenant.ts`) — salud de
 *   conexiones ML, backlog operativo, alertas recientes y estado de
 *   suscripción/morosidad. Ya está vetado como sin-PII (ver cabecera de ese
 *   módulo) — se reusa TAL CUAL, sin re-derivar ningún criterio.
 * - Además, DOS lecturas nuevas y mínimas, acotadas a lo que un agente de
 *   soporte necesita para orientarse sin ver PII:
 *   - `ultimosPedidos`: los N pedidos más recientes del tenant, SOLO campos
 *     operativos (id, estado, fuente, código interno, fecha).
 *   - `resumenDinero`: totales agregados (conteo + montos) de períodos de
 *     cobro y liquidaciones, agrupados por estado — sin fila por pedido/línea
 *     ni por conductor.
 *
 * MINIMIZACIÓN DE PII (Ley 21.431 / motor-entrega-dinero) — qué se INCLUYE y
 * qué se EXCLUYE a propósito, para que `seguridad-cumplimiento` audite el
 * whitelist:
 *   INCLUYE: ids (uuid), estados (enums), montos agregados (CLP), conteos,
 *     fechas, la `fuente` del pedido (ml_flex/rutax_manual/shopify) y
 *     `codigo_interno` (identificador operativo interno, no público, no
 *     personal).
 *   EXCLUYE explícitamente: `destinatario_nombre`, `destinatario_direccion`,
 *     `destinatario_comuna`, `destinatario_telefono`, `instrucciones_entrega`
 *     (Ley 21.431 del destinatario) — NINGUNO de estos campos se selecciona en
 *     la query de pedidos. Tampoco se selecciona `driver_id`/nombre de
 *     conductor en ningún punto: `resumenDinero.liquidaciones` es un agregado
 *     por `estado` (no una lista de liquidaciones), así que no hay fila
 *     identificable a un conductor concreto. `seller_id`/nombre de seller
 *     tampoco se expone (no se necesita para orientar soporte operativo).
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { exigirSoporteActivo, type SesionSoporte } from "./soporte";
import { obtenerObservabilidadTenant, type ObservabilidadTenant } from "./observabilidad-tenant";
import type { EstadoPedido, FuentePedido } from "@/modules/operacion/tipos";
import type { EstadoPeriodo, EstadoLiquidacion } from "@/modules/dinero/tipos";

/** Cuántos pedidos recientes se muestran — acotado, es un vistazo, no un listado completo. */
const LIMITE_PEDIDOS_SOPORTE = 10;

// =============================================================================
// Tipos
// =============================================================================

/** Pedido — SOLO campos operativos, sin ningún dato del destinatario. */
export interface PedidoOperativoSoporte {
  id: string;
  estado: EstadoPedido;
  /**
   * Procedencia real del pedido (`ml_flex` | `rutax_manual` | `shopify`) —
   * columna `operacion.pedidos.fuente`, el eje AUTORITATIVO. Antes de que
   * Shopify entrara como fuente, este campo exponía `tipo_pedido` con el mismo
   * nombre (`flex` | `same_day`), que es el régimen de tarifa, NO la
   * procedencia — un pedido Shopify (tipo_pedido='same_day') salía rotulado
   * "same_day" en vez de "shopify" en esta vista de soporte. Corregido
   * 2026-08-16: se selecciona `fuente` directamente.
   */
  fuente: FuentePedido;
  /** Identificador operativo interno (QR de etiqueta same-day). `null` en Flex. */
  codigoInterno: string | null;
  /** `fecha_compromiso` si existe; si no, `creado_en` (ISO). */
  fecha: string;
}

export interface ResumenPeriodoCobroSoporte {
  estado: EstadoPeriodo;
  cantidad: number;
  montoTotalClp: number;
  montoPagadoClp: number;
}

export interface ResumenLiquidacionSoporte {
  estado: EstadoLiquidacion;
  cantidad: number;
  montoTotalClp: number;
}

/** Totales agregados por estado — nunca una fila por pedido/conductor. */
export interface ResumenDineroTenantSoporte {
  periodosCobro: ResumenPeriodoCobroSoporte[];
  liquidaciones: ResumenLiquidacionSoporte[];
}

export interface VistaSoporteTenant {
  tenantId: string;
  sesion: SesionSoporte;
  observabilidad: ObservabilidadTenant;
  ultimosPedidos: PedidoOperativoSoporte[];
  resumenDinero: ResumenDineroTenantSoporte;
}

// =============================================================================
// Lecturas
// =============================================================================

async function obtenerUltimosPedidosSoporte(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
): Promise<PedidoOperativoSoporte[]> {
  const { data, error } = await supabase
    .schema("operacion")
    .from("pedidos")
    // Deliberadamente SIN destinatario_nombre/direccion/comuna/telefono ni
    // instrucciones_entrega — ver cabecera del módulo (minimización PII).
    .select("id, estado, fuente, codigo_interno, fecha_compromiso, creado_en")
    .eq("tenant_id", tenantId)
    .order("creado_en", { ascending: false })
    .limit(LIMITE_PEDIDOS_SOPORTE);

  if (error) throw new Error(`Error al leer los últimos pedidos del tenant: ${error.message}`);

  return (data ?? []).map((f) => ({
    id: f.id as string,
    estado: f.estado as EstadoPedido,
    // Fail-closed a 'ml_flex' si la columna no vino en el SELECT — mismo
    // criterio que `filaAPedido` en operacion/pedidos.ts.
    fuente: (f.fuente as FuentePedido | null) ?? "ml_flex",
    codigoInterno: (f.codigo_interno as string | null) ?? null,
    fecha: (f.fecha_compromiso as string | null) ?? (f.creado_en as string),
  }));
}

async function obtenerResumenDineroSoporte(
  supabase: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
): Promise<ResumenDineroTenantSoporte> {
  const [periodosResp, liquidacionesResp] = await Promise.all([
    supabase
      .schema("dinero")
      .from("periodos_cobro")
      .select("estado, monto_total_clp, monto_pagado_clp")
      .eq("tenant_id", tenantId),
    supabase
      .schema("dinero")
      .from("liquidaciones")
      // driver_id NUNCA se selecciona — agregado por estado, no por conductor.
      .select("estado, monto_total_clp")
      .eq("tenant_id", tenantId),
  ]);

  if (periodosResp.error) {
    throw new Error(`Error al leer períodos de cobro del tenant: ${periodosResp.error.message}`);
  }
  if (liquidacionesResp.error) {
    throw new Error(`Error al leer liquidaciones del tenant: ${liquidacionesResp.error.message}`);
  }

  const periodosPorEstado = new Map<EstadoPeriodo, ResumenPeriodoCobroSoporte>();
  for (const f of periodosResp.data ?? []) {
    const estado = f.estado as EstadoPeriodo;
    const acc = periodosPorEstado.get(estado) ?? { estado, cantidad: 0, montoTotalClp: 0, montoPagadoClp: 0 };
    acc.cantidad += 1;
    acc.montoTotalClp += Number(f.monto_total_clp ?? 0);
    acc.montoPagadoClp += Number(f.monto_pagado_clp ?? 0);
    periodosPorEstado.set(estado, acc);
  }

  const liquidacionesPorEstado = new Map<EstadoLiquidacion, ResumenLiquidacionSoporte>();
  for (const f of liquidacionesResp.data ?? []) {
    const estado = f.estado as EstadoLiquidacion;
    const acc = liquidacionesPorEstado.get(estado) ?? { estado, cantidad: 0, montoTotalClp: 0 };
    acc.cantidad += 1;
    acc.montoTotalClp += Number(f.monto_total_clp ?? 0);
    liquidacionesPorEstado.set(estado, acc);
  }

  return {
    periodosCobro: Array.from(periodosPorEstado.values()),
    liquidaciones: Array.from(liquidacionesPorEstado.values()),
  };
}

// =============================================================================
// obtenerVistaSoporteTenant
// =============================================================================

/**
 * Vista de soporte curada de UN tenant — solo lectura, gateada por
 * `exigirSoporteActivo(tenantId)` (lanza `NoHaySesionSoporte` si no hay una
 * ventana de soporte vigente para ese tenant). Compón observabilidad ya
 * existente + dos lecturas mínimas nuevas, sin PII de destinatario ni de
 * conductor (ver cabecera).
 */
export async function obtenerVistaSoporteTenant(tenantId: string): Promise<VistaSoporteTenant> {
  const sesion = await exigirSoporteActivo(tenantId);

  const supabase = crearClienteServiceRole();

  const [observabilidad, ultimosPedidos, resumenDinero] = await Promise.all([
    obtenerObservabilidadTenant(tenantId),
    obtenerUltimosPedidosSoporte(supabase, tenantId),
    obtenerResumenDineroSoporte(supabase, tenantId),
  ]);

  return { tenantId, sesion, observabilidad, ultimosPedidos, resumenDinero };
}
