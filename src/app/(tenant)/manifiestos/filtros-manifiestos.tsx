"use client";

/**
 * Filtros de la lista de manifiestos — Client Component.
 * Navega por searchParams al cambiar, con los componentes del sistema.
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { ESTADOS_MANIFIESTO } from "@/modules/operacion/tipos";
import { TEXTO_ESTADO_MANIFIESTO } from "@/lib/ui/traduccion-estados";
import type { EstadoManifiesto } from "@/modules/operacion/tipos";
import { Button } from "@/components/ui/button";
import { FiltroFecha } from "@/components/filtros/filtro-fecha";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TODOS = "__todos__";

interface Props {
  /** "Hoy" civil de Santiago (para los atajos y la etiqueta del filtro de fecha). */
  hoy: string;
  filtroEstado: string;
  /** Día exacto de fecha de operación ("" si hay rango). */
  filtroFecha: string;
  /** Rango de fecha de operación ("" si hay día exacto). */
  filtroFechaDesde: string;
  filtroFechaHasta: string;
  hayFiltros: boolean;
}

export function FiltrosManifiestos({
  hoy,
  filtroEstado,
  filtroFecha,
  filtroFechaDesde,
  filtroFechaHasta,
  hayFiltros,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      // El filtro de fecha se cambia por su propio control; aquí solo se PRESERVA
      // la selección vigente (día exacto o rango) al tocar otro filtro.
      if (filtroFecha) {
        params.set("fecha", filtroFecha);
      } else {
        if (filtroFechaDesde) params.set("fecha_desde", filtroFechaDesde);
        if (filtroFechaHasta) params.set("fecha_hasta", filtroFechaHasta);
      }
      if (valor) params.set(campo, valor);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, filtroEstado, filtroFecha, filtroFechaDesde, filtroFechaHasta],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="f-estado-m" className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <Select
          value={filtroEstado || TODOS}
          onValueChange={(v) => actualizar("estado", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-estado-m" size="default" className="h-9 w-52">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {ESTADOS_MANIFIESTO.map((e) => (
              <SelectItem key={e} value={e}>
                {TEXTO_ESTADO_MANIFIESTO[e as EstadoManifiesto]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FiltroFecha
        id="f-fecha-m"
        label="Fecha de operación"
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
          className="h-9 text-muted-foreground"
        >
          Limpiar
        </Button>
      )}
    </div>
  );
}
