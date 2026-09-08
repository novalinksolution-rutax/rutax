"use client";

/**
 * Proveedor del panel lateral de manifiestos.
 * =============================================================================
 * Tocar una fila del listado abre este panel con TODO el detalle del manifiesto
 * —la ruta, las acciones y la bitácora— sin salir de la lista. En teléfono es
 * una hoja inferior; desde `lg`, el panel lateral. Usa el chasis compartido
 * `ProveedorVistaPreviaLateral` (movimiento, cierre, tres estados) y le pone su
 * contenido.
 *
 * ⚠️ Vive en el `layout.tsx` del segmento, no en la página: así sobrevive a los
 * `router.refresh()` que disparan las acciones (confirmar, cancelar, redistribuir).
 */

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ProveedorVistaPreviaLateral,
  useVistaPreviaLateral,
} from "@/components/ui/vista-previa-lateral";
import { BadgeEstado } from "@/components/ui/badge-estado";
import {
  traducirEstadoManifiesto,
  BADGE_ESTADO_MANIFIESTO,
} from "@/lib/ui/traduccion-estados";
import { accionVistaPreviaManifiesto } from "./vista-previa-actions";
import { ContenidoManifiesto } from "./[manifiestoId]/contenido-manifiesto";
import type { DatosDetalleManifiesto } from "./[manifiestoId]/datos-detalle";
import type { ReactNode } from "react";

/**
 * Abre el panel para el manifiesto que venga en `?abrir=` (deep-link redirigido
 * desde la vieja ruta de detalle) y limpia el parámetro para que «atrás» no lo
 * reabra. Vive dentro del proveedor para tener su contexto.
 */
function AutoAbrirDesdeUrl() {
  const ctx = useVistaPreviaLateral();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const abrir = params.get("abrir");

  useEffect(() => {
    if (!abrir || !ctx) return;
    ctx.abrir(abrir);
    const next = new URLSearchParams(params.toString());
    next.delete("abrir");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    // Solo cuando cambia `abrir`: no reabrir en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrir]);

  return null;
}

export function ProveedorVistaPreviaManifiestos({ children }: { children: ReactNode }) {
  return (
    <ProveedorVistaPreviaLateral<DatosDetalleManifiesto>
      etiqueta="Vista previa del manifiesto"
      cargar={async (id) => {
        const r = await accionVistaPreviaManifiesto(id);
        return r.ok ? { ok: true, datos: r.datos } : { ok: false };
      }}
      tituloFalla="No pudimos abrir el manifiesto"
      textoFalla="No es que no exista: no lo pudimos leer. Ciérralo y vuelve a tocarlo, o recarga la página."
      render={{
        encabezado: (d) => (
          <div className="min-w-0">
            <p className="truncate font-heading text-base font-semibold">{d.nombreConductor}</p>
            <p className="rx-num mt-0.5 text-xs text-fg-muted">
              {d.etiquetaDelDia} · {d.nombre}
              {d.origen?.nombre ? ` · sale desde ${d.origen.nombre}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <BadgeEstado
                variante={BADGE_ESTADO_MANIFIESTO[d.estado]}
                eje="manifiesto"
                valor={d.estado}
                texto={traducirEstadoManifiesto(d.estado)}
              />
              {d.totalPedidos > 0 ? (
                <span className="rx-num border border-line px-1.5 py-0.5 text-[11px] text-fg-muted">
                  {d.totalPedidos} paradas · {d.paradasCerradas} cerradas
                </span>
              ) : null}
            </div>
          </div>
        ),
        cuerpo: (d) => <ContenidoManifiesto datos={d} enPanel />,
      }}
    >
      <AutoAbrirDesdeUrl />
      {children}
    </ProveedorVistaPreviaLateral>
  );
}
