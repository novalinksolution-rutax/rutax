/**
 * El pie de truncamiento: decir cuánto se está escondiendo.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTO ES DEL SISTEMA Y NO DE ESTA PANTALLA
 * -----------------------------------------------------------------------------
 * Seis listados del producto cortan hoy en silencio: muestran las primeras N
 * filas y **no dicen que hay más**. Quien mira una lista de 100 y no ve un aviso
 * asume que eso es todo — y actúa en consecuencia.
 *
 * La regla es que un corte se declara **y ofrece las dos salidas**:
 *
 * · **afinar el filtro** — lo que casi siempre corresponde;
 * · **exportar el listado completo** — para cuando de verdad se necesitan todas.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ SOBRE 1.000 EL MENSAJE CAMBIA Y LA TABLA EXIGE FILTRO
 * -----------------------------------------------------------------------------
 * No es un umbral estético. Por encima de mil filas, paginar deja de ser una
 * forma de encontrar algo: son diez páginas que nadie va a recorrer, y el
 * coordinador termina buscando a ojo lo que un filtro resuelve en un clic. Así
 * que el pie deja de ser informativo y **pide** el filtro.
 *
 * Mil es también el techo de PostgREST, así que por encima de esa cifra el total
 * ya viene de un `count` y no de contar filas leídas.
 */

import Link from "next/link";
import { Download, Filter } from "lucide-react";

import { Button } from "@/components/ui/button";

/** El techo a partir del cual paginar deja de servir para encontrar algo. */
export const UMBRAL_EXIGE_FILTRO = 1000;

export function PieDeTruncamiento({
  mostrados,
  total,
  hrefExportar,
  puedeExportar,
}: {
  /** Filas en pantalla ahora. */
  mostrados: number;
  /** Filas que hay con el filtro puesto. */
  total: number;
  hrefExportar: string;
  puedeExportar: boolean;
}) {
  if (total <= mostrados) return null;

  const exige = total > UMBRAL_EXIGE_FILTRO;
  const totalLegible = total.toLocaleString("es-CL");

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-fg-muted">
        {/* En el teléfono el mismo aviso no cabe entero, y recortarlo a «100 de
            284» sin más perdería la salida. Así que la frase se parte: la cifra
            siempre, la instrucción corta en móvil y la larga desde `sm`. */}
        <span className="rx-num font-medium tabular-nums text-fg">
          {mostrados.toLocaleString("es-CL")} de {totalLegible}
        </span>
        {exige ? (
          <>
            <span className="sm:hidden"> · Filtra para poder trabajar.</span>
            <span className="hidden sm:inline">
              {" "}
              — son demasiados para recorrerlos de a página. Afina el filtro por seller, comuna o
              conductor.
            </span>
          </>
        ) : (
          <>
            <span className="sm:hidden"> · Afina el filtro.</span>
            <span className="hidden sm:inline">
              {" "}
              — mostramos las primeras {mostrados.toLocaleString("es-CL")}. Afina el filtro
              {puedeExportar ? " o exporta el listado completo." : "."}
            </span>
          </>
        )}
      </p>

      <div className="flex shrink-0 items-center gap-2">
        {/* «Afinar el filtro» no navega a ninguna parte: los chips están arriba,
            en esta misma pantalla. El botón lleva el foco hasta ellos, que es lo
            único honesto que puede hacer. */}
        <Button asChild variant={exige ? "default" : "outline"} size="sm">
          <a href="#filtros-pedidos">
            <Filter className="size-3.5" aria-hidden="true" />
            Afinar el filtro
          </a>
        </Button>
        {puedeExportar && (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefExportar} prefetch={false}>
              <Download className="size-3.5" aria-hidden="true" />
              Exportar
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
