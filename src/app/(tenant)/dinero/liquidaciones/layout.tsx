/**
 * El envoltorio de Liquidaciones.
 *
 * ⚠️ **La vista previa vive acá y no en `page.tsx`**: el segmento tiene
 * `loading.tsx`, así que cada `router.refresh()` suspende la página y desmonta
 * todo su árbol — con el estado del panel ahí adentro, se cerraría solo cada vez
 * que algo cambia. Un `layout` sí sobrevive: `loading.tsx` envuelve la página,
 * no el layout.
 *
 * ⚠️ Y por eso el proveedor concreto es un componente de CLIENTE propio. Pasarle
 * la función `cargar` desde acá —que es servidor— tumba todo lo que este layout
 * envuelve, y ni el typecheck ni las pruebas lo notan.
 */

import type { ReactNode } from "react";

import { ProveedorVistaPreviaLiquidacion } from "./vista-previa";

export default function LayoutLiquidaciones({ children }: { children: ReactNode }) {
  return <ProveedorVistaPreviaLiquidacion>{children}</ProveedorVistaPreviaLiquidacion>;
}
