/**
 * Utilidad de ETA (Estimated Time of Arrival) para pedidos same-day.
 *
 * En el MVP, la ETA es simplemente `fecha_compromiso_hora` calculada en
 * `crearPedidoSameDay` a partir de la ventana de corte configurada.
 * Sin optimizador, sin cálculo de ruta en vivo.
 *
 * Esta función expone ese campo en un contrato claro para el frontend y para
 * el Bloque 3, sin necesidad de que el consumidor conozca la columna interna.
 */

import type { Pedido } from "./tipos";

export interface EtaSameDay {
  pedidoId: string;
  /** ISO timestamptz de la entrega estimada. null si no hay ventana configurada. */
  fechaCompromisoHora: string | null;
  /** true si el pedido fue creado fuera del horario de corte (riesgo SLA). */
  corteRiesgo: boolean;
}

/**
 * Obtiene la ETA del pedido same-day a partir del campo `fechaCompromisoHora`
 * ya calculado en la creación. No realiza ningún cómputo adicional.
 *
 * Solo aplica para tipo_pedido='same_day'. Para Flex, la ETA la provee ML.
 *
 * @param pedido Objeto Pedido completo (con las columnas de SLA/corte).
 */
export function obtenerEtaSameDay(pedido: Pedido): EtaSameDay {
  return {
    pedidoId: pedido.id,
    fechaCompromisoHora: pedido.fechaCompromisoHora ?? null,
    corteRiesgo: pedido.corteRiesgo ?? false,
  };
}

/**
 * Formatea la ETA como una cadena legible para el usuario.
 * Devuelve null si no hay fecha de compromiso.
 *
 * Formato: 'HH:MM' local Santiago (para mostrar en la PWA del conductor
 * y en el portal del seller).
 */
export function formatearEtaSameDay(eta: EtaSameDay): string | null {
  if (!eta.fechaCompromisoHora) return null;

  const fecha = new Date(eta.fechaCompromisoHora);
  return fecha.toLocaleTimeString("es-CL", {
    timeZone: "America/Santiago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
