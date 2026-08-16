/**
 * Reglas derivadas de la PROCEDENCIA de un pedido (`operacion.pedidos.fuente`).
 *
 * Por qué existe este archivo. Hasta que hubo una sola fuente externa, todo el
 * sistema preguntaba `tipo_pedido !== 'same_day'` para decidir quién es dueño de
 * la prueba de entrega. Esa pregunta nunca fue sobre el tipo de servicio: era
 * sobre si la fuente impone una app de escaneo propia. Mientras las fuentes
 * fueron dos, ambas preguntas daban la misma respuesta; con una tercera fuente
 * dejan de darla, y la forma vieja **rechaza** los pedidos nuevos en vez de
 * tratarlos bien.
 *
 * La restricción de fondo está en CLAUDE.md: para Flex, la app de escaneo/POD de
 * Mercado Envíos es obligatoria y NO es integrable — Rutax orquesta alrededor de
 * ella y su evidencia es informativa. Para toda otra fuente no hay app externa
 * obligatoria, así que el POD capturado en Rutax es el autoritativo y es el que
 * dispara la línea entrega→dinero.
 *
 * Mitad en base de la misma regla: el trigger `trg_pruebas_entrega_solo_same_day`
 * (migración 20260816000002), que rechaza un POD contra un pedido `ml_flex`. Si
 * cambias una mitad, cambia la otra.
 */

import { FUENTES_PEDIDO, type FuentePedido } from "./tipos";

/**
 * Fuentes cuya prueba de entrega la gobierna un tercero, no Rutax.
 *
 * Hoy solo Flex. Una fuente entra a esta lista únicamente si el marketplace
 * impone una app de captura que no se puede integrar; que el marketplace tenga
 * su propio tracking no basta.
 */
const FUENTES_CON_POD_EXTERNO: readonly FuentePedido[] = ["ml_flex"];

/**
 * ¿El POD que capture el conductor en la app de Rutax es la verdad de esta
 * entrega — la que mueve el estado del pedido y dispara el motor de dinero?
 *
 * Falla CERRADO ante una fuente desconocida: devuelve `false`. Una fuente que no
 * reconocemos es, casi por definición, una que todavía no sabemos si tiene POD
 * propio; aceptar la evidencia sería escribir un estado terminal y generar plata
 * sobre una suposición. El conductor ve un error claro y el trigger de base es la
 * segunda barrera.
 */
export function podEsAutoritativoEnRutax(fuente: string | null | undefined): boolean {
  if (!esFuenteConocida(fuente)) return false;
  return !FUENTES_CON_POD_EXTERNO.includes(fuente);
}

/**
 * Inversa de la anterior, para los sitios donde la rama natural es "esta fuente
 * la cierra un tercero" (el cierre operativo paralelo, los banners de solo
 * lectura en la app del conductor).
 */
export function podLoGobiernaLaFuente(fuente: string | null | undefined): boolean {
  return !podEsAutoritativoEnRutax(fuente);
}

export function esFuenteConocida(valor: string | null | undefined): valor is FuentePedido {
  return valor != null && (FUENTES_PEDIDO as readonly string[]).includes(valor);
}

/**
 * Fuentes que emiten su propia etiqueta imprimible (con su propio código de
 * envío / QR), a diferencia de las que dependen de que Rutax genere la
 * etiqueta interna con QR propio.
 *
 * Hoy coincide con `FUENTES_CON_POD_EXTERNO`, pero es una lista PROPIA y a
 * propósito: son dos preguntas distintas — "¿quién es dueño de la prueba de
 * entrega?" vs. "¿quién imprime la etiqueta?". Una fuente futura podría traer
 * su propia etiqueta sin imponer POD externo (o al revés), y mezclar ambas
 * listas dejaría el código correcto por casualidad, no por diseño.
 */
const FUENTES_QUE_PROVEEN_ETIQUETA: readonly FuentePedido[] = ["ml_flex"];

/**
 * ¿Esta fuente trae su propia etiqueta imprimible (Rutax solo la descarga),
 * o Rutax debe generar la etiqueta interna con QR propio?
 *
 * Falla CERRADO ante una fuente desconocida: devuelve `false` — Rutax genera
 * su propia etiqueta antes que asumir que una fuente no reconocida la provee.
 */
export function laFuenteProveeEtiqueta(fuente: string | null | undefined): boolean {
  if (!esFuenteConocida(fuente)) return false;
  return FUENTES_QUE_PROVEEN_ETIQUETA.includes(fuente);
}
