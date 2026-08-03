/**
 * Copys de la banda de estado de la Torre.
 * =====================================================================
 *
 * Vive aparte del armado —y no dentro de `composer/`— porque lo consume un
 * componente de CLIENTE. Un archivo de copy no debería arrastrar al bundle del
 * navegador el grafo entero del composer solo para traer tres frases.
 *
 * -----------------------------------------------------------------------------
 * DOS ESTADOS SE RETIRARON CON LA v2
 * -----------------------------------------------------------------------------
 * · **`degradado`** existía para cuando una fuente externa no respondía. Ya no
 *   hay fuentes externas: clima, aire, tránsito, eventos y prensa salieron del
 *   producto. Su reemplazo es F6, el indicador de frescura, que mide el dato
 *   propio de Rutax y **está callado mientras todo va bien** — así que no
 *   necesita un copy de banda.
 * · **`sin_zonas`** invitaba a agrupar comunas en zonas. Con la comuna como
 *   unidad primaria del mapa, un courier sin zonas configuradas ve exactamente lo
 *   mismo que uno que sí las tiene: las comunas de la RM existen igual.
 *
 * `con_incidencias` tampoco lleva copy: cuando hay una incidencia abierta, lo que
 * habla es la incidencia misma en el panel, con su código y su conductor. Una
 * banda diciendo «hay incidencias» encima de la lista de incidencias sería la
 * pantalla explicándose a sí misma.
 */

import type { MensajeEstado } from './contrato-torre';

export const MENSAJES_ESTADO_TORRE: MensajeEstado[] = [
  {
    estado: 'tranquilo',
    titulo: 'Todo tranquilo',
    cuerpo:
      'No hay incidencias abiertas y las entregas van saliendo. El contador de arriba baja solo a medida que los conductores cierran sus paradas.',
    accion: null,
  },
  {
    estado: 'sin_pedidos',
    titulo: 'Sin pedidos para hoy',
    cuerpo:
      'No hay pedidos con compromiso de entrega para hoy. Si esperabas carga, revisa la ingesta en Operaciones.',
    accion: { etiqueta: 'Ir a Operaciones', destino: '/operaciones' },
  },
];
