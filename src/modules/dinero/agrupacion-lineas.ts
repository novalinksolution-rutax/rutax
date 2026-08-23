import type { LineaCobro } from './tipos';

/**
 * Agrupa las líneas de cobro de un período por concepto, para la tabla
 * financiera.
 *
 * POR QUÉ AGRUPAR
 * ---------------------------------------------------------------------------
 * El tablero B2a: **285 filas no se auditan.** Tres conceptos con subtotal, los
 * ajustes explícitos con su origen, y el detalle línea por línea a un clic para
 * cuando hace falta. Es lo que permite cuadrar sin exportar a una planilla.
 *
 * LA INVARIANTE QUE SOSTIENE TODO
 * ---------------------------------------------------------------------------
 * **subtotal de entregas + suma de ajustes = total del período**, y el total
 * tiene que ser exactamente `Σ montoFinalClp`. Si no cuadra, la tabla miente —
 * y una tabla de dinero que no cuadra es peor que no tenerla, porque quien la
 * revisa deja de confiar en el producto entero. La prueba lo verifica sobre
 * datos con ajustes positivos, negativos y mezclados.
 *
 * SOBRE LA TARIFA UNITARIA
 * ---------------------------------------------------------------------------
 * Se muestra **solo si todas las líneas del concepto comparten el mismo monto
 * base**. Con montos distintos, un promedio sería un número que no existe en
 * ninguna línea y que no reconstruye el subtotal; ahí la columna va vacía.
 */

export interface FilaAgrupada {
  concepto: string;
  entregas: number;
  /** `undefined` cuando las líneas del concepto no comparten monto base. */
  tarifa?: number;
  monto: number;
}

export interface AjusteAgrupado {
  concepto: string;
  monto: number;
  /** El pedido que lo originó, cuando el ajuste viene de una sola línea. */
  pedidoId?: string;
}

export interface AgrupacionLineasCobro {
  /** Un renglón por concepto, con su cuenta y su monto base. */
  conceptos: FilaAgrupada[];
  /** Σ de los montos BASE. Sin ajustes. */
  subtotalEntregas: number;
  entregasTotales: number;
  /** Un renglón por línea con ajuste distinto de cero. */
  ajustes: AjusteAgrupado[];
  /** Σ `montoFinalClp`. Es la cifra que se factura. */
  total: number;
}

export function agruparLineasCobro(lineas: LineaCobro[]): AgrupacionLineasCobro {
  const porConcepto = new Map<string, { entregas: number; monto: number; bases: Set<number> }>();
  const ajustes: AjusteAgrupado[] = [];
  let subtotalEntregas = 0;
  let total = 0;

  for (const l of lineas) {
    const clave = l.concepto || 'Sin concepto';
    const acumulado = porConcepto.get(clave) ?? { entregas: 0, monto: 0, bases: new Set<number>() };
    acumulado.entregas += 1;
    acumulado.monto += l.montoBaseClp;
    acumulado.bases.add(l.montoBaseClp);
    porConcepto.set(clave, acumulado);

    subtotalEntregas += l.montoBaseClp;
    total += l.montoFinalClp;

    if (l.ajusteIncidenciaClp !== 0) {
      ajustes.push({
        concepto: 'Ajuste por incidencia',
        monto: l.ajusteIncidenciaClp,
        pedidoId: l.pedidoId,
      });
    }
  }

  const conceptos: FilaAgrupada[] = [...porConcepto.entries()]
    .map(([concepto, v]) => ({
      concepto,
      entregas: v.entregas,
      // Una sola base distinta ⇒ es la tarifa. Varias ⇒ no hay una tarifa que
      // mostrar, y un promedio sería un número inventado.
      tarifa: v.bases.size === 1 ? [...v.bases][0] : undefined,
      monto: v.monto,
    }))
    // Del más grande al más chico: el concepto que mueve la aguja va primero.
    .sort((a, b) => b.monto - a.monto);

  return {
    conceptos,
    subtotalEntregas,
    entregasTotales: lineas.length,
    ajustes,
    total,
  };
}
