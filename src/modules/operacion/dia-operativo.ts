import { limitesDelDiaSantiago } from "@/lib/fecha-santiago";

/**
 * Qué cuenta como «pedido de HOY». Una sola definición para todo el producto.
 * =============================================================================
 *
 * Un pedido es del día si su `fecha_compromiso` es ese día **o** si no tiene
 * fecha y se creó ese día.
 *
 * 🔴 **Por qué existe este archivo (2026-08-27).** La regla vivía copiada en
 * `magnitudes-dashboard.ts` y en `metricas.ts`, cada una con una nota que decía
 * «son la misma regla y tienen que moverse juntas». La lista de Pedidos, en
 * cambio, filtraba con un `.eq` pelado — y en SQL un NULL no satisface ninguna
 * comparación.
 *
 * Resultado: el Dashboard decía «1 de 27» y la lista mostraba 17. Los diez de
 * diferencia eran pedidos reales, con su código y su dirección, **contados por
 * una pantalla y ocultos por la otra**. No hay forma de que el courier resuelva
 * eso mirando: una cifra le dice que existen y la única pantalla donde podría
 * tocarlos no se los muestra.
 *
 * ⚠️ **El NULL ya no puede nacer** —la creación pone hoy desde el 2026-08-27—
 * pero la regla se queda: hay filas históricas con NULL, y una pantalla que las
 * esconde es peor que una que las muestre.
 */
export function filtroPedidosDelDia(fechaStr: string): string {
  const { desde, hasta } = limitesDelDiaSantiago(fechaStr);
  return (
    `fecha_compromiso.eq.${fechaStr},` +
    `and(fecha_compromiso.is.null,` +
    `creado_en.gte.${desde.toISOString()},` +
    `creado_en.lt.${hasta.toISOString()})`
  );
}
