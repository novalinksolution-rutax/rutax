"use client";

/**
 * Los filtros de «Mis pedidos» (portal del seller), en chips.
 * =============================================================================
 *
 * Mismo componente que el listado del courier (`ChipsFiltro`), para que las dos
 * pantallas de pedidos se lean igual. El estado NO se filtra acá: lo hacen los
 * cajones de la barra, que además traen su contador.
 *
 * ⚠️ A diferencia del courier, acá la fecha **no cae a hoy**: el seller entra
 * buscando un pedido de cualquier día. Por eso su chip se puede quitar.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChipsFiltro, type ChipFiltro } from "@/components/filtros/chips-filtro";
import { FiltroFecha } from "@/components/filtros/filtro-fecha";
import { formatearFechaCivilCorta } from "@/lib/formato-cl";

interface Props {
  /** "Hoy" civil de Santiago (para los atajos y la etiqueta del filtro de fecha). */
  hoy: string;
  /** Día exacto de fecha de compromiso ("" si hay rango). */
  filtroFecha: string;
  /** Rango de fecha de compromiso ("" si hay día exacto). */
  filtroFechaDesde: string;
  filtroFechaHasta: string;
  /** Incluye el cajón y la búsqueda, no solo la fecha: quitar los quita todos. */
  hayFiltros: boolean;
}

export function FiltrosPedidosSeller({
  hoy,
  filtroFecha,
  filtroFechaDesde,
  filtroFechaHasta,
  hayFiltros,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const etiquetaFecha =
    filtroFecha === hoy
      ? "Hoy"
      : filtroFecha
        ? formatearFechaCivilCorta(filtroFecha)
        : filtroFechaDesde || filtroFechaHasta
          ? `${filtroFechaDesde ? formatearFechaCivilCorta(filtroFechaDesde) : "…"} a ${filtroFechaHasta ? formatearFechaCivilCorta(filtroFechaHasta) : "…"}`
          : null;

  function quitarFecha() {
    const siguiente = new URLSearchParams(params.toString());
    for (const k of ["fecha", "fecha_desde", "fecha_hasta", "pagina"]) siguiente.delete(k);
    const qs = siguiente.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const chips: ChipFiltro[] = [
    {
      clave: "fecha",
      etiqueta: "Fecha",
      valor: etiquetaFecha,
      onQuitar: quitarFecha,
      control: (
        <FiltroFecha
          id="f-fecha-p"
          label="Fecha comprometida"
          hoy={hoy}
          exacto={filtroFecha}
          desde={filtroFechaDesde}
          hasta={filtroFechaHasta}
        />
      ),
    },
  ];

  return (
    <ChipsFiltro
      chips={chips}
      onLimpiarTodo={hayFiltros ? () => router.push(pathname) : undefined}
    />
  );
}
