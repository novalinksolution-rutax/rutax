/**
 * Orden básico de paradas (D-04, RF-025).
 *
 * Decisión explícita del producto: SIN IA, SIN optimizador de ruteo.
 * Las paradas de un manifiesto se ordenan alfabéticamente por comuna del
 * destinatario y, dentro de la misma comuna, por dirección del destinatario.
 */

/**
 * Ordena un arreglo de pedidos (o cualquier objeto con los campos de
 * destinatario relevantes) por `destinatarioComuna` y luego por
 * `destinatarioDireccion`, ambos alfabéticamente (localeCompare 'es').
 *
 * No muta el arreglo recibido.
 */
export function ordenarParadasPorComunaYDireccion<
  T extends { destinatarioComuna: string; destinatarioDireccion: string },
>(pedidos: T[]): T[] {
  return [...pedidos].sort((a, b) => {
    const comparacionComuna = a.destinatarioComuna.localeCompare(b.destinatarioComuna, "es", {
      sensitivity: "base",
    });
    if (comparacionComuna !== 0) return comparacionComuna;

    return a.destinatarioDireccion.localeCompare(b.destinatarioDireccion, "es", {
      sensitivity: "base",
    });
  });
}
