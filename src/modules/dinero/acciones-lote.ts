/**
 * EMISIÓN por LOTES de acciones financieras irreversibles (§1.4 P1 auditoría).
 * =============================================================================
 * Ejecuta la aprobación de VARIOS elementos tras la confirmación humana
 * explícita. Invariante NO-NEGOCIABLE: NO es una vía paralela ni un atajo — hace
 * un loop sobre la MISMA acción individual (`emitirFacturaPeriodo` /
 * `emitirPagoLiquidacion`), así que cada elemento conserva su RBAC, su preflight
 * (revalidado dentro de la acción), su BITÁCORA con autor (RNF-04) y su evento
 * Inngest. La selección múltiple reduce clics; NO automatiza la decisión.
 *
 * Aislamiento de fallos: un elemento que falla NO cancela los demás (cada uno se
 * captura por separado) — se devuelve un resultado por elemento para que la UI
 * muestre qué se emitió y qué no.
 *
 * Secuencial a propósito: cada acción publica un evento y escribe bitácora; el
 * orden estable y no saturar la BD importan más que el paralelismo (los lotes
 * son de decenas, no miles).
 */

import { emitirFacturaPeriodo, emitirPagoLiquidacion } from './acciones';
import { MAX_ELEMENTOS_LOTE } from './preflight-lote';
import type { UsuarioActual } from '@/modules/identidad/usuario-actual';

export interface ResultadoItemLote {
  id: string;
  ok: boolean;
  mensaje: string | null;
}

export interface ResultadoLote {
  resultados: ResultadoItemLote[];
  exitosos: number;
  fallidos: number;
}

/**
 * Núcleo genérico: ejecuta `accion` por cada id, capturando fallos por elemento
 * (aislamiento: uno que falla no cancela los demás). Exportado para testear el
 * aislamiento/agregación inyectando una acción simulada, sin BD.
 */
export async function ejecutarLoteConAislamiento(
  ids: string[],
  accion: (id: string) => Promise<void>,
): Promise<ResultadoLote> {
  if (ids.length > MAX_ELEMENTOS_LOTE) {
    throw new Error(`El lote supera el máximo de ${MAX_ELEMENTOS_LOTE} elementos.`);
  }

  const resultados: ResultadoItemLote[] = [];
  for (const id of ids) {
    try {
      await accion(id);
      resultados.push({ id, ok: true, mensaje: null });
    } catch (err) {
      resultados.push({
        id,
        ok: false,
        mensaje: err instanceof Error ? err.message : 'Error desconocido.',
      });
    }
  }

  const exitosos = resultados.filter((r) => r.ok).length;
  return { resultados, exitosos, fallidos: resultados.length - exitosos };
}

/** Emite en lote las facturas (DTE) de varios períodos cerrados. */
export function emitirFacturasLote(
  tenantId: string,
  periodoIds: string[],
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<ResultadoLote> {
  return ejecutarLoteConAislamiento(periodoIds, (id) =>
    emitirFacturaPeriodo(tenantId, id, usuario, actorUsuarioId),
  );
}

/** Solicita en lote el pago de varias liquidaciones emitidas. */
export function emitirPagosLoteLiquidaciones(
  tenantId: string,
  liquidacionIds: string[],
  usuario: UsuarioActual,
  actorUsuarioId: string,
): Promise<ResultadoLote> {
  return ejecutarLoteConAislamiento(liquidacionIds, (id) =>
    emitirPagoLiquidacion(tenantId, id, usuario, actorUsuarioId),
  );
}
