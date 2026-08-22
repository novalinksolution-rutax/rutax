"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { hrefConRetorno } from "./retorno";

/**
 * EnlaceDetalle — el enlace de una fila hacia su pantalla de detalle, que se
 * lleva el filtro puesto.
 *
 * LA REGLA, DEL TABLERO P1: «volver de un detalle nunca pierde el filtro»
 * ---------------------------------------------------------------------------
 * El coordinador filtra por seller, comuna y fecha, abre un pedido, vuelve — y
 * hoy aterriza en el listado sin filtros, mirando 284 filas otra vez. Este
 * enlace cuelga la URL actual en `?volver=`, y el `Retorno` del detalle la usa
 * como destino (validada: ver `destinoRetorno`).
 *
 * POR QUÉ ES UN COMPONENTE DE CLIENTE Y NO UNA PROP QUE BAJA DEL SERVIDOR
 * ---------------------------------------------------------------------------
 * Porque los enlaces de fila viven dentro de subcomponentes —`FilaLiquidacion`,
 * `FilaPeriodo`— y hacer bajar el retorno hasta ellos obliga a enhebrar una prop
 * por cada listado, por cada nivel. Leyendo `usePathname` y `useSearchParams` el
 * cambio es de una línea por enlace y no hay nada que mantener sincronizado.
 *
 * Los dos hooks funcionan también durante el render en servidor de un
 * componente de cliente, así que el `href` sale igual en las dos pasadas y no
 * hay desajuste de hidratación.
 */
export function EnlaceDetalle({
  href,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Link>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = searchParams.toString();
  const actual = query ? `${pathname}?${query}` : pathname;

  return (
    <Link href={hrefConRetorno(String(href), actual)} className={className} {...props}>
      {children}
    </Link>
  );
}
