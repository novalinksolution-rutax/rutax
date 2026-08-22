/**
 * La derivación de los destinos del teléfono. Módulo aparte y **sin
 * `"use client"`** a propósito.
 *
 * ⚠️ Vivía dentro de `nav-inferior.tsx`, que sí lleva la directiva, y eso
 * rompía el producto entero: `"use client"` convierte **todos** los exports del
 * módulo en referencias de cliente, así que un `layout.tsx` de servidor que
 * llamara a `destinosMovil()` reventaba con «attempted to call … from the
 * server». **Typecheck y lint lo aprueban**; solo aparece al abrir la pantalla,
 * y como el layout envuelve todo, se cae el backoffice completo.
 *
 * Regla: una función que un Server Component tenga que LLAMAR no puede vivir en
 * un módulo de cliente, aunque sea pura.
 */

import type { ItemNav } from "./iconos-nav"

/**
 * Orden de preferencia para el teléfono. No es el orden del sidebar: es el
 * orden de **lo que se abre de pie**.
 *
 * Los cuatro primeros son los del tablero P1 para quien coordina. El dashboard
 * va después de ellos a propósito, aunque para el dueño sea su pantalla de
 * inicio en escritorio: es una pantalla de sentarse a mirar, y en el teléfono
 * pierde contra las cuatro que se abren en la bodega. Sigue a un toque, en el
 * panel.
 *
 * Para Administración —que no tiene ninguna capacidad de operación— los cuatro
 * caen solos en los de dinero, que es exactamente lo que se busca.
 */
const PRIORIDAD = [
  "/operaciones", // Pedidos — el listado del día
  "/preparacion", // La carrera contra el despacho de las 16:00
  "/torre-de-control", // El vistazo de dos minutos, varias veces al día
  "/operaciones/incidencias", // Lo único accionable en rojo
  "/dashboard",
  "/manifiestos",
  "/dinero/periodos",
  "/dinero/liquidaciones",
  "/dinero/conciliacion",
  "/dinero/cobranza",
  "/sellers",
  // Portal del seller
  "/portal",
  "/portal/pedidos",
  "/portal/cobros",
  "/portal/incidencias",
]

export const MAX_DESTINOS_MOVIL = 4

/**
 * Elige los destinos de la barra a partir de los que la persona ya tiene en su
 * navegación. Se llama en el servidor, junto al armado del sidebar.
 */
export function destinosMovil(disponibles: ItemNav[]): ItemNav[] {
  const porHref = new Map(disponibles.map((i) => [i.href, i]))
  const elegidos: ItemNav[] = []
  for (const href of PRIORIDAD) {
    const item = porHref.get(href)
    if (item) elegidos.push(item)
    if (elegidos.length === MAX_DESTINOS_MOVIL) break
  }
  // Si la persona tiene menos de cuatro destinos conocidos, se completa con lo
  // que tenga: una barra de dos es mejor que ninguna.
  if (elegidos.length < MAX_DESTINOS_MOVIL) {
    for (const item of disponibles) {
      if (elegidos.length === MAX_DESTINOS_MOVIL) break
      if (!elegidos.some((e) => e.href === item.href)) elegidos.push(item)
    }
  }
  return elegidos
}
