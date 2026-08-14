/**
 * Orden de paradas de un manifiesto.
 * =====================================================================
 *
 * Hay DOS órdenes, y el de arriba manda:
 *
 *   1. LA SECUENCIA PERSISTIDA (`asignaciones_pedido.orden_ruta`, etapa 7 —
 *      migración 20260814000004). Es la ruta de verdad: la calcula el motor
 *      (`operacion/ruteo/`) o la fija a mano el coordinador, y la escribe
 *      `operacion.aplicar_secuencia_paradas`.
 *   2. EL ORDEN ALFABÉTICO por comuna y dirección (D-04, RF-025). NO se retira
 *      y no es un vestigio: es el respaldo legítimo del manifiesto que todavía
 *      nadie ruteó, y de la parada que el motor no pudo ubicar por no tener
 *      coordenada usable.
 *
 * ⚠️ Antes de la etapa 7 el alfabético era lo único que había, se aplicaba en
 * TRES puntos de render distintos y no se persistía en ninguna parte: lo que veía
 * el conductor era un orden accidental que se recalculaba en cada carga de
 * pantalla. `ordenarParadasConSecuencia` es la puerta por la que esos tres
 * puntos pasan ahora, para que el orden que se planificó sea el que se ve.
 */

/**
 * Ordena un arreglo de pedidos (o cualquier objeto con los campos de
 * destinatario relevantes) por `destinatarioComuna` y luego por
 * `destinatarioDireccion`, ambos alfabéticamente (localeCompare 'es').
 *
 * Es el RESPALDO, no el orden principal — ver la cabecera. Se sigue exportando
 * porque `ordenarParadasConSecuencia` lo usa y porque un manifiesto sin rutear
 * tiene que salir ordenado de alguna forma estable.
 *
 * No muta el arreglo recibido.
 */
export function ordenarParadasPorComunaYDireccion<
  T extends { destinatarioComuna: string; destinatarioDireccion: string },
>(pedidos: T[]): T[] {
  return [...pedidos].sort((a, b) => compararPorComunaYDireccion(a, b));
}

function compararPorComunaYDireccion(
  a: { destinatarioComuna: string; destinatarioDireccion: string },
  b: { destinatarioComuna: string; destinatarioDireccion: string },
): number {
  const comparacionComuna = a.destinatarioComuna.localeCompare(b.destinatarioComuna, "es", {
    sensitivity: "base",
  });
  if (comparacionComuna !== 0) return comparacionComuna;

  return a.destinatarioDireccion.localeCompare(b.destinatarioDireccion, "es", {
    sensitivity: "base",
  });
}

/**
 * Orden de las paradas de un manifiesto, PREFIRIENDO la secuencia persistida.
 *
 * `ordenPorPedidoId` mapea `pedido.id` → `asignaciones_pedido.orden_ruta` de la
 * asignación activa. Las paradas ausentes del mapa (o con valor nulo) son las que
 * no están ruteadas.
 *
 * Reglas, en este orden:
 *
 *   1. Si NINGUNA parada tiene secuencia, el resultado es exactamente el orden
 *      alfabético de siempre. Un manifiesto sin rutear se ve hoy igual que ayer.
 *   2. Si algunas la tienen, esas van primero y en su orden; las demás van
 *      DESPUÉS, entre sí alfabéticamente. Nunca se descartan: una parada sin
 *      coordenada sigue siendo un paquete que hay que entregar, y esconderla del
 *      manifiesto sería perderla.
 *   3. Un empate de `orden_ruta` no puede ocurrir —lo impide el índice único
 *      parcial `idx_asignaciones_secuencia_manifiesto_uk`— pero se desempata
 *      igual por comuna y dirección: un orden no determinista en la pantalla del
 *      conductor sería imposible de diagnosticar desde la calle.
 *
 * No muta el arreglo recibido.
 */
export function ordenarParadasConSecuencia<
  T extends { id: string; destinatarioComuna: string; destinatarioDireccion: string },
>(pedidos: T[], ordenPorPedidoId: ReadonlyMap<string, number | null | undefined>): T[] {
  const conSecuencia: { pedido: T; orden: number }[] = [];
  const sinSecuencia: T[] = [];

  for (const pedido of pedidos) {
    const orden = ordenPorPedidoId.get(pedido.id);
    // `Number.isFinite` y no `!= null`: un `orden_ruta` que llegue como texto no
    // numérico o como NaN por una serialización rara debe caer al respaldo, no
    // colarse como posición y arrastrar toda la ruta.
    if (typeof orden === "number" && Number.isFinite(orden)) {
      conSecuencia.push({ pedido, orden });
    } else {
      sinSecuencia.push(pedido);
    }
  }

  if (conSecuencia.length === 0) {
    return ordenarParadasPorComunaYDireccion(pedidos);
  }

  conSecuencia.sort((a, b) => {
    if (a.orden !== b.orden) return a.orden - b.orden;
    return compararPorComunaYDireccion(a.pedido, b.pedido);
  });

  return [
    ...conSecuencia.map((x) => x.pedido),
    ...ordenarParadasPorComunaYDireccion(sinSecuencia),
  ];
}
