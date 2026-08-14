/**
 * "Carga por comuna" — Server Component, con SU PROPIO estado de error y de
 * vacío (§5.3, §13). Independiente del bloque de visitas: si esta consulta
 * falla, las visitas se siguen viendo, y viceversa.
 *
 * NO reordena `filas`: `obtenerCargaPorComuna`
 * (`src/modules/operacion/retiro/preparacion.ts`) ya entrega el arreglo
 * ordenado —mayor carga primero, "Sin comuna conocida" siempre al final y
 * solo si tiene bultos— como parte documentada de su contrato. Reordenarlo
 * otra vez acá duplicaría esa regla en dos capas que podrían desincronizarse.
 * Tampoco es un `reduce` sobre una consulta paginada (§16): el arreglo ya
 * llegó agregado y completo desde la base.
 *
 * Cada fila con comuna conocida enlaza a `/preparacion/asignar?comuna=X`
 * (etapa-6-asignacion-en-bloque.md §2.2 — "se cierra un pendiente" de la
 * etapa 5, que dejó esto sin destino porque esa ruta todavía no existía).
 * "Sin comuna conocida" NO enlaza: no es un valor de filtro válido en la
 * bandeja de asignación.
 */

import Link from "next/link";
import type { CargaComunaRetiro } from "@/modules/operacion/retiro/preparacion";
import { pluralizar } from "../_lib/estado-preparacion";

export function CargaPorComuna({
  errorCarga,
  filas,
}: {
  errorCarga: boolean;
  filas: readonly CargaComunaRetiro[];
}) {
  return (
    <section aria-labelledby="carga-comuna-heading" className="space-y-3">
      <div>
        <h2 id="carga-comuna-heading" className="text-sm font-semibold text-muted-foreground">
          Carga por comuna
        </h2>
        <p className="text-xs text-muted-foreground">Bultos ya retirados, agrupados por comuna de destino.</p>
      </div>

      {errorCarga ? (
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No pudimos cargar la carga por comuna. Intenta recargar la página.
        </div>
      ) : filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay bultos retirados.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {filas.map((fila) => {
            const porAsignar = fila.bultosTotal - fila.bultosAsignados;
            const contenido = (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{fila.comuna ?? "Sin comuna conocida"}</span>
                  <span className="text-sm tabular-nums whitespace-nowrap">
                    {fila.bultosTotal} {pluralizar(fila.bultosTotal, "bulto", "bultos")}
                  </span>
                </div>
                {fila.comuna !== null ? (
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {fila.bultosAsignados} {pluralizar(fila.bultosAsignados, "asignado", "asignados")} ·{" "}
                    {porAsignar} por asignar
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    No se identificaron contra ningún pedido.
                  </p>
                )}
              </>
            );

            return (
              <li key={fila.comuna ?? "__sin_comuna__"}>
                {fila.comuna !== null ? (
                  <Link
                    href={`/preparacion/asignar?comuna=${encodeURIComponent(fila.comuna)}`}
                    className="block px-3 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    {contenido}
                  </Link>
                ) : (
                  <div className="px-3 py-2.5">{contenido}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
