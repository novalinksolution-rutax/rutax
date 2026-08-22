import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Retorno y Migas — la salida de una pantalla de detalle.
 *
 * POR QUÉ ES UN COMPONENTE Y NO UN `<Link>` EN CADA PÁGINA
 * ---------------------------------------------------------------------------
 * Hoy hay tres tratamientos distintos conviviendo: migas de verdad en dos
 * pantallas de dinero, «‹ Volver» suelto en diez, y «Volver a X» como escape de
 * un estado vacío en otras siete. Una de ellas —el detalle de liquidación—
 * tiene **las migas y además el «‹ Volver» justo debajo**, apuntando al mismo
 * sitio. Un solo componente cierra eso.
 *
 * LA REGLA QUE TRAE EL TABLERO P1: VOLVER NUNCA PIERDE EL FILTRO
 * ---------------------------------------------------------------------------
 * El coordinador filtra por seller, comuna y fecha, abre un pedido, vuelve… y
 * hoy vuelve al listado **sin filtros**, a mirar 284 filas otra vez. El listado
 * pasa su propia query en `?volver=`, y esta pieza la usa como destino.
 *
 * ⚠️ **`volver` viene de la URL, así que es una redirección abierta si se usa
 * tal cual.** `destinoRetorno` solo acepta rutas internas: tiene que empezar
 * con una sola barra. `//evil.com` y `https://evil.com` son destinos válidos
 * para un navegador y se rechazan los dos. Cualquier cosa que no pase, cae al
 * destino por defecto que declara la pantalla.
 */

/**
 * Resuelve a dónde vuelve el «‹ Volver», validando lo que venga de la URL.
 *
 * @param base   Destino por defecto de la pantalla, siempre interno.
 * @param volver Lo que llegó en `?volver=`. Puede ser cualquier cosa.
 */
export function destinoRetorno(base: string, volver?: string | string[] | null): string {
  const candidato = Array.isArray(volver) ? volver[0] : volver;
  if (!candidato) return base;

  // Una sola barra al inicio. `//host` y `/\host` los resuelve el navegador
  // como protocolo-relativo, o sea salen del sitio.
  if (!candidato.startsWith("/")) return base;
  if (candidato.startsWith("//")) return base;
  if (candidato.startsWith("/\\")) return base;

  return candidato;
}

/**
 * Construye el href de una fila del listado llevándose la query actual, para
 * que el detalle sepa a dónde devolver.
 */
export function hrefConRetorno(href: string, retorno: string): string {
  if (!retorno || retorno === "/") return href;
  const separador = href.includes("?") ? "&" : "?";
  return `${href}${separador}volver=${encodeURIComponent(retorno)}`;
}

export function Retorno({
  href,
  etiqueta,
  className,
}: {
  href: string;
  /** «Volver a pedidos». Nombra el destino: «Volver» a secas obliga a adivinar. */
  etiqueta: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
    >
      <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
      {etiqueta}
    </Link>
  );
}

export interface Miga {
  etiqueta: string;
  /** Sin `href` es la hoja: la pantalla en la que estás. */
  href?: string;
}

/**
 * Migas — solo donde la jerarquía tiene más de dos niveles.
 *
 * Con dos niveles, las migas y el «‹ Volver» dicen lo mismo y una de las dos
 * sobra. La regla del sistema: **una sola salida por pantalla**.
 */
export function Migas({ items, className }: { items: Miga[]; className?: string }) {
  return (
    <nav aria-label="Migajas de pan" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((m, i) => {
          const esHoja = i === items.length - 1;
          return (
            <li key={`${m.etiqueta}-${i}`} className="flex items-center gap-1.5">
              {m.href && !esHoja ? (
                <Link href={m.href} className="transition-colors hover:text-foreground">
                  {m.etiqueta}
                </Link>
              ) : (
                <span className={cn(esHoja && "text-foreground")} aria-current={esHoja ? "page" : undefined}>
                  {m.etiqueta}
                </span>
              )}
              {!esHoja ? (
                <span aria-hidden="true" className="text-fg-subtle">
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
