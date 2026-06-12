/**
 * Lógica PURA de la cascada de matching de cobranza (Decisión 6 del arquitecto,
 * `docs/arquitectura/cobranza-fintoc.md`).
 * =============================================================================
 *
 * Esta es la regla de dinero del flujo de cobranza, extraída como funciones
 * puras (sin Supabase, sin Inngest) para que el job (`jobs/conciliar-pago.ts`)
 * solo orqueste E/S y estas funciones decidan. Permite probar la cascada
 * exhaustivamente sin tocar BD.
 *
 * INVARIANTES (no relajar):
 * - CLP entero en todo momento.
 * - El matching NUNCA adivina: si hay ambigüedad (varios períodos candidatos) o
 *   el monto excede el saldo, cae a `sobrante` para revisión humana.
 * - La glosa (`comment`/`description`) NO es llave de atribución automática.
 * - El RUT se compara YA normalizado en ambos lados (mismo `normalizarRut`).
 */

import { normalizarRut } from '@/modules/integraciones/pagos';

/** Tolerancia de calce de monto, en CLP. ±1 absorbe redondeos del proveedor. */
export const TOLERANCIA_CALCE_CLP = 1;

/** Estados terminales: un pago en estos estados ya no se reprocesa. */
export const ESTADOS_MATCH_TERMINALES = ['conciliado', 'descartado'] as const;

export type EstadoMatchPago =
  | 'sin_atribuir'
  | 'atribuido'
  | 'conciliado'
  | 'parcial'
  | 'sobrante'
  | 'descartado';

export function esEstadoTerminal(estado: string): boolean {
  return (ESTADOS_MATCH_TERMINALES as readonly string[]).includes(estado);
}

/**
 * Atribuye un pago a un seller por RUT normalizado. Devuelve el `sellerId` si
 * exactamente un seller del tenant tiene ese RUT; `null` si no hay RUT, no hay
 * match, o hay más de uno (no se adivina entre homónimos de RUT — improbable,
 * pero el contrato es "no adivinar").
 *
 * Ambos lados se normalizan con el MISMO `normalizarRut` para que la comparación
 * sea estable independientemente del formato de origen.
 */
export function atribuirSellerPorRut(
  rutContraparteNormalizado: string | null,
  sellers: ReadonlyArray<{ id: string; rut: string | null }>,
): string | null {
  const rutPago = normalizarRut(rutContraparteNormalizado);
  if (!rutPago) return null;

  const candidatos = sellers.filter((s) => normalizarRut(s.rut) === rutPago);
  if (candidatos.length === 1) return candidatos[0].id;
  return null; // 0 o >1 candidatos → no atribuir.
}

/** Período facturado candidato a conciliar, con su saldo ya calculado afuera. */
export interface PeriodoCandidato {
  id: string;
  /** `monto_total_clp - monto_pagado_clp` (CLP entero, >= 0). */
  saldoClp: number;
}

/** Resultado de la decisión de conciliación contra los períodos candidatos. */
export type ResultadoConciliacion =
  | {
      /** El pago salda exactamente (±tolerancia) el saldo de un período. */
      tipo: 'pagado_total';
      periodoId: string;
      /** Monto imputado al período (= el monto del pago). */
      montoImputadoClp: number;
    }
  | {
      /** El pago abona parcialmente el saldo de un único período candidato. */
      tipo: 'pagado_parcial';
      periodoId: string;
      montoImputadoClp: number;
    }
  | {
      /**
       * El monto excede el saldo, o hay ambigüedad (varios candidatos calzan, o
       * el abono parcial no es atribuible a un único período). NO se imputa.
       */
      tipo: 'sobrante';
    }
  | {
      /** No hay período candidato (seller sin períodos facturados impagos). */
      tipo: 'sin_candidato';
    };

/**
 * Cascada de conciliación de la Decisión 6, sobre los períodos `facturado` con
 * `estado_cobro in ('pendiente','parcial')` del seller atribuido:
 *
 *  1. Calce TOTAL: algún período cuyo saldo ≈ monto (±`TOLERANCIA_CALCE_CLP`).
 *     - exactamente uno → `pagado_total` (salda ese período).
 *     - varios calzan → `sobrante` (ambigüedad: no adivinar a cuál imputar).
 *  2. ABONO PARCIAL: el monto es menor que el saldo de un ÚNICO período
 *     candidato → `pagado_parcial` (se imputa a ese período).
 *     - si hay >1 período candidato, no se sabe a cuál abonar → `sobrante`.
 *  3. monto > todos los saldos, o ningún candidato → `sobrante` / `sin_candidato`.
 *
 * `montoClp` debe ser CLP entero positivo.
 */
export function decidirConciliacion(
  montoClp: number,
  candidatos: ReadonlyArray<PeriodoCandidato>,
): ResultadoConciliacion {
  if (candidatos.length === 0) {
    return { tipo: 'sin_candidato' };
  }

  // 1. Calce total (±tolerancia).
  const calzanTotal = candidatos.filter(
    (p) => Math.abs(p.saldoClp - montoClp) <= TOLERANCIA_CALCE_CLP,
  );
  if (calzanTotal.length === 1) {
    return {
      tipo: 'pagado_total',
      periodoId: calzanTotal[0].id,
      montoImputadoClp: montoClp,
    };
  }
  if (calzanTotal.length > 1) {
    // Varios saldos idénticos calzan: no se puede saber cuál pagó el seller.
    return { tipo: 'sobrante' };
  }

  // 2. Abono parcial: el monto cabe (es menor) dentro del saldo de algún período.
  const cabenParcial = candidatos.filter((p) => montoClp < p.saldoClp);
  if (cabenParcial.length === 1) {
    return {
      tipo: 'pagado_parcial',
      periodoId: cabenParcial[0].id,
      montoImputadoClp: montoClp,
    };
  }
  if (cabenParcial.length > 1) {
    // Cabe en varios → ambiguo a cuál abonar. No adivinar.
    return { tipo: 'sobrante' };
  }

  // 3. El monto excede todos los saldos (sobrepago) → sobrante.
  return { tipo: 'sobrante' };
}

/**
 * Mapea el resultado de la cascada al `estado_match` final del pago.
 * `atribuido` indica que hay seller pero ningún período pudo conciliarse.
 */
export function estadoMatchDesdeResultado(
  resultado: ResultadoConciliacion,
  hayseller: boolean,
): EstadoMatchPago {
  switch (resultado.tipo) {
    case 'pagado_total':
      return 'conciliado';
    case 'pagado_parcial':
      return 'parcial';
    case 'sobrante':
      return 'sobrante';
    case 'sin_candidato':
      return hayseller ? 'atribuido' : 'sin_atribuir';
  }
}
