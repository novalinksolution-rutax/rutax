/**
 * El envoltorio de Períodos de cobro.
 *
 * ⚠️ **La vista previa vive acá y no en `page.tsx`**: el segmento tiene
 * `loading.tsx`, así que cada `router.refresh()` suspende la página y desmonta
 * todo su árbol. Con el estado del panel ahí adentro, se cerraría solo cada vez
 * que algo cambia — o sea, justo mientras alguien lo está mirando. Un `layout`
 * sí sobrevive: `loading.tsx` envuelve la **página**, no el layout.
 *
 * ⚠️ Y por eso el proveedor concreto es un componente de CLIENTE propio, con su
 * lector y sus render adentro. Pasarle la función `cargar` desde acá —que es
 * servidor— tumba todo lo que este layout envuelve, y ni el typecheck ni las
 * pruebas lo notan: solo aparece al abrir la pantalla.
 */

import type { ReactNode } from "react";

import { ProveedorVistaPreviaPeriodo } from "./vista-previa";

export default function LayoutPeriodos({ children }: { children: ReactNode }) {
  return <ProveedorVistaPreviaPeriodo>{children}</ProveedorVistaPreviaPeriodo>;
}
