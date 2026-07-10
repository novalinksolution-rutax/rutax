/**
 * PREFLIGHT CONSOLIDADO de aprobación por LOTES (§1.4 P1 auditoría).
 * =============================================================================
 * "Reducir clics sin automatizar la decisión irreversible": antes de aprobar
 * varios períodos (facturas) o liquidaciones (pagos) de una vez, el usuario ve
 * un RESUMEN CONSOLIDADO — por elemento (bloqueado/emitible + su preflight) y el
 * total agregado — para luego confirmar EXPLÍCITAMENTE.
 *
 * NO introduce lógica nueva: corre el `preflightEmitirFactura`/`preflightEmitirPago`
 * ya existente por CADA id (100% de lectura) y agrega. La emisión real la hace
 * `acciones-lote.ts`, que a su vez llama la acción individual de cada elemento
 * (con su propio RBAC, bitácora y evento). El lote es orquestación, no un atajo.
 *
 * Secuencial a propósito (no `Promise.all`): no saturar la BD y mantener el
 * orden estable del resumen.
 */

import { preflightEmitirFactura, preflightEmitirPago, type ResultadoPreflight } from './preflight';
import type { ResumenCobro, ResumenPago } from './preflight';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';

/** Tope de elementos por lote — evita un preflight/emisión masiva accidental. */
export const MAX_ELEMENTOS_LOTE = 100;

export interface ItemPreflightLote {
  id: string;
  /** `true` si el preflight no tiene bloqueos → este elemento SÍ se puede emitir. */
  emitible: boolean;
  /** Monto relevante del elemento (total bruto de la factura / líquido del pago). */
  montoClp: number;
  /** Preflight completo del elemento; `null` si el preflight mismo falló al leer. */
  preflight: ResultadoPreflight | null;
  /** Mensaje si el preflight lanzó (elemento no evaluable → no emitible). */
  error: string | null;
}

export interface ResultadoPreflightLote {
  items: ItemPreflightLote[];
  totalItems: number;
  /** Cuántos elementos se pueden emitir (sin bloqueos). Solo estos se confirmarán. */
  emitibles: number;
  /** Cuántos quedaron bloqueados (no se emitirán). */
  bloqueados: number;
  /** Suma de los montos de los elementos EMITIBLES (lo que realmente se emitirá). */
  totalMontoEmitibleClp: number;
}

/** Núcleo genérico: corre `fn` por cada id y agrega, extrayendo el monto con `montoDe`. */
async function preflightLoteGenerico(
  ids: string[],
  fn: (id: string) => Promise<ResultadoPreflight>,
  montoDe: (p: ResultadoPreflight) => number,
): Promise<ResultadoPreflightLote> {
  if (ids.length > MAX_ELEMENTOS_LOTE) {
    throw new Error(`El lote supera el máximo de ${MAX_ELEMENTOS_LOTE} elementos.`);
  }

  const items: ItemPreflightLote[] = [];
  for (const id of ids) {
    try {
      const preflight = await fn(id);
      items.push({
        id,
        emitible: preflight.ok,
        montoClp: montoDe(preflight),
        preflight,
        error: null,
      });
    } catch (err) {
      // El preflight mismo falló (lectura/RBAC): el elemento no es evaluable →
      // no emitible. No aborta el lote — los demás se evalúan igual.
      items.push({
        id,
        emitible: false,
        montoClp: 0,
        preflight: null,
        error: err instanceof Error ? err.message : 'No se pudo verificar el elemento.',
      });
    }
  }

  const emitibles = items.filter((i) => i.emitible);
  return {
    items,
    totalItems: items.length,
    emitibles: emitibles.length,
    bloqueados: items.length - emitibles.length,
    totalMontoEmitibleClp: emitibles.reduce((acc, i) => acc + i.montoClp, 0),
  };
}

/** Preflight consolidado para emitir facturas de varios períodos cerrados. */
export function preflightLoteFacturas(
  tenantId: string,
  periodoIds: string[],
  usuario: UsuarioActual,
): Promise<ResultadoPreflightLote> {
  return preflightLoteGenerico(
    periodoIds,
    (id) => preflightEmitirFactura(tenantId, id, usuario),
    (p) => (p.resumen as ResumenCobro).totalClp,
  );
}

/** Preflight consolidado para pagar varias liquidaciones emitidas. */
export function preflightLotePagos(
  tenantId: string,
  liquidacionIds: string[],
  usuario: UsuarioActual,
): Promise<ResultadoPreflightLote> {
  return preflightLoteGenerico(
    liquidacionIds,
    (id) => preflightEmitirPago(tenantId, id, usuario),
    (p) => (p.resumen as ResumenPago).montoLiquidoClp,
  );
}
