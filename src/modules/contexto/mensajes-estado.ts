/**
 * Copys de la banda de estado de la Torre.
 * =====================================================================
 *
 * Vive aparte del armado —y no dentro de `composer/armado-riel.ts`— porque lo
 * consume un componente de CLIENTE. Un archivo de copy no debería arrastrar al
 * bundle del navegador el grafo entero del composer solo para traer cuatro
 * frases.
 *
 * Copys del handoff §8, con dos apartados deliberados:
 *
 * - **`degradado` ya no nombra a tránsito.** El copy original («La capa de
 *   tránsito muestra información de hace 38 minutos») describía el escenario del
 *   dummy congelado. Con fuentes reales la que se cae puede ser cualquiera, y
 *   afirmar en pantalla que es tránsito cuando la caída es la del aire sería una
 *   cifra falsa en un tablero de decisión. Cuál está caída se lee en la barra
 *   superior, marca por marca, que es donde vive esa información.
 *
 * - **`sin_pedidos` ya no promete la ola comercial.** El calendario de olas
 *   (bloque C) todavía no existe; anunciar «la próxima ola es el Día del Niño»
 *   sería ofrecer una pantalla que no está.
 */

import type { MensajeEstado } from './contrato-torre';

export const MENSAJES_ESTADO_TORRE: MensajeEstado[] = [
  {
    estado: 'tranquilo',
    titulo: 'Todo tranquilo',
    cuerpo:
      'Ninguna zona supera el umbral de riesgo y no hay eventos relevantes en las próximas 24 horas.',
    accion: { etiqueta: 'Ver el detalle igual', destino: '#detalle' },
  },
  {
    estado: 'degradado',
    titulo: 'Falta el dato de alguna fuente',
    cuerpo:
      'Una o más fuentes externas no están respondiendo. El resto del tablero está al día; arriba, cada fuente muestra su edad y su estado.',
    accion: null,
  },
  {
    estado: 'sin_zonas',
    titulo: 'Todavía no defines tus zonas',
    cuerpo:
      'Estás viendo las cinco macro-zonas de la Región Metropolitana. Agrupa tus comunas para que el tablero refleje cómo operas.',
    accion: { etiqueta: 'Configurar zonas', destino: '/configuracion/zonas' },
  },
  {
    estado: 'sin_pedidos',
    titulo: 'Sin pedidos para esta fecha',
    cuerpo:
      'No hay pedidos con compromiso de entrega en este horizonte. El tablero sigue mostrando el contexto de la ciudad.',
    accion: null,
  },
];
