/**
 * Franja de 4 magnitudes de la cabecera (§13). Mismo lenguaje visual que
 * `torre-de-control/_componentes/cifras.tsx`: fila con divisores de 1 px, SIN
 * cards — se jerarquiza con espacio y peso, no con cajas.
 *
 * `magnitudes === null` es el caso en que la consulta de VISITAS falló: se
 * muestran guiones en vez de ceros (mismo criterio que
 * `operaciones/page.tsx`, `{errorCarga ? "—" : contador}`) para no afirmar
 * "cero" cuando en realidad no se pudo saber.
 */

import { cn } from "@/lib/utils";
import type { MagnitudesPreparacion } from "../_lib/estado-preparacion";

function Magnitud({
  etiqueta,
  children,
  destacada = false,
}: {
  etiqueta: string;
  children: React.ReactNode;
  destacada?: boolean;
}) {
  return (
    <div className="flex-1 px-4 py-3 first:pl-0 last:pr-0 sm:px-5">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      {/* `tabular-nums`: sin ancho fijo por dígito, el número "salta" a cada
          actualización de realtime. */}
      <p
        className={cn(
          "mt-0.5 tabular-nums",
          destacada ? "text-2xl font-semibold" : "text-xl font-medium",
        )}
      >
        {children}
      </p>
    </div>
  );
}

export function FranjaMagnitudes({ magnitudes }: { magnitudes: MagnitudesPreparacion | null }) {
  return (
    <div>
      <div className="flex flex-wrap items-start divide-x divide-border border-y border-border">
        <Magnitud etiqueta="Bultos retirados hoy" destacada>
          {magnitudes ? magnitudes.bultosRetiradosHoy : "—"}
        </Magnitud>
        <Magnitud etiqueta="En bodega ahora">{magnitudes ? magnitudes.enBodegaAhora : "—"}</Magnitud>
        <Magnitud etiqueta="De vuelta">{magnitudes ? magnitudes.deVuelta : "—"}</Magnitud>
        <Magnitud etiqueta="Sin novedades">
          {/* Ámbar solo si > 0 — mismo tratamiento que "Cerca del corte" en
              torre-de-control/_componentes/cifras.tsx. */}
          <span className={magnitudes && magnitudes.sinNovedades > 0 ? "text-warning-subtle-foreground" : undefined}>
            {magnitudes ? magnitudes.sinNovedades : "—"}
          </span>
        </Magnitud>
      </div>

      {magnitudes && magnitudes.bultosSinIdentificar > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {magnitudes.bultosSinIdentificar === 1
            ? "1 bulto no se pudo identificar todavía."
            : `${magnitudes.bultosSinIdentificar} bultos no se pudieron identificar todavía.`}
        </p>
      ) : null}
    </div>
  );
}
