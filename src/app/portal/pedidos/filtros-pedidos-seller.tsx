"use client";

/**
 * El filtro de fecha de «Mis pedidos» (portal del seller).
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * AQUÍ VIVÍA UN SELECTOR CON LOS NUEVE ESTADOS DEL MOTOR
 * -----------------------------------------------------------------------------
 * Se retiró. Ese selector hablaba el idioma del courier —«Pendiente de
 * asignación», «Fallido»— y obligaba a filtrar tres veces para llegar a «los que
 * tuvieron un problema». Lo reemplazan los cuatro cajones de la lista, que
 * además traen su contador. Un mismo eje no puede filtrarse desde dos controles
 * distintos: quedaría un estado elegido arriba y otro abajo, y la pantalla no
 * podría decir cuál manda.
 *
 * Lo que queda acá es la fecha, que es un eje independiente y se combina con el
 * cajón sin ambigüedad.
 */

import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FiltroFecha } from "@/components/filtros/filtro-fecha";

interface Props {
  /** "Hoy" civil de Santiago (para los atajos y la etiqueta del filtro de fecha). */
  hoy: string;
  /** Día exacto de fecha de compromiso ("" si hay rango). */
  filtroFecha: string;
  /** Rango de fecha de compromiso ("" si hay día exacto). */
  filtroFechaDesde: string;
  filtroFechaHasta: string;
  /** Incluye el cajón y la búsqueda, no solo la fecha: limpiar los limpia todos. */
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

  return (
    <>
      <FiltroFecha
        id="f-fecha-p"
        label="Fecha de compromiso"
        hoy={hoy}
        exacto={filtroFecha}
        desde={filtroFechaDesde}
        hasta={filtroFechaHasta}
      />

      {hayFiltros && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push(pathname)}
          className="h-9 self-end text-muted-foreground"
        >
          Limpiar filtros
        </Button>
      )}
    </>
  );
}
