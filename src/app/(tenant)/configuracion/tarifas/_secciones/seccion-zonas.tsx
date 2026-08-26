import { ShieldAlert } from "lucide-react";

import { obtenerEstadoZonas } from "../../zonas/actions";
import { PanelZonas } from "../../zonas/panel-zonas";

/**
 * Zonas — la sección, antes `configuracion/zonas/page.tsx`.
 * =============================================================================
 *
 * Vive dentro del módulo de tarifas desde el 26-08-2026: la zona **no existe por
 * sí misma**. Es la clave por la que una tarifa cobra distinto según dónde se
 * entrega, y tenerla en otra pantalla obligaba a saber de memoria dónde estaba
 * la mitad que uno venía a cambiar.
 *
 * RBAC: lo impone el contenedor con `gestionar_tarifas` — que ya era la misma
 * capacidad que pedía la pantalla suelta, y es parte de por qué juntarlas no
 * abre ningún acceso nuevo.
 *
 * ⚠️ **Se acota a `max-w-3xl` aunque el contenedor sea ancho.** El módulo es
 * ancho por la tabla de tarifas; esto es un editor de agrupaciones, y estirar
 * una lista de comunas a 1580 px deja el ojo sin dónde apoyarse. El ancho lo
 * decide el contenido de cada sección, no el de la más ancha — que es
 * exactamente el error que tenía `PantallaConfiguracion` al revés.
 */
export async function SeccionZonas() {
  const resultado = await obtenerEstadoZonas();

  if (!resultado.ok) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 border border-dashed border-fault-line bg-bg-sunken px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-fault-fg" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-fg">No pudimos cargar tus zonas</p>
          <p className="text-sm text-fg-muted">{resultado.mensaje}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm leading-relaxed text-fg-muted">
        Cómo agrupas las comunas de la RM para cobrar distinto según dónde entregas. La hora de
        corte de cada seller se fija en su ficha.
      </p>
      <PanelZonas estadoInicial={resultado.datos} />
    </div>
  );
}
