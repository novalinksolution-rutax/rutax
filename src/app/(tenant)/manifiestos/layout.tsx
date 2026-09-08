/**
 * Layout del segmento de manifiestos.
 * =============================================================================
 * Monta el proveedor del panel lateral AQUÍ y no en la página: el proveedor
 * guarda qué manifiesto está abierto, y las acciones del panel disparan
 * `router.refresh()`. Si viviera en la página, ese refresh la desmontaría y
 * cerraría el panel justo mientras se usa. En el layout, sobrevive.
 */

import type { ReactNode } from "react";
import { ProveedorVistaPreviaManifiestos } from "./vista-previa";

export default function LayoutManifiestos({ children }: { children: ReactNode }) {
  return <ProveedorVistaPreviaManifiestos>{children}</ProveedorVistaPreviaManifiestos>;
}
