/**
 * El envoltorio de Sellers.
 *
 * El proveedor de la vista previa vive acá y no en `page.tsx` por la misma razón
 * que en Pedidos, Períodos y Liquidaciones: el estado del panel tiene que
 * sobrevivir a un `router.refresh()`. Este segmento todavía no tiene
 * `loading.tsx`, pero el día que lo tenga —o el día que alguien agregue un
 * refresco en vivo— el panel se cerraría solo, y ese fallo no deja rastro: se
 * ve como «el panel se cierra a veces».
 *
 * ⚠️ El proveedor concreto es un componente de CLIENTE propio, con su lector
 * adentro. Pasarle la función `cargar` desde acá —que es servidor— tumba todo lo
 * que este layout envuelve, y ni el typecheck ni las pruebas lo notan.
 */

import type { ReactNode } from "react";

import { ProveedorVistaPreviaSeller } from "./vista-previa";

export default function LayoutSellers({ children }: { children: ReactNode }) {
  return <ProveedorVistaPreviaSeller>{children}</ProveedorVistaPreviaSeller>;
}
