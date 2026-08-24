/**
 * El envoltorio vivo de Pedidos.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * ⚠️ POR QUÉ ESTO ES UN LAYOUT Y NO PARTE DE LA PÁGINA
 * -----------------------------------------------------------------------------
 * Estaba dentro de `page.tsx`, y ahí **no puede funcionar**: el segmento tiene
 * `loading.tsx`, así que cada `router.refresh()` suspende la página y **desmonta
 * todo su árbol**. Se llevaba por delante dos cosas, ninguna evidente:
 *
 * 1. **La marca de «esta fila acaba de cambiar» duraba un fotograma.** Debía
 *    durar 8 s; medida en el navegador, aparecía a los 1,2 s y a los 1,5 s ya no
 *    estaba. No era el reloj: era que el `setTimeout` moría con el desmontaje.
 *
 * 2. **El canal de Realtime se caía y se resuscribía en cada cambio.** Peor que
 *    lo anterior y completamente mudo: entre el cierre y el nuevo `join` hay una
 *    ida y vuelta al servidor, y **lo que ocurra en esa ventana no llega nunca**.
 *    En la hora punta, con un cambio de estado tras otro, la pantalla que promete
 *    estar «En vivo» se pasa el rato reconectándose.
 *
 * Un `layout` sí sobrevive: `loading.tsx` envuelve la **página**, no el layout.
 * La conexión viva queda por encima de los datos que ella misma refresca, que es
 * donde tenía que estar desde el principio.
 *
 * -----------------------------------------------------------------------------
 * QUÉ SIGUE VINIENDO DE LA PÁGINA
 * -----------------------------------------------------------------------------
 * **Qué filas hay en pantalla.** Eso sí depende del filtro y de la página, así
 * que lo reporta `page.tsx` con `<ReportarIdsVisibles>`. Mientras la página está
 * suspendida se conserva la última lista reportada, que es lo correcto: son las
 * filas que el coordinador tiene delante.
 */

import type { ReactNode } from "react";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { ProveedorCambiosEnVivo } from "./cambios-en-vivo";
import { ProveedorVistaPrevia } from "./vista-previa";

export default async function LayoutOperaciones({ children }: { children: ReactNode }) {
  const sesion = await obtenerSesionActual();
  // Sin sesión no hay a quién escuchar; el guard de verdad lo hace la página.
  const tenantId = sesion?.usuario?.tenantId ?? null;

  return (
    <ProveedorCambiosEnVivo tenantId={tenantId}>
      {/* ⚠️ La vista previa vive acá **por el mismo motivo** que los cambios en
          vivo: con `loading.tsx` en el segmento, cada `router.refresh()`
          desmonta la página. Dentro de ella, el panel se cerraría solo cada vez
          que un pedido cambia de estado — o sea, justo mientras el coordinador
          lo está mirando. */}
      <ProveedorVistaPrevia>{children}</ProveedorVistaPrevia>
    </ProveedorCambiosEnVivo>
  );
}
