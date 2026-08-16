"use client";

/**
 * FiltroFecha — control de filtro por fecha, reutilizable en todas las barras de
 * filtros de la app (pedidos, manifiestos, incidencias, portal…).
 *
 * Reemplaza el `<input type="date">` suelto que solo permitía un día. Ofrece,
 * dentro de un popover minimalista (un botón que muestra la selección actual):
 *   - Atajos rápidos: Hoy · Ayer · Últimos 7 días · Últimos 30 días · Este mes ·
 *     Mes pasado.
 *   - Día exacto: un solo día.
 *   - Rango: entre dos fechas (desde–hasta).
 *
 * Contrato de URL (retrocompatible): el día exacto viaja en `paramExacto`
 * (por defecto `fecha`, el nombre histórico — los deep-links de la Torre siguen
 * funcionando); el rango viaja en `paramDesde`/`paramHasta`. Los tres son
 * excluyentes: elegir uno limpia los otros.
 *
 * Navega clonando los searchParams actuales (preserva los filtros hermanos) y
 * reseteando la paginación. La sanitización de cada valor vive en el servidor.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  calcularAtajosFecha,
  etiquetaSeleccionFecha,
  type AtajoFecha,
} from "@/lib/ui/rango-fecha";

interface Props {
  /** "Hoy" civil de Santiago (lo calcula el servidor para que SSR y cliente coincidan). */
  hoy: string;
  /** Valor actual del día exacto ("" si no hay). */
  exacto: string;
  /** Valores actuales del rango ("" si no hay). */
  desde: string;
  hasta: string;
  /** Etiqueta del campo (p. ej. "Fecha comprometida"). */
  label?: string;
  /** Nombres de los searchParams. Por defecto `fecha` / `fecha_desde` / `fecha_hasta`. */
  paramExacto?: string;
  paramDesde?: string;
  paramHasta?: string;
  /** Nombre del param de paginación a resetear al cambiar el filtro. */
  paramPagina?: string;
  id?: string;
}

export function FiltroFecha({
  hoy,
  exacto,
  desde,
  hasta,
  label = "Fecha",
  paramExacto = "fecha",
  paramDesde = "fecha_desde",
  paramHasta = "fecha_hasta",
  paramPagina = "pagina",
  id,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [abierto, setAbierto] = useState(false);
  // Modo del panel: rango si ya hay un rango puesto, si no día exacto.
  const [modo, setModo] = useState<"dia" | "rango">(desde || hasta ? "rango" : "dia");
  // Borradores del rango (para poder poner los dos extremos antes de navegar).
  const [rangoDesde, setRangoDesde] = useState(desde);
  const [rangoHasta, setRangoHasta] = useState(hasta);

  /** Escribe los tres params de fecha (limpiando los que no apliquen) y navega. */
  const navegar = useCallback(
    (valores: { exacto?: string; desde?: string; hasta?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete(paramExacto);
      params.delete(paramDesde);
      params.delete(paramHasta);
      // Cualquier cambio de filtro vuelve a la primera página.
      params.delete(paramPagina);
      if (valores.exacto) params.set(paramExacto, valores.exacto);
      if (valores.desde) params.set(paramDesde, valores.desde);
      if (valores.hasta) params.set(paramHasta, valores.hasta);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
      setAbierto(false);
    },
    [router, pathname, searchParams, paramExacto, paramDesde, paramHasta, paramPagina],
  );

  const aplicarAtajo = useCallback(
    (a: AtajoFecha) => {
      if (a.exacto) navegar({ exacto: a.exacto });
      else navegar({ desde: a.desde, hasta: a.hasta });
    },
    [navegar],
  );

  const atajos = calcularAtajosFecha(hoy);
  const etiqueta = etiquetaSeleccionFecha({ exacto, desde, hasta, hoy });
  const hayFecha = !!(exacto || desde || hasta);

  /** Marca el atajo activo comparándolo con la selección vigente. */
  function atajoActivo(a: AtajoFecha): boolean {
    if (a.exacto) return exacto === a.exacto;
    return desde === a.desde && hasta === a.hasta;
  }

  return (
    <div className="flex flex-col gap-1">
      <span id={id ? `${id}-label` : undefined} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <Popover
        open={abierto}
        onOpenChange={(o) => {
          setAbierto(o);
          // Al abrir, sincroniza los borradores del rango con lo vigente.
          if (o) {
            setModo(desde || hasta ? "rango" : "dia");
            setRangoDesde(desde);
            setRangoHasta(hasta);
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            aria-labelledby={id ? `${id}-label` : undefined}
            className={cn(
              "flex h-9 w-52 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors",
              "hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              hayFecha ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="flex-1 truncate text-left">{etiqueta}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          {/* Atajos rápidos */}
          <div className="flex flex-wrap gap-1.5">
            {atajos.map((a) => (
              <button
                key={a.clave}
                type="button"
                onClick={() => aplicarAtajo(a)}
                aria-pressed={atajoActivo(a)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  atajoActivo(a)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted/40 text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
              >
                {a.etiqueta}
              </button>
            ))}
          </div>

          {/* Conmutador Día / Rango */}
          <div className="mt-3 flex rounded-md bg-muted/60 p-0.5">
            {(["dia", "rango"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                aria-pressed={modo === m}
                className={cn(
                  "flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
                  modo === m
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "dia" ? "Día exacto" : "Rango"}
              </button>
            ))}
          </div>

          {modo === "dia" ? (
            <div className="mt-3 flex flex-col gap-1">
              <label htmlFor={`${id ?? "filtro-fecha"}-dia`} className="text-xs text-muted-foreground">
                Elige un día
              </label>
              <Input
                id={`${id ?? "filtro-fecha"}-dia`}
                type="date"
                value={exacto}
                onChange={(e) => e.target.value && navegar({ exacto: e.target.value })}
                className="h-9"
              />
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <label htmlFor={`${id ?? "filtro-fecha"}-desde`} className="text-xs text-muted-foreground">
                    Desde
                  </label>
                  <Input
                    id={`${id ?? "filtro-fecha"}-desde`}
                    type="date"
                    value={rangoDesde}
                    max={rangoHasta || undefined}
                    onChange={(e) => setRangoDesde(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <label htmlFor={`${id ?? "filtro-fecha"}-hasta`} className="text-xs text-muted-foreground">
                    Hasta
                  </label>
                  <Input
                    id={`${id ?? "filtro-fecha"}-hasta`}
                    type="date"
                    value={rangoHasta}
                    min={rangoDesde || undefined}
                    onChange={(e) => setRangoHasta(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={!rangoDesde || !rangoHasta}
                onClick={() => navegar({ desde: rangoDesde, hasta: rangoHasta })}
              >
                Aplicar rango
              </Button>
            </div>
          )}

          {hayFecha ? (
            <button
              type="button"
              onClick={() => navegar({})}
              className="mt-3 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Quitar filtro de fecha
            </button>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
