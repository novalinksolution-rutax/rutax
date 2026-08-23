import type { LineaLiquidacion } from './tipos';

/**
 * Agrupa una liquidación para la tabla financiera del conductor.
 *
 * QUIÉN LEE ESTA PANTALLA
 * ---------------------------------------------------------------------------
 * El tablero B2b lo dice sin rodeos: **la lee alguien que desconfía del
 * descuento.** Por eso la legibilidad es el problema de diseño y no la
 * estética, y por eso esta agrupación tiene dos exigencias que la de períodos no
 * tiene.
 *
 * LAS DOS CLASES DE LÍNEA, CADA UNA CON SU SUBTOTAL
 * ---------------------------------------------------------------------------
 * Una entrega se paga por tarifa; una visita a bodega, por bodega. Son criterios
 * distintos, y el conductor que reclama pregunta por **una de las dos**. Si van
 * mezcladas en un solo subtotal, la respuesta obliga a rehacer la suma a mano.
 *
 * LOS AJUSTES VAN CON SU MOTIVO
 * ---------------------------------------------------------------------------
 * El bono y la penalización no son dos números sueltos al pie: son dos filas con
 * su motivo escrito, porque **ese texto lo lee el conductor** en su liquidación
 * y en su PDF (regla 24 y NUEVO #11 del bloque 2).
 *
 * ⚠️ El tablero además muestra el AUTOR del ajuste («Aplicó M. Soto el 19-08»).
 * `dinero.liquidaciones` guarda `notaAjuste` pero **no quién lo aplicó**: el
 * autor está en la bitácora, no en la fila. Mostrarlo exige una lectura extra, y
 * hasta entonces esta agrupación no lo inventa.
 */

export interface FilaLiquidacion {
  concepto: string;
  cantidad: number;
  /** `undefined` si las líneas del concepto no comparten monto base. */
  unitario?: number;
  monto: number;
}

export interface AjusteLiquidacion {
  concepto: string;
  monto: number;
  /** Lo lee el conductor. */
  motivo?: string;
}

export interface AgrupacionLiquidacion {
  entregas: FilaLiquidacion[];
  subtotalEntregas: number;
  cantidadEntregas: number;
  visitas: FilaLiquidacion[];
  subtotalVisitas: number;
  cantidadVisitas: number;
  ajustes: AjusteLiquidacion[];
  /** Lo que se le transfiere. */
  neto: number;
}

function agruparPorConcepto(lineas: LineaLiquidacion[]): {
  filas: FilaLiquidacion[];
  subtotal: number;
} {
  const mapa = new Map<string, { cantidad: number; monto: number; bases: Set<number> }>();
  let subtotal = 0;

  for (const l of lineas) {
    const clave = l.concepto || 'Sin concepto';
    const acc = mapa.get(clave) ?? { cantidad: 0, monto: 0, bases: new Set<number>() };
    acc.cantidad += 1;
    acc.monto += l.montoFinalClp;
    acc.bases.add(l.montoFinalClp);
    mapa.set(clave, acc);
    subtotal += l.montoFinalClp;
  }

  const filas = [...mapa.entries()]
    .map(([concepto, v]) => ({
      concepto,
      cantidad: v.cantidad,
      unitario: v.bases.size === 1 ? [...v.bases][0] : undefined,
      monto: v.monto,
    }))
    .sort((a, b) => b.monto - a.monto);

  return { filas, subtotal };
}

export function agruparLiquidacion(
  lineas: LineaLiquidacion[],
  ajuste: { bonoClp: number; penalizacionClp: number; notaAjuste: string | null },
): AgrupacionLiquidacion {
  const entregas = agruparPorConcepto(lineas.filter((l) => l.tipoHecho === 'entrega'));
  const visitas = agruparPorConcepto(lineas.filter((l) => l.tipoHecho === 'retiro_bodega'));

  const ajustes: AjusteLiquidacion[] = [];
  if (ajuste.penalizacionClp > 0) {
    ajustes.push({
      concepto: 'Penalización',
      // Se guarda en positivo y RESTA. Guardar el signo en el campo sería otra
      // forma de que un día alguien sume en vez de restar.
      monto: -ajuste.penalizacionClp,
      motivo: ajuste.notaAjuste ?? undefined,
    });
  }
  if (ajuste.bonoClp > 0) {
    ajustes.push({
      concepto: 'Bono',
      monto: ajuste.bonoClp,
      motivo: ajuste.notaAjuste ?? undefined,
    });
  }

  const neto =
    entregas.subtotal + visitas.subtotal + ajuste.bonoClp - ajuste.penalizacionClp;

  return {
    entregas: entregas.filas,
    subtotalEntregas: entregas.subtotal,
    cantidadEntregas: lineas.filter((l) => l.tipoHecho === 'entrega').length,
    visitas: visitas.filas,
    subtotalVisitas: visitas.subtotal,
    cantidadVisitas: lineas.filter((l) => l.tipoHecho === 'retiro_bodega').length,
    ajustes,
    neto,
  };
}
