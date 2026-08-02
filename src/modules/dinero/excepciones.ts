/**
 * Bandeja de excepciones — hook consumido por `preflight.ts` (§1.1 P1, jul 2026).
 * =============================================================================
 *
 * Consulta `dinero.eventos_conciliacion` por excepciones ABIERTAS (estado
 * no-terminal) con `bloquea_facturacion`/`bloquea_pago` en `true` para la
 * entidad afectada (período/seller o liquidación/conductor). El resto del
 * preflight (`preflight.ts`) ya está cableado para consumir el resultado y
 * agregarlo a `bloqueos`, sin que el llamador (Server Action, frontend) tenga
 * que cambiar.
 *
 * Por qué vive separado de `preflight.ts`: mantiene la superficie de
 * extensión aislada de las reglas de dominio (estado, folios, RUT, etc.).
 *
 * Nota de diseño (arquitecto): los flags de bloqueo NO se auto-limpian al
 * llegar la excepción a un estado terminal — por eso el filtro por estado
 * no-terminal de abajo es lo que efectivamente "apaga" el bloqueo cuando la
 * excepción se cierra, aunque los flags sigan en `true` en la fila (se
 * preservan para auditoría).
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { ESTADOS_NO_TERMINALES_CONCILIACION } from './conciliacion-clasificacion';
import type { ItemPreflight } from './preflight';

export interface CtxBloqueoFacturacion {
  tenantId: string;
  periodoCobroId: string;
  sellerId: string;
}

export interface CtxBloqueoPago {
  tenantId: string;
  liquidacionId: string;
  driverId: string;
}

export interface ResultadoBloqueo {
  bloquea: boolean;
  motivos: ItemPreflight[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filaAItemPreflight(fila: Record<string, any>, titulo: string): ItemPreflight {
  return {
    codigo: 'bandeja_excepciones',
    categoria: 'bloquea',
    titulo,
    detalle: (fila.motivo_bloqueo as string | null) ?? 'Sin motivo registrado — revisa la bandeja de conciliación.',
    meta: {
      evento_id: fila.id as string,
      tipo_diferencia: fila.tipo_diferencia as string,
      estado: fila.estado as string,
      monto_diferencia_clp:
        fila.monto_diferencia_clp !== null && fila.monto_diferencia_clp !== undefined
          ? Number(fila.monto_diferencia_clp)
          : null,
      fecha_limite: (fila.fecha_limite as string | null) ?? null,
    },
  };
}

/**
 * Verifica si existe una excepción de conciliación abierta que deba bloquear
 * la facturación/nota de crédito de este período (por período o por seller).
 */
export async function bloqueaFacturacion(ctx: CtxBloqueoFacturacion): Promise<ResultadoBloqueo> {
  const supabase = crearClienteServiceRole();

  const { data, error } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .select('id, tipo_diferencia, estado, monto_diferencia_clp, fecha_limite, motivo_bloqueo')
    .eq('tenant_id', ctx.tenantId)
    .eq('bloquea_facturacion', true)
    .in('estado', ESTADOS_NO_TERMINALES_CONCILIACION)
    .or(`periodo_cobro_id.eq.${ctx.periodoCobroId},seller_id.eq.${ctx.sellerId}`);

  if (error) throw new Error(`Error al verificar bloqueos de facturación: ${error.message}`);

  const motivos = (data ?? []).map((fila) => filaAItemPreflight(fila, 'Facturación bloqueada por excepción'));
  return { bloquea: motivos.length > 0, motivos };
}

/**
 * Verifica si existe una excepción de conciliación abierta que deba bloquear
 * el pago de esta liquidación (por liquidación o por conductor).
 */
export async function bloqueaPago(ctx: CtxBloqueoPago): Promise<ResultadoBloqueo> {
  const supabase = crearClienteServiceRole();

  const { data, error } = await supabase
    .schema('dinero')
    .from('eventos_conciliacion')
    .select('id, tipo_diferencia, estado, monto_diferencia_clp, fecha_limite, motivo_bloqueo')
    .eq('tenant_id', ctx.tenantId)
    .eq('bloquea_pago', true)
    .in('estado', ESTADOS_NO_TERMINALES_CONCILIACION)
    .or(`liquidacion_id.eq.${ctx.liquidacionId},driver_id.eq.${ctx.driverId}`);

  if (error) throw new Error(`Error al verificar bloqueos de pago: ${error.message}`);

  const motivos = (data ?? []).map((fila) => filaAItemPreflight(fila, 'Pago bloqueado por excepción'));
  return { bloquea: motivos.length > 0, motivos };
}
