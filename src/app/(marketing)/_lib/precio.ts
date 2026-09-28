/**
 * El precio de Rutax, en pesos y sin IVA. Todo el sitio lee de aquí: la tabla de
 * tramos, la calculadora y las descripciones para buscadores.
 *
 * Historia: $60 por envío único (2026-09-27) → $120 único (2026-09-28) → tramos por
 * volumen, aprobados por el usuario el mismo 2026-09-28.
 *
 * Reglas del cobro (decisión del usuario):
 * · **Solo entregas efectivas.** Un pedido cancelado o que no se entregó no cuenta.
 * · **Tramos graduados**, como los impuestos: cada entrega paga el precio del tramo en
 *   que cae. Así nunca sale más barato quedarse chico — con un precio único por tramo
 *   alcanzado, 3.001 entregas costarían menos que 3.000.
 * · **Mínimo mensual** de $60.000: si las entregas del mes suman menos, se cobra el mínimo.
 *
 * ⚠️ Esto es lo que PUBLICA el sitio. El cobro real de Rutax al courier (backstage,
 * `plataforma.planes`) sigue por planes mensuales; cobrar así exige adaptarlo aparte.
 */

export interface Tramo {
  /** Primera entrega del mes que cae en este tramo. */
  desde: number;
  /** Última entrega del tramo; `null` en el último, que no tiene techo. */
  hasta: number | null;
  /** Precio por entrega, en pesos y sin IVA. */
  precio: number;
}

export const TRAMOS: readonly Tramo[] = [
  { desde: 1, hasta: 3_000, precio: 120 },
  { desde: 3_001, hasta: 10_000, precio: 95 },
  { desde: 10_001, hasta: 25_000, precio: 75 },
  { desde: 25_001, hasta: null, precio: 60 },
];

export const MINIMO_MENSUAL_CLP = 60_000;

/** El precio del primer tramo: lo que paga un courier que recién empieza. */
export const PRECIO_BASE_CLP = TRAMOS[0].precio;
/** El precio del último tramo, el más bajo. */
export const PRECIO_MINIMO_CLP = TRAMOS[TRAMOS.length - 1].precio;

/** Lo que se cobra en un mes con `entregas` entregas efectivas, sin IVA. */
export function costoMensual(entregas: number): { total: number; aplicaMinimo: boolean; promedio: number } {
  let suma = 0;
  for (const t of TRAMOS) {
    const techo = t.hasta ?? Infinity;
    if (entregas < t.desde) break;
    suma += (Math.min(entregas, techo) - t.desde + 1) * t.precio;
  }
  const aplicaMinimo = suma < MINIMO_MENSUAL_CLP;
  const total = Math.max(suma, MINIMO_MENSUAL_CLP);
  return { total, aplicaMinimo, promedio: entregas > 0 ? total / entregas : 0 };
}

/** WhatsApp de ventas (no el de avisos, que es de la Cloud API). Solo dígitos. */
export const WHATSAPP_VENTAS = "56935775531";
