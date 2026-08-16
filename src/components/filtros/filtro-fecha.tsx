"use client";

/**
 * FiltroFecha — control de filtro por fecha, reutilizable en todas las barras de
 * filtros de la app (pedidos, manifiestos, incidencias, portal…).
 *
 * Un botón compacto que muestra la selección actual y abre un popover con:
 *   - Atajos rápidos: Hoy · Ayer · Últimos 7 días · Últimos 30 días · Este mes ·
 *     Mes pasado.
 *   - Un calendario de RANGO: primer clic fija el inicio, segundo clic la otra
 *     fecha del rango y aplica. Dos clics en el mismo día = un solo día.
 *
 * Contrato de URL (retrocompatible): el día exacto viaja en `paramExacto`
 * (por defecto `fecha`, el nombre histórico — los deep-links de la Torre siguen
 * funcionando); el rango viaja en `paramDesde`/`paramHasta`. Los tres son
 * excluyentes: elegir uno limpia los otros.
 *
 * Navega clonando los searchParams actuales (preserva los filtros hermanos) y
 * reseteando la paginación. La sanitización de cada valor vive en el servidor.
 * Toda la aritmética de fecha es CIVIL (strings 'YYYY-MM-DD') vía los helpers de
 * `rango-fecha.ts` / `fecha-santiago.ts` — nada de `new Date()` sobre strings.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  calcularAtajosFecha,
  etiquetaSeleccionFecha,
  etiquetaMes,
  grillaMes,
  mesAnterior,
  mesDe,
  mesSiguiente,
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

const DOW = ["L", "M", "M", "J", "V", "S", "D"];

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
  const [mesVisible, setMesVisible] = useState(() => mesDe(hasta || exacto || desde || hoy));
  // Primer clic del rango, a la espera del segundo (null = nada en curso).
  const [inicioProv, setInicioProv] = useState<string | null>(null);
  // Día bajo el cursor, para previsualizar el rango mientras se elige el segundo.
  const [hover, setHover] = useState<string | null>(null);

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
      setInicioProv(null);
      setHover(null);
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

  /** Clic en un día del calendario: primero fija el inicio; el segundo aplica. */
  function clicDia(d: string) {
    if (inicioProv === null) {
      setInicioProv(d);
      setHover(d);
      return;
    }
    const [a, b] = inicioProv <= d ? [inicioProv, d] : [d, inicioProv];
    if (a === b) navegar({ exacto: a });
    else navegar({ desde: a, hasta: b });
  }

  /** Estado visual de un día: extremo seleccionado o interior del rango. */
  function estadoDia(d: string): { extremo: boolean; interior: boolean } {
    if (inicioProv !== null) {
      const otro = hover ?? inicioProv;
      const a = inicioProv <= otro ? inicioProv : otro;
      const b = inicioProv <= otro ? otro : inicioProv;
      return { extremo: d === a || d === b, interior: d > a && d < b };
    }
    if (exacto) return { extremo: d === exacto, interior: false };
    if (desde && hasta) return { extremo: d === desde || d === hasta, interior: d > desde && d < hasta };
    if (desde) return { extremo: d === desde, interior: false };
    if (hasta) return { extremo: d === hasta, interior: false };
    return { extremo: false, interior: false };
  }

  const atajos = calcularAtajosFecha(hoy);
  const etiqueta = etiquetaSeleccionFecha({ exacto, desde, hasta, hoy });
  const hayFecha = !!(exacto || desde || hasta);
  const { dias, desplazamiento } = grillaMes(mesVisible);

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
          if (o) {
            setMesVisible(mesDe(hasta || exacto || desde || hoy));
            setInicioProv(null);
            setHover(null);
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
        <PopoverContent align="start" className="w-auto p-3">
          {/* Atajos rápidos */}
          <div className="flex max-w-[15rem] flex-wrap gap-1.5">
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

          {/* Calendario de rango */}
          <div className="mt-3 border-t border-border pt-3">
            {/* Cabecera del mes */}
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMesVisible(mesAnterior(mesVisible))}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
              <span className="text-sm font-medium capitalize">{etiquetaMes(mesVisible)}</span>
              <button
                type="button"
                onClick={() => setMesVisible(mesSiguiente(mesVisible))}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>

            {/* Encabezados de día */}
            <div className="grid grid-cols-7 gap-0.5">
              {DOW.map((d, i) => (
                <span key={i} className="py-1 text-center text-[11px] font-medium text-muted-foreground">
                  {d}
                </span>
              ))}
            </div>

            {/* Días */}
            <div
              className="grid grid-cols-7 gap-0.5"
              onMouseLeave={() => inicioProv !== null && setHover(inicioProv)}
            >
              {Array.from({ length: desplazamiento }).map((_, i) => (
                <span key={`v-${i}`} aria-hidden="true" />
              ))}
              {dias.map((d) => {
                const { extremo, interior } = estadoDia(d);
                const esHoy = d === hoy;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => clicDia(d)}
                    onMouseEnter={() => inicioProv !== null && setHover(d)}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                      extremo
                        ? "bg-primary font-semibold text-primary-foreground"
                        : interior
                          ? "bg-primary/15 text-foreground"
                          : "text-foreground hover:bg-accent",
                      !extremo && esHoy && "font-semibold text-primary ring-1 ring-inset ring-primary/40",
                    )}
                  >
                    {Number(d.slice(8, 10))}
                  </button>
                );
              })}
            </div>

            {inicioProv !== null ? (
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Elige la otra fecha del rango
              </p>
            ) : null}
          </div>

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
